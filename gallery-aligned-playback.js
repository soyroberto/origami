/* Shared-column playback. Photo animations never own the separator geometry. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShiftingTilesAlignedPlayback = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var serial = 0, BORDER = 4, GAP = 4;

  function create(where, images, settings) {
    var $ = where.constructor, gallery = where[0], win = gallery.ownerDocument.defaultView;
    var doc = win.document, namespace = '.alignedPlayback' + (++serial);
    settings = settings || {};
    var previous = where.data('shiftingtiles-playback');
    if (previous) return previous;
    var oldLayout = where.data('shiftingtiles-layout');
    if (oldLayout && typeof oldLayout.destroy === 'function') oldLayout.destroy();
    var queue = win.ShiftingTilesAlbumQueue.create(images), members = Object.create(null);
    var timer = null, animationTimer = null, pending = null, active = null, destroyed = false;
    var generation = 0, initialReady = false, columnWidths = null, logicalWidth = 0;
    var raf = null, observer = null, needsFit = false, controllerDestroyed = false;
    var lastWidth = 0, lastHeight = 0, metrics = null, fits = 0, localFits = 0, lastLocalFit = null;
    var structureChanges = 0;
    var duration = positive(Number(settings.duration)) ? Number(settings.duration) : 5000;
    var aligned = $.extend({minGain: 0.02, maxNeighbors: 1}, settings.alignedLayout);
    aligned.minGain = typeof aligned.minGain === 'number' && isFinite(aligned.minGain) && aligned.minGain >= 0 && aligned.minGain <= 1 ? aligned.minGain : 0.02;
    var dynamic = $.extend({enabled: false, probability: 0.25, minTransitionsBetweenChanges: 3,
      minTileWidth: 160, minTileHeight: 100}, settings.dynamicRows);
    dynamic.enabled = dynamic.enabled === true;
    dynamic.probability = Math.max(0, Math.min(1, Number(dynamic.probability) || 0));
    dynamic.minTransitionsBetweenChanges = Math.max(0, Math.floor(Number(dynamic.minTransitionsBetweenChanges) || 0));
    dynamic.minTileWidth = positive(Number(dynamic.minTileWidth)) ? Number(dynamic.minTileWidth) : 160;
    dynamic.minTileHeight = positive(Number(dynamic.minTileHeight)) ? Number(dynamic.minTileHeight) : 100;
    var completedSinceChange = dynamic.minTransitionsBetweenChanges;
    var photoSelector = '.single, .dual > div';

    function positive(value) { return typeof value === 'number' && isFinite(value) && value > 0; }
    function updateMembers(source) {
      members = Object.create(null);
      (Array.isArray(source) ? source : []).forEach(function (url) {
        if (typeof url === 'string' && url.trim()) members[url.trim()] = true;
      });
    }
    updateMembers(images);

    function face(count) {
      var node = doc.createElement('div');
      node.className = count === 2 ? 'dual' : 'single';
      node.style.setProperty('--st-start-width', '100%');
      if (count === 2) node.innerHTML = '<div></div><div></div>';
      return $(node);
    }
    function setupRows() {
      where.addClass('gallery shiftingtiles gallery-aligned');
      if (where.children('.row').length) where.children('.row').remove();
      for (var r = 0; r < 2; r++) {
        var row = doc.createElement('div');
        row.className = 'row';
        row.setAttribute('data-st-row', String(r));
        for (var c = 0; c < 3; c++) {
          var cell = doc.createElement('div');
          cell.className = 'st-slot';
          cell.setAttribute('data-st-column', String(c));
          cell.style.width = 'var(--st-col-' + c + ')';
          cell.style.left = 'var(--st-left-' + c + ')';
          $(cell).append(face(c === 2 ? 2 : 1));
          row.appendChild(cell);
        }
        gallery.appendChild(row);
      }
      // A single gallery-level write supplies the initial stable grid, even before metadata.
      writeColumns([1, 1, 1], 3);
    }
    function cells() { return where.children('.row').children('.st-slot'); }
    function boxes() { return cells().children('.single,.dual').not('.disappear'); }
    function rowPhotoCounts() {
      return where.children('.row').map(function () {
        var count = 0;
        $(this).children('.st-slot').children('.single,.dual').not('.disappear').each(function () {
          count += $(this).hasClass('dual') ? 2 : 1;
        });
        return count;
      }).toArray();
    }
    function rowCount(box) { return rowPhotoCounts()[Number(box.closest('.row').attr('data-st-row'))]; }
    function visibleURLs() {
      return where.find(photoSelector).map(function () { return $(this).data('st-photo-url') || null; }).toArray();
    }
    function reserve(count, extra) {
      var cycle = queue.stats().cycle;
      var result = queue.reserve(count, visibleURLs().concat(extra || []));
      if (queue.stats().cycle !== cycle) where.trigger('st-galleryrestart');
      return result;
    }
    function acknowledgeHeldPhotos() {
      var state = queue.stats(), acknowledged = 0;
      if (state.albumSize <= visibleURLs().length || state.seenCount + state.failedCount === state.albumSize) return false;
      var all = Object.keys(members);
      visibleURLs().forEach(function (url) {
        var s = queue.stats();
        if (s.seenCount + s.failedCount === s.albumSize) return;
        var held = queue.reserve(1, all.filter(function (member) { return member !== url; }));
        if (held.length && queue.commit(held[0])) acknowledged++;
      });
      return acknowledged > 0;
    }
    function canvas() {
      var W = Number(gallery.clientWidth), H = Number(gallery.clientHeight);
      return positive(W) && H > 2 * (BORDER + GAP) && W > 3 * BORDER ? {W: W, H: H} : null;
    }
    function scaledWidths(W) {
      if (!columnWidths || !positive(logicalWidth)) return null;
      var result = columnWidths.map(function (width) { return width / logicalWidth * W; });
      result[2] = W - result[0] - result[1];
      return result.every(function (width) { return width > BORDER; }) ? result : null;
    }
    function snapshot() {
      var valid = true;
      var rows = where.children('.row').map(function () {
        var groups = $(this).children('.st-slot').map(function () {
          var box = $(this).children('.single,.dual').not('.disappear');
          if (box.length !== 1) { valid = false; return null; }
          var type = box.hasClass('dual') ? 'dual' : 'single';
          var leaves = type === 'dual' ? box.children('div') : box;
          var ratios = leaves.map(function () {
            var leaf = $(this), w = leaf.data('st-natural-width'), h = leaf.data('st-natural-height');
            var request = leaf.data('st-image-request');
            if (!positive(w) || !positive(h) || !positive(w / h) || !members[leaf.data('st-photo-url')] ||
                (request && request !== leaf.data('st-image-loaded-request'))) valid = false;
            return w / h;
          }).toArray();
          if (ratios.length !== (type === 'dual' ? 2 : 1)) valid = false;
          return {type: type, ratios: ratios};
        }).toArray();
        if (groups.length !== 3) valid = false;
        return [groups];
      }).toArray();
      return valid && rows.length === 2 ? rows : null;
    }
    function planner(rows, size, widths, anchor) {
      var api = win.ShiftingTilesLayout;
      if (!api || typeof api.planAligned !== 'function') return null;
      var opts = {maxNeighbors: 1, minGain: aligned.minGain};
      if (widths) opts.anchorIndex = anchor == null ? 1 : anchor;
      return api.planAligned(rows, size.W, size.H, widths, opts);
    }
    function writeColumns(widths, W) {
      var style = doc.createElement('div').style;
      style.cssText = gallery.style.cssText;
      var percents = widths.map(function (width) { return width / W * 100; });
      percents[2] = 100 - percents[0] - percents[1];
      var left = 0;
      for (var c = 0; c < 3; c++) {
        style.setProperty('--st-col-' + c, percents[c] + '%');
        style.setProperty('--st-left-' + c, left + '%');
        left += percents[c];
      }
      gallery.setAttribute('style', style.cssText);
    }
    function fitHeights(H) {
      if (!(H > 2 * (BORDER + GAP))) return;
      // Resolve against the current CSS content height, including while a fit is deferred.
      // Storing a percentage derived from an earlier viewport misplaces the 4px gap on resize.
      where.find('.dual').each(function () {
        $(this).children('div').each(function (index) {
          this.style.height = index ? 'calc(50% + 2px)' : 'calc(50% - 2px)';
        });
      });
    }
    function applyGeometry(widths, size, plan, animate) {
      if (animate) where.addClass('gallery-fitting');
      columnWidths = widths.slice(); logicalWidth = size.W;
      writeColumns(columnWidths, size.W);
      fitHeights(size.H);
      lastWidth = size.W; lastHeight = size.H; needsFit = false;
      metrics = plan ? JSON.parse(JSON.stringify(plan)) : {};
      metrics.fits = ++fits; metrics.width = size.W; metrics.height = size.H;
      metrics.rearranged = false; metrics.aligned = true;
    }
    function fit() {
      var size = canvas(), rows = snapshot();
      if (!size || !rows) return false;
      var widths = scaledWidths(size.W), plan;
      try { plan = planner(rows, size, widths, 1); } catch (error) { plan = null; }
      var target = plan && (!widths || plan.gain + 1e-12 >= aligned.minGain) ? plan.columnWidths : widths;
      if (!target) return false;
      applyGeometry(target, size, plan, false);
      where.trigger('st-layout-updated');
      return true;
    }
    function flush() {
      raf = null;
      if (destroyed || controllerDestroyed || !needsFit || pending || active || !initialReady ||
          where.hasClass('leave') || where.hasClass('left')) return;
      fit();
    }
    function scheduleFit() {
      if (!destroyed && !controllerDestroyed && needsFit && raf === null) raf = win.requestAnimationFrame(flush);
    }
    function resized() {
      if (gallery.clientWidth !== lastWidth || gallery.clientHeight !== lastHeight) {
        needsFit = true;
        scheduleFit();
      }
    }
    function clearTimer() { if (timer !== null) win.clearTimeout(timer); timer = null; }
    function schedule() {
      if (destroyed || doc.hidden || queue.stats().albumSize < 8 || timer !== null) return;
      timer = win.setTimeout(function () { timer = null; frame(); schedule(); }, duration);
    }
    function cleanRequest(slot) {
      if (slot.deadline !== null) win.clearTimeout(slot.deadline);
      slot.deadline = null;
      if (slot.image) slot.image.onload = slot.image.onerror = null;
    }
    function current(transaction) {
      return !destroyed && !transaction.cancelled && pending === transaction && transaction.generation === generation;
    }
    function cancelPending() {
      if (!pending) return;
      var transaction = pending;
      pending = null; transaction.cancelled = true;
      transaction.slots.forEach(function (slot) { cleanRequest(slot); queue.release(slot.url); });
      where.trigger('st-preload-cancelled');
      scheduleFit();
    }
    function canSplit(box, size, widths) {
      size = size || canvas();
      widths = widths || (size && scaledWidths(size.W));
      var column = Number(box.parent().attr('data-st-column'));
      return !!(size && widths && rowCount(box) < 6 &&
        queue.stats().albumSize - (visibleURLs().length + 1) >= 2 &&
        widths[column] - BORDER >= dynamic.minTileWidth &&
        (size.H / 2 - BORDER - GAP) / 2 >= dynamic.minTileHeight);
    }
    function select(transaction) {
      if (!transaction.slots.every(function (slot) {
        return positive(slot.width) && positive(slot.height) && positive(slot.width / slot.height);
      })) return null;
      var size = canvas();
      if (!size) return null;
      var outgoing = transaction.outgoing, normalCount = transaction.normalCount;
      var row = Number(outgoing.closest('.row').attr('data-st-row'));
      var column = Number(outgoing.parent().attr('data-st-column'));
      var rows = snapshot(), widths = scaledWidths(size.W);
      if (rowCount(outgoing) + normalCount - transaction.oldCount < 4) return null;
      function candidate(count) {
        var input = rows.map(function (groups) { return groups.map(function (g) { return {type: g.type, ratios: g.ratios.slice()}; }); });
        input[row][column] = {type: count === 2 ? 'dual' : 'single', ratios: transaction.slots.slice(0, count).map(function (slot) { return slot.width / slot.height; })};
        var plan = planner(input, size, widths, column);
        if (!plan) return null;
        var material = plan.gain + 1e-12 >= aligned.minGain;
        return {count: count, plan: plan, material: material, coverage: material ? plan.coverage : plan.baselineCoverage};
      }
      // If other metadata is stale, a valid normally sized face is still safe.
      var chosen = null, normal = null;
      if (rows && widths) {
        try {
          normal = candidate(normalCount); chosen = normal;
          var alternate = normalCount === 2 ? 1 : 2;
          var eligible = transaction.structuralEligible && transaction.slots.length >= alternate &&
            (alternate === 2 ? canSplit(outgoing, size, widths) : rowCount(outgoing) > 4);
          if (eligible && normal) {
            var other = candidate(alternate);
            var width = other && (other.material ? other.plan.columnWidths[column] : widths[column]);
            var child = alternate === 2 ? (size.H / 2 - BORDER - GAP) / 2 : size.H / 2 - BORDER;
            if (other && width - BORDER >= dynamic.minTileWidth && child >= dynamic.minTileHeight &&
                other.coverage - normal.coverage + 1e-12 >= aligned.minGain &&
                other.plan.coverage + 1e-12 >= normal.coverage) chosen = other;
          }
        } catch (error) { chosen = normal; }
      }
      if (!chosen) chosen = {count: normalCount, plan: null, material: false};
      chosen.size = size; chosen.widths = widths;
      chosen.column = column;
      chosen.structuralGain = normal ? chosen.coverage - normal.coverage : 0;
      return chosen;
    }
    function setPhoto(element, slot) {
      element.css('background-image', 'url(' + JSON.stringify(slot.url) + ')')
        .data('st-photo-url', slot.url).data('st-natural-width', slot.width).data('st-natural-height', slot.height)
        .data('st-image-request', slot.marker).data('st-image-loaded-request', slot.marker);
    }
    function finishAnimation() {
      if (animationTimer !== null) win.clearTimeout(animationTimer);
      animationTimer = null;
      where.removeClass('gallery-fitting');
      if (!active) { scheduleFit(); return; }
      var transaction = active;
      active = null;
      transaction.outgoing.remove();
      if (transaction.structureChange) { structureChanges++; completedSinceChange = 0; }
      else completedSinceChange++;
      where.trigger('st-animate-after');
      scheduleFit(); schedule();
    }
    function activate(transaction) {
      if (!current(transaction) || !transaction.slots.every(function (slot) { return slot.loaded; }) || doc.hidden || active) return;
      if (transaction.kind === 'initial') { completeInitial(transaction); return; }
      if (where.hasClass('leave') || where.hasClass('left') || !transaction.outgoing.closest('.st-slot').length) {
        cancelPending(); schedule(); return;
      }
      where.trigger('st-animate-before', transaction.outgoing);
      if (!current(transaction) || doc.hidden) return;
      if (where.hasClass('leave') || where.hasClass('left')) { cancelPending(); schedule(); return; }
      // All loads and user callbacks precede current-size geometry selection.
      var selection = select(transaction);
      if (!selection) { cancelPending(); schedule(); return; }
      transaction.slots.splice(selection.count).forEach(function (slot) { cleanRequest(slot); queue.release(slot.url); });
      var incoming = face(selection.count), photos = selection.count === 2 ? incoming.children('div') : incoming;
      photos.each(function (i) { setPhoto($(this), transaction.slots[i]); });
      transaction.slots.forEach(function (slot) { queue.commit(slot.url); });
      pending = null;
      active = {outgoing: transaction.outgoing, incoming: incoming, structureChange: selection.count !== transaction.oldCount};
      incoming.insertAfter(transaction.outgoing);
      transaction.outgoing.addClass('disappear');
      transaction.outgoing[0].style.setProperty('--st-start-width', '100%');
      incoming[0].getBoundingClientRect();
      var apply = selection.plan && selection.material;
      var target = apply ? selection.plan.columnWidths : selection.widths;
      if (target) {
        applyGeometry(target, selection.size, selection.plan, !!apply);
        if (apply) {
          localFits++;
          lastLocalFit = {coverage: selection.plan.coverage, baselineCoverage: selection.plan.baselineCoverage,
            gain: selection.plan.gain, structuralGain: selection.structuralGain,
            localRange: selection.plan.localRange.slice(), anchorIndex: selection.column};
        }
      } else { fitHeights(selection.size.H); needsFit = true; }
      // Native animationend normally finishes; this deadline also handles removed CSS/reduced motion.
      animationTimer = win.setTimeout(finishAnimation, 1000);
      photos.each(function (i) {
        if (!destroyed && transaction.generation === generation) where.trigger('st-image-ready', [$(this), transaction.slots[i].url]);
      });
      if (!destroyed && transaction.generation === generation) where.trigger('st-animate', transaction.outgoing);
      schedule();
    }
    function completeInitial(transaction) {
      if (!current(transaction) || !transaction.slots.every(function (slot) { return slot.loaded; }) || doc.hidden) return;
      transaction.slots.forEach(function (slot) { setPhoto(slot.element, slot); queue.commit(slot.url); });
      pending = null; initialReady = true;
      columnWidths = null; logicalWidth = 0;
      if (!fit()) { needsFit = true; fitHeights(Number(gallery.clientHeight)); }
      if (destroyed || transaction.generation !== generation || !initialReady) return;
      where.css('visibility', '');
      transaction.slots.forEach(function (slot) {
        if (!destroyed && transaction.generation === generation) where.trigger('st-image-ready', [slot.element, slot.url]);
      });
      if (!destroyed && transaction.generation === generation) where.trigger('st-initial-ready');
      scheduleFit(); schedule();
    }
    function loadSlot(transaction, slot) {
      if (!current(transaction)) return;
      slot.attempts++;
      slot.marker = {url: slot.url, generation: generation, attempt: slot.attempts};
      var marker = slot.marker, image = new win.Image(), finished = false;
      slot.image = image;
      function valid() { return !finished && current(transaction) && slot.marker === marker && !!members[slot.url]; }
      function clean() { finished = true; cleanRequest(slot); }
      function failed() {
        if (!valid()) return;
        clean(); queue.fail(slot.url); transaction.failedURLs.push(slot.url);
        if (transaction.kind === 'initial' && slot.attempts < 3) {
          var replacement = reserve(1, transaction.failedURLs);
          if (replacement.length) { slot.url = replacement[0]; loadSlot(transaction, slot); return; }
        }
        cancelPending(); schedule();
      }
      slot.deadline = win.setTimeout(failed, 20000);
      image.onload = function () {
        if (!valid()) return;
        clean(); slot.width = Number(image.naturalWidth || image.width); slot.height = Number(image.naturalHeight || image.height);
        if (!positive(slot.width) || !positive(slot.height) || !positive(slot.width / slot.height)) {
          cancelPending(); schedule(); return;
        }
        slot.loaded = true;
        activate(transaction);
      };
      image.onerror = failed;
      image.src = slot.url;
    }
    function start(kind, urls, outgoing, context) {
      var leaves = kind === 'initial' ? where.find(photoSelector).toArray() : null;
      var transaction = {kind: kind, generation: generation, cancelled: false, outgoing: outgoing,
        oldCount: outgoing && (outgoing.hasClass('dual') ? 2 : 1), normalCount: context && context.normalCount,
        structuralEligible: !!(context && context.structuralEligible), failedURLs: [],
        slots: urls.map(function (url, i) { return {url: url, element: leaves ? $(leaves[i]) : null,
          attempts: 0, image: null, deadline: null, loaded: false}; })};
      pending = transaction;
      transaction.slots.forEach(function (slot) { if (current(transaction)) loadSlot(transaction, slot); });
    }
    function fillInitial() {
      if (destroyed || pending || active || queue.stats().albumSize < 8) return false;
      var urls = reserve(8);
      if (urls.length !== 8) {
        var state = queue.stats();
        // No history is lost: nothing has been displayed or committed yet. A failed
        // initial batch in an 8/9-photo album must get another bounded attempt after
        // the normal recovery clock, rather than remain hidden forever.
        if (!initialReady && !visibleURLs().length && state.seenCount === 0 &&
            state.reservedCount === 0 && state.failedCount > 0) {
          queue = win.ShiftingTilesAlbumQueue.create(Object.keys(members));
          urls = reserve(8);
        }
      }
      if (urls.length !== 8) return false;
      where.css('visibility', 'hidden');
      start('initial', urls);
      return true;
    }
    function frame() {
      if (destroyed || doc.hidden || pending || active || queue.stats().albumSize < 8 ||
          where.hasClass('leave') || where.hasClass('left')) return false;
      if (!initialReady) return fillInitial();
      var available = boxes();
      if (!available.length) return false;
      var outgoing = $(available.get(Math.floor(win.Math.random() * available.length)));
      var normalCount = outgoing.hasClass('dual') ? 2 : 1, count = normalCount, eligible = false;
      if (dynamic.enabled && completedSinceChange >= dynamic.minTransitionsBetweenChanges && win.Math.random() < dynamic.probability) {
        if (normalCount === 1 && canSplit(outgoing)) { count = 2; eligible = true; }
        else if (normalCount === 2 && rowCount(outgoing) > 4) eligible = true;
      }
      var urls = reserve(count);
      if (!urls.length && count === 2 && normalCount === 1) { urls = reserve(1); eligible = false; }
      if (!urls.length && count === 2) {
        var singles = available.filter('.single');
        var mergeable = available.filter('.dual').filter(function () { return rowCount($(this)) > 4; });
        var recovery = singles.length ? singles : mergeable;
        if (recovery.length) {
          outgoing = $(recovery.get(Math.floor(win.Math.random() * recovery.length)));
          urls = reserve(1); normalCount = 1; eligible = false;
        }
      }
      if (!urls.length && acknowledgeHeldPhotos()) return frame();
      if (!urls.length) return false;
      clearTimer();
      start('transition', urls, outgoing, {normalCount: normalCount, structuralEligible: eligible});
      schedule();
      return true;
    }
    function resetFaces() {
      cells().each(function () { $(this).empty().append(face(Number(this.getAttribute('data-st-column')) === 2 ? 2 : 1)); });
      initialReady = false; columnWidths = null; logicalWidth = 0;
      needsFit = false; lastWidth = lastHeight = 0;
      writeColumns([1, 1, 1], 3);
    }
    function update(event, source) {
      source = Array.isArray(source) ? source : [];
      updateMembers(source);
      var total = rowPhotoCounts().reduce(function (sum, count) { return sum + count; }, 0);
      queue.setImages(source);
      var reset = visibleURLs().some(function (url) { return !members[url]; }) ||
        (total > 8 && queue.stats().albumSize - total < 2) || queue.stats().albumSize < 8;
      if (reset) {
        generation++; cancelPending(); clearTimer(); finishAnimation(); clearTimer();
        queue = win.ShiftingTilesAlbumQueue.create(source);
        resetFaces(); completedSinceChange = dynamic.minTransitionsBetweenChanges;
      } else if (pending && pending.slots.some(function (slot) { return !members[slot.url]; })) cancelPending();
      if (!initialReady && !pending && !active) fillInitial();
      schedule();
    }
    var controller = {
      metrics: function () { return metrics ? JSON.parse(JSON.stringify(metrics)) : null; },
      destroy: function () {
        if (controllerDestroyed) return;
        controllerDestroyed = true;
        if (raf !== null) win.cancelAnimationFrame(raf);
        raf = null;
        if (observer) observer.disconnect();
        else win.removeEventListener('resize', resized);
        where.off('.alignedResize' + serialNumber);
      }
    };
    var serialNumber = serial;
    function destroy() {
      if (destroyed) return;
      destroyed = true; generation++; clearTimer(); cancelPending(); finishAnimation(); controller.destroy();
      where.off(namespace); $(doc).off(namespace); $(doc.body).off(namespace);
      if (where.data('shiftingtiles-playback') === playback) where.removeData('shiftingtiles-playback');
      if (where.data('shiftingtiles-layout') === controller) where.removeData('shiftingtiles-layout');
    }
    var playback = {
      stats: function () {
        var state = queue.stats();
        state.visibleURLs = visibleURLs(); state.loading = !!pending; state.animating = !!active;
        state.rowPhotoCounts = rowPhotoCounts(); state.structureChanges = structureChanges;
        state.dynamicRowsEnabled = dynamic.enabled; state.adaptiveLayoutEnabled = false; state.alignedLayoutEnabled = true;
        state.localFits = localFits;
        state.columnWidths = columnWidths && columnWidths.slice();
        if (lastLocalFit) state.lastLocalFit = $.extend({}, lastLocalFit, {localRange: lastLocalFit.localRange.slice()});
        return state;
      }, frame: frame, destroy: destroy
    };
    setupRows();
    where.data('shiftingtiles-playback', playback).data('shiftingtiles-layout', controller);
    where.on('st-photos-update' + namespace, update);
    where.on('animationend' + namespace + ' webkitAnimationEnd' + namespace + ' oAnimationEnd' + namespace,
      '.disappear', function (event) {
        if (active && active.outgoing[0] === this) { finishAnimation(); event.stopPropagation(); }
      });
    where.on('animationend' + namespace + ' webkitAnimationEnd' + namespace + ' oAnimationEnd' + namespace,
      '.leave > .row', function () { $(this).parent().addClass('left').removeClass('leave'); });
    $(doc).on('visibilitychange' + namespace, function () {
      if (doc.hidden) { clearTimer(); finishAnimation(); }
      else { if (pending) activate(pending); scheduleFit(); schedule(); }
    });
    $(doc.body).on('keydown' + namespace, function (event) {
      if (event.keyCode === 32) { frame(); event.preventDefault(); return false; }
      if (event.keyCode === 38) {
        where.toggleClass('leave'); cancelPending(); finishAnimation();
        if (!where.hasClass('leave') && !where.hasClass('left')) { scheduleFit(); schedule(); }
      }
    });
    where.on('st-animate-after.alignedResize' + serialNumber + ' st-preload-cancelled.alignedResize' + serialNumber, scheduleFit);
    if (typeof win.ResizeObserver === 'function') { observer = new win.ResizeObserver(resized); observer.observe(gallery); }
    else win.addEventListener('resize', resized);
    fillInitial();
    return playback;
  }
  return {create: create};
}));
