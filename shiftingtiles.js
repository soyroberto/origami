(function($) {
  "use strict";
  var instanceNumber = 0;

  $.fn.shiftingtiles = function(images, options) {
    var settings = $.extend({photosource: images, duration: 5000, fallbackPhotos: []}, options);
    return this.each(function() {
      var where = $(this), previous = where.data("shiftingtiles-playback");
      if(previous) return;
      var queue = window.ShiftingTilesAlbumQueue.create(images);
      var namespace = ".shiftingtiles" + (++instanceNumber);
      var timeout = null, pending = null, active = null, destroyed = false;
      var initialReady = false, generation = 0, members = Object.create(null);
      var photoSelector = ".single, .dual > div";
      var duration = Number(settings.duration) > 0 ? Number(settings.duration) : 5000;
      var dynamic = $.extend({enabled: false, probability: 0.25,
        minTransitionsBetweenChanges: 3, minTileWidth: 160, minTileHeight: 100}, settings.dynamicRows);
      dynamic.enabled = dynamic.enabled === true;
      dynamic.probability = Math.max(0, Math.min(1, Number(dynamic.probability) || 0));
      dynamic.minTransitionsBetweenChanges = Math.max(0, Math.floor(Number(dynamic.minTransitionsBetweenChanges) || 0));
      dynamic.minTileWidth = Number(dynamic.minTileWidth) > 0 ? Number(dynamic.minTileWidth) : 160;
      dynamic.minTileHeight = Number(dynamic.minTileHeight) > 0 ? Number(dynamic.minTileHeight) : 100;
      var structureChanges = 0, completedSinceChange = dynamic.minTransitionsBetweenChanges;
      var adaptive = $.extend({enabled: false, minGain: 0.02, maxNeighbors: 1}, settings.adaptiveLayout);
      adaptive.enabled = adaptive.enabled === true;
      adaptive.minGain = typeof adaptive.minGain === "number" && isFinite(adaptive.minGain) && adaptive.minGain >= 0 ? adaptive.minGain : 0.02;
      adaptive.maxNeighbors = 1;
      var localFits = 0, lastLocalFit = null;
      var BORDER = 2, GAP = 2;

      function adaptiveAvailable() {
        return adaptive.enabled && window.ShiftingTilesLayout &&
          typeof window.ShiftingTilesLayout.refitRow === "function";
      }

      function positive(value) { return typeof value === "number" && isFinite(value) && value > 0; }

      function rowSnapshot(outgoing) {
        var row = outgoing.parent(), nodes = row.children(".single, .dual").not(".disappear").toArray();
        var width = Number(where[0].clientWidth), height = Number(row[0].getBoundingClientRect().height);
        var anchor = nodes.indexOf(outgoing[0]), valid = anchor >= 0 && positive(width) && positive(height);
        var widths = [], groups = nodes.map(function(node) {
          var box = $(node), type = box.hasClass("dual") ? "dual" : "single";
          var leaves = type === "dual" ? box.children("div") : box;
          var ratios = leaves.map(function() {
            var leaf = $(this), w = leaf.data("st-natural-width"), h = leaf.data("st-natural-height");
            var request = leaf.data("st-image-request");
            if(!positive(w) || !positive(h) || !positive(w / h) || !leaf.data("st-photo-url") ||
              (request && request !== leaf.data("st-image-loaded-request"))) valid = false;
            return w / h;
          }).toArray();
          var w = measure(box).width;
          if(!positive(w) || w <= BORDER || ratios.length !== (type === "dual" ? 2 : 1)) valid = false;
          widths.push(w);
          return {type: type, ratios: ratios};
        });
        var total = widths.reduce(function(sum, w) { return sum + w; }, 0);
        // clientWidth is integer-valued, while CSS boxes are subpixel-valued
        // (commonly quantized to 1/64px). Reconcile at most one CSS pixel at
        // the anchor, not by scaling every block or loosening the pure API.
        var anchorWidth = widths[anchor];
        if(!positive(total) || Math.abs(total - width) > 1 || height <= BORDER + GAP) valid = false;
        if(valid) {
          widths[anchor] = width - widths.reduce(function(sum, w, index) {
            return sum + (index === anchor ? 0 : w);
          }, 0);
          if(!positive(widths[anchor]) || widths[anchor] <= BORDER) valid = false;
        }
        return valid ? {row: row, nodes: nodes, groups: groups, widths: widths, width: width,
          height: height, anchor: anchor, anchorWidth: anchorWidth} : null;
      }

      function candidate(snapshot, slots, count) {
        var groups = snapshot.groups.map(function(g) { return {type: g.type, ratios: g.ratios.slice()}; });
        groups[snapshot.anchor] = {type: count === 2 ? "dual" : "single", ratios: slots.slice(0, count).map(function(slot) {
          return slot.width / slot.height;
        })};
        var fit = window.ShiftingTilesLayout.refitRow(groups, snapshot.width, snapshot.height, snapshot.widths,
          {anchorIndex: snapshot.anchor, maxNeighbors: 1});
        var material = fit.gain + 1e-12 >= adaptive.minGain;
        return {count: count, fit: fit, material: material,
          coverage: material ? fit.coverage : fit.baselineCoverage};
      }

      function usefulCandidate(entry, snapshot) {
        var g = entry.fit.groups[snapshot.anchor];
        var w = entry.material ? g.width : snapshot.widths[snapshot.anchor];
        return w - BORDER >= dynamic.minTileWidth && g.childHeights.every(function(h, index) {
          return h - (index ? GAP : 0) >= dynamic.minTileHeight;
        });
      }

      function selectAdaptive(transaction) {
        if(!transaction.slots.every(function(slot) {
          return positive(slot.width) && positive(slot.height) && positive(slot.width / slot.height);
        })) return null;
        var snapshot = rowSnapshot(transaction.outgoing);
        if(transaction.structuralEligible && transaction.normalCount === 1 &&
          transaction.slots.length === 2 && !canSplit(transaction.outgoing)) return null;
        // Missing/invalid geometry keeps the normal type (and its queue invariants),
        // never a speculative structural change based on stale measurements.
        if(!snapshot) {
          if(transaction.slots.length !== transaction.normalCount) return null;
          return {count: transaction.normalCount, snapshot: null, fit: null, apply: false};
        }
        try {
          var normal = candidate(snapshot, transaction.slots, transaction.normalCount), chosen = normal;
          var alternate = transaction.normalCount === 2 ? 1 : 2;
          if(transaction.structuralEligible && transaction.slots.length >= alternate &&
            (alternate === 2 ? canSplit(transaction.outgoing) : rowCount(transaction.outgoing) > 4)) {
            var structural = candidate(snapshot, transaction.slots, alternate);
            if(usefulCandidate(structural, snapshot) &&
              structural.coverage - normal.coverage + 1e-12 >= adaptive.minGain &&
              structural.fit.coverage + 1e-12 >= normal.coverage) chosen = structural;
          }
          var changed = chosen.count !== (transaction.outgoing.hasClass("dual") ? 2 : 1);
          // A forced one-photo merge is allowed for the last pending URL, but
          // does not bypass positive geometry or the four-photo row minimum.
          if(changed && (rowCount(transaction.outgoing) + chosen.count -
            (transaction.outgoing.hasClass("dual") ? 2 : 1) < 4 ||
            (transaction.structuralEligible && !usefulCandidate(chosen, snapshot)))) return null;
          return {count: chosen.count, snapshot: snapshot, fit: chosen.fit,
            apply: chosen.material || changed, structuralGain: chosen.coverage - normal.coverage};
        } catch(error) {
          return null;
        }
      }

      function applyLocalFit(selection, outgoing, incoming) {
        if(!selection || !selection.apply || !selection.snapshot) return;
        var snapshot = selection.snapshot, fit = selection.fit;
        var oldWidth = (snapshot.anchorWidth / snapshot.width * 50) + "%";
        // The disappearing box must keep its OLD keyframe width.
        outgoing[0].style.setProperty("--st-start-width", oldWidth);
        where.addClass("gallery-balanced gallery-fitting");
        // Establish the inserted clone's old width before setting its target,
        // so its CSS transition has a start value just like existing neighbors.
        incoming[0].getBoundingClientRect();
        var start = fit.localRange[0], end = fit.localRange[1];
        for(var i = start; i <= end; i++) {
          var node = i === snapshot.anchor ? incoming[0] : snapshot.nodes[i], group = fit.groups[i];
          var width = (group.width / snapshot.width * 50) + "%";
          node.style.setProperty("--st-box-width", width);
          node.style.setProperty("--st-start-width", width);
          if(group.type === "dual") $(node).children("div").each(function(index) {
            this.style.height = (group.childHeights[index] / (snapshot.height - BORDER) * 100) + "%";
          });
        }
        localFits++;
        lastLocalFit = {coverage: fit.coverage, baselineCoverage: fit.baselineCoverage, gain: fit.gain,
          structuralGain: selection.structuralGain, localRange: fit.localRange.slice(), anchorIndex: snapshot.anchor};
      }

      function rowPhotoCounts() {
        return where.children(".row").map(function() {
          var count = 0;
          $(this).children(".single, .dual").not(".disappear").each(function() {
            count += $(this).hasClass("dual") ? 2 : 1;
          });
          return count;
        }).toArray();
      }

      function rowCount(box) {
        var count = 0;
        box.parent().children(".single, .dual").not(".disappear").each(function() {
          count += $(this).hasClass("dual") ? 2 : 1;
        });
        return count;
      }

      function measure(box) {
        var bounds = box[0].getBoundingClientRect();
        return {width: Number(bounds.width) || box.outerWidth(),
          height: Number(bounds.height) || box.outerHeight()};
      }

      function canSplit(box) {
        var size = measure(box), total = visibleURLs().length;
        // Keep two spare URLs AFTER growing, not merely enough for this preload.
        // Thus albums of 8/9/10 keep the original eight-photo composition.
        return rowCount(box) < 6 && queue.stats().albumSize - (total + 1) >= 2 &&
          size.width - BORDER >= dynamic.minTileWidth && size.height - BORDER - GAP >= 2 * dynamic.minTileHeight;
      }

      function duoHeights(size, slots) {
        var usable = size.height - BORDER - GAP;
        var firstWeight = slots[0].height / slots[0].width;
        var secondWeight = slots[1].height / slots[1].width;
        var first = usable * firstWeight / (firstWeight + secondWeight);
        // The second CSS border-box includes the two-pixel separator.
        return [first, usable - first + GAP];
      }

      function clearPhotoData(element) {
        element.css("background-image", "none")
          .removeData("st-photo-url").removeData("st-natural-width").removeData("st-natural-height")
          .removeData("st-image-request").removeData("st-image-loaded-request");
      }

      function prepareIncoming(transaction) {
        var outgoing = transaction.outgoing, incoming = outgoing.clone();
        if(!dynamic.enabled && !transaction.adaptive) return incoming;
        var count = transaction.slots.length, size = measure(outgoing);
        var changed = transaction.structureChange;
        if(changed && (rowCount(outgoing) + (count === 2 ? 1 : -1) < 4 ||
          rowCount(outgoing) + (count === 2 ? 1 : -1) > 6)) return null;
        var heights = count === 2 ? duoHeights(size, transaction.slots) : null;
        if(changed && count === 2 && (!canSplit(outgoing) ||
          ((!transaction.selection || !transaction.selection.apply) &&
            (heights[0] < dynamic.minTileHeight || heights[1] - GAP < dynamic.minTileHeight)))) return null;
        if(changed) {
          clearPhotoData(incoming);
          incoming.empty().removeClass("single dual").addClass(count === 2 ? "dual" : "single");
          if(count === 2) incoming.append("<div></div><div></div>");
          // clone() preserves custom properties; only supply missing geometry.
          var parentWidth = outgoing.parent()[0].getBoundingClientRect().width || outgoing.parent().width();
          var width = parentWidth > 0 ? (size.width / parentWidth * 100) + "%" : size.width + "px";
          ["--st-box-width", "--st-start-width"].forEach(function(property) {
            if(!incoming[0].style.getPropertyValue(property)) incoming[0].style.setProperty(property, width);
          });
          incoming[0].style.width = "var(--st-box-width)";
        }
        if(heights && size.height > BORDER + GAP) incoming.children("div").each(function(index) {
          this.style.height = (heights[index] / (size.height - BORDER) * 100) + "%";
        });
        return incoming;
      }

      function updateMembers(nextImages) {
        members = Object.create(null);
        (Array.isArray(nextImages) ? nextImages : []).forEach(function(url) {
          if(typeof url === "string" && url.trim()) members[url.trim()] = true;
        });
      }
      updateMembers(images);

      function visibleURLs() {
        var urls = [];
        // Outgoing tiles remain excluded until their animation actually finishes.
        where.find(photoSelector).each(function() {
          var url = $(this).data("st-photo-url");
          if(url) urls.push(url);
        });
        return urls;
      }

      function reserve(count, extraExcluded) {
        var before = queue.stats().cycle;
        var urls = queue.reserve(count, visibleURLs().concat(extraExcluded || []));
        if(queue.stats().cycle !== before) where.trigger("st-galleryrestart");
        return urls;
      }

      function acknowledgeHeldPhotos() {
        // A small album cannot atomically replace a Duo with only one spare.
        // When no unseen offscreen photo remains, photos continuously visible
        // from the previous turn have already been displayed in this turn too.
        // Acknowledge those through AlbumQueue (no Image/HTTP and no duplicate),
        // so that they cannot prevent the next complete turn indefinitely.
        var state = queue.stats(), acknowledged = 0;
        if(state.albumSize <= visibleURLs().length || state.seenCount + state.failedCount === state.albumSize) return false;
        var all = Object.keys(members);
        visibleURLs().forEach(function(url) {
          var currentState = queue.stats();
          if(currentState.seenCount + currentState.failedCount === currentState.albumSize) return;
          var held = queue.reserve(1, all.filter(function(member) { return member !== url; }));
          if(held.length && queue.commit(held[0])) acknowledged++;
        });
        return acknowledged > 0;
      }

      function clearTimer() {
        if(timeout !== null) clearTimeout(timeout);
        timeout = null;
      }

      function schedule() {
        if(destroyed || document.hidden || queue.stats().albumSize < 8 || timeout !== null) return;
        timeout = setTimeout(function() {
          timeout = null;
          frame();
          schedule();
        }, duration);
      }

      function cleanRequest(slot) {
        if(slot.deadline !== null) clearTimeout(slot.deadline);
        slot.deadline = null;
        if(slot.image) slot.image.onload = slot.image.onerror = null;
      }

      function cancelPending() {
        if(!pending) return;
        var transaction = pending;
        pending = null;
        transaction.cancelled = true;
        transaction.slots.forEach(function(slot) {
          cleanRequest(slot);
          queue.release(slot.url);
        });
        // A pending resize must resume even if no image/animation will finish.
        where.trigger("st-preload-cancelled");
      }

      function current(transaction) {
        return !destroyed && !transaction.cancelled && pending === transaction &&
          transaction.generation === generation;
      }

      function setPhoto(element, slot) {
        element.css("background-image", "url(" + JSON.stringify(slot.url) + ")");
        element.data("st-photo-url", slot.url);
        element.data("st-natural-width", slot.width);
        element.data("st-natural-height", slot.height);
        element.data("st-image-request", slot.marker);
        element.data("st-image-loaded-request", slot.marker);
      }

      function imageReady(element, slot) {
        where.trigger("st-image-ready", [element, slot.url]);
      }

      function completeInitial(transaction) {
        if(!current(transaction) || !transaction.slots.every(function(slot) { return slot.settled; })) return;
        pending = null;
        var loaded = where.find(photoSelector).filter(function() {
          return !!$(this).data("st-photo-url");
        }).length;
        if(loaded === 8 && !initialReady) {
          initialReady = true;
          where.find(".loading").remove();
          where.css("visibility", "");
          where.trigger("st-initial-ready");
        }
        schedule();
      }

      function activate(transaction) {
        if(!current(transaction) || transaction.kind !== "transition" ||
          !transaction.slots.every(function(slot) { return slot.loaded; }) || document.hidden || active) return;
        if(transaction.adaptive && (where.hasClass("leave") || where.hasClass("left"))) {
          cancelPending();
          return;
        }
        // Clone only after preload. Its old backgrounds are overwritten while detached.
        var outgoing = transaction.outgoing;
        if(!outgoing.parent().length) {
          cancelPending();
          schedule();
          return;
        }
        where.trigger("st-animate-before", outgoing);
        if(!current(transaction) || document.hidden) return;
        if(transaction.adaptive && (where.hasClass("leave") || where.hasClass("left"))) {
          cancelPending();
          schedule();
          return;
        }
        if(transaction.adaptive) {
          // Re-read current canvas, row and ratios after ALL loads and callbacks.
          transaction.selection = selectAdaptive(transaction);
          if(!transaction.selection) {
            cancelPending();
            schedule();
            return;
          }
          if(transaction.selection.count < transaction.slots.length) {
            transaction.slots.splice(transaction.selection.count).forEach(function(slot) {
              cleanRequest(slot);
              queue.release(slot.url); // Never commit a successfully preloaded but unused photo.
            });
          }
          transaction.structureChange = transaction.slots.length !== (outgoing.hasClass("dual") ? 2 : 1);
        }
        var incoming = prepareIncoming(transaction);
        if(!incoming) {
          cancelPending();
          schedule();
          return;
        }
        var photos = incoming.hasClass("single") ? incoming : incoming.children();
        photos.each(function(index) { setPhoto($(this), transaction.slots[index]); });
        transaction.slots.forEach(function(slot) { queue.commit(slot.url); });
        pending = null;
        active = {outgoing: outgoing, incoming: incoming, structureChange: transaction.structureChange};
        if(dynamic.enabled || transaction.adaptive) incoming.insertAfter(outgoing);
        else outgoing.parent().append(incoming);
        outgoing.addClass("disappear");
        applyLocalFit(transaction.selection, outgoing, incoming);
        photos.each(function(index) { imageReady($(this), transaction.slots[index]); });
        where.trigger("st-animate", outgoing);
        schedule();
      }

      function loadSlot(transaction, slot) {
        if(!current(transaction) || !slot.url) return;
        slot.attempts++;
        slot.marker = {url: slot.url, generation: generation, attempt: slot.attempts};
        var marker = slot.marker, image = new Image(), finished = false;
        slot.image = image;
        slot.deadline = setTimeout(failed, 20000);

        function valid() {
          return !finished && current(transaction) && slot.marker === marker && !!members[slot.url];
        }
        function cleanup() {
          finished = true;
          cleanRequest(slot);
        }
        function failed() {
          if(!valid()) return;
          cleanup();
          queue.fail(slot.url);
          transaction.failedURLs.push(slot.url);
          if(transaction.structureChange || (transaction.adaptive && transaction.kind === "transition")) {
            // Structural changes are atomic: any failure retains the old type,
            // URLs and geometry, including a sibling that already loaded.
            cancelPending();
            schedule();
            return;
          }
          if(slot.attempts < 3) {
            var replacement = reserve(1, transaction.failedURLs);
            if(replacement.length) {
              slot.url = replacement[0];
              loadSlot(transaction, slot);
              return;
            }
          }
          slot.settled = true;
          if(transaction.kind === "initial") {
            completeInitial(transaction);
          } else {
            // No partial Duo and no foreign-library fallback: keep the previous block.
            cancelPending();
            schedule();
          }
        }
        image.onload = function() {
          if(!valid()) return;
          cleanup();
          slot.width = Number(image.naturalWidth || image.width) || 1;
          slot.height = Number(image.naturalHeight || image.height) || 1;
          slot.loaded = slot.settled = true;
          if(transaction.kind === "initial") {
            setPhoto(slot.element, slot);
            queue.commit(slot.url);
            imageReady(slot.element, slot);
            completeInitial(transaction);
          } else {
            activate(transaction);
          }
        };
        image.onerror = failed;
        image.src = slot.url;
      }

      function startTransaction(kind, urls, elements, outgoing, adaptiveContext) {
        var transaction = {
          kind: kind, generation: generation, cancelled: false, outgoing: outgoing,
          structureChange: kind === "transition" && outgoing &&
            urls.length !== (outgoing.hasClass("dual") ? 2 : 1),
          adaptive: !!adaptiveContext,
          normalCount: adaptiveContext && adaptiveContext.normalCount,
          structuralEligible: adaptiveContext && adaptiveContext.structuralEligible,
          failedURLs: [],
          slots: urls.map(function(url, index) {
            return {url: url, element: elements ? $(elements[index]) : null,
              attempts: 0, deadline: null, image: null, loaded: false, settled: false};
          })
        };
        pending = transaction;
        transaction.slots.forEach(function(slot) {
          if(current(transaction)) loadSlot(transaction, slot);
        });
      }

      function setupRows() {
        if(where.children(".row").length) return;
        where.addClass("shiftingtiles");
        for(var i = 0; i < 2; i++) {
          where.prepend("<div class='row'><div class='single'></div><div class='single'></div><div class='dual'><div></div><div></div></div></div>");
        }
        where.append("<div class='loading'>Loading Photos...</div>");
      }

      function fillInitial() {
        if(pending || active || queue.stats().albumSize < 8) return false;
        setupRows();
        var empty = where.find(photoSelector).filter(function() { return !$(this).data("st-photo-url"); });
        if(!empty.length) return false;
        var urls = reserve(empty.length);
        if(!urls.length) return false;
        where.css("visibility", "hidden");
        startTransaction("initial", urls, empty.toArray());
        return true;
      }

      function frame() {
        if(destroyed || document.hidden || pending || active || queue.stats().albumSize < 8) return false;
        if(adaptive.enabled && (where.hasClass("leave") || where.hasClass("left"))) return false;
        if(!initialReady) {
          var filling = fillInitial();
          schedule();
          return filling;
        }
        var useAdaptive = !!adaptiveAvailable();
        var boxes = dynamic.enabled || useAdaptive ? where.children(".row").children(".single, .dual").not(".disappear") :
          where.find(".single:not(:last-child), .dual:not(:last-child)");
        if(!boxes.length) return false;
        var outgoing = $(boxes.get(Math.floor(Math.random() * boxes.length)));
        var count = outgoing.hasClass("dual") ? 2 : 1;
        var normalCount = count, eligible = false;
        if(dynamic.enabled && completedSinceChange >= dynamic.minTransitionsBetweenChanges &&
          Math.random() < dynamic.probability) {
          if(count === 1 && canSplit(outgoing)) { count = 2; eligible = true; }
          else if(count === 2 && rowCount(outgoing) > 4) { eligible = true; if(!useAdaptive) count = 1; }
        }
        var urls = reserve(count);
        if(!urls.length && useAdaptive && normalCount === 1 && count === 2) {
          // Only one unseen URL remains: replace the Single normally, without
          // abandoning it simply because an optional split could not reserve two.
          urls = reserve(1);
          eligible = false;
        }
        if(!urls.length && count === 2) {
          // Nine photos, or the last unused URL of a cycle, require a Single.
          var singles = boxes.filter(".single");
          if(singles.length) outgoing = $(singles.get(Math.floor(Math.random() * singles.length)));
          else if(dynamic.enabled) {
            // Splits can remove every Single, but always leave a recovery Duo
            // in a row above four. This one-photo entry completes odd cycles.
            var mergeable = boxes.filter(".dual").filter(function() { return rowCount($(this)) > 4; });
            if(!mergeable.length) return false;
            outgoing = $(mergeable.get(Math.floor(Math.random() * mergeable.length)));
          } else return false;
          urls = reserve(1);
          normalCount = 1;
          eligible = false;
        }
        if(!urls.length && (dynamic.enabled || useAdaptive) && acknowledgeHeldPhotos()) return frame();
        if(!urls.length) return false;
        clearTimer();
        startTransaction("transition", urls, null, outgoing, useAdaptive ?
          {normalCount: normalCount, structuralEligible: eligible} : null);
        schedule();
        return true;
      }

      function finishAnimation() {
        where.removeClass("gallery-fitting");
        if(!active) return;
        var outgoing = active.outgoing;
        if(active.structureChange) {
          structureChanges++;
          completedSinceChange = 0;
        } else completedSinceChange++;
        active = null;
        outgoing.css("display", "none").remove();
        where.trigger("st-animate-after");
        schedule();
      }

      function clearPhotos() {
        finishAnimation();
        where.find(photoSelector).each(function() {
          clearPhotoData($(this));
        });
        initialReady = false;
      }

      function update(event, nextImages) {
        nextImages = Array.isArray(nextImages) ? nextImages : [];
        queue.setImages(nextImages);
        updateMembers(nextImages);
        if(dynamic.enabled || adaptive.enabled) {
          var visible = visibleURLs(), stableCount = rowPhotoCounts().reduce(function(sum, count) { return sum + count; }, 0);
          var foreign = visible.some(function(url) { return !members[url]; });
          // If a smaller source cannot support this topology with spare URLs,
          // reset only when necessary. A normal refresh retains queue history.
          if(foreign || (stableCount > 8 && queue.stats().albumSize - stableCount < 2) ||
            (queue.stats().albumSize < 8 && stableCount)) {
            generation++;
            cancelPending();
            clearTimer();
            clearPhotos();
            where.children(".row").remove();
            where.children(".loading").remove();
            queue = window.ShiftingTilesAlbumQueue.create(nextImages);
            completedSinceChange = dynamic.minTransitionsBetweenChanges;
          }
        }
        if(!queue.stats().albumSize) {
          generation++;
          cancelPending();
          clearTimer();
          clearPhotos();
          return;
        }
        if(pending && pending.slots.some(function(slot) { return !members[slot.url]; })) cancelPending();
        if(!initialReady && !pending && !active) fillInitial();
        schedule();
      }

      function destroy() {
        if(destroyed) return;
        destroyed = true;
        generation++;
        clearTimer();
        cancelPending();
        finishAnimation();
        where.off(namespace);
        $(document).off(namespace);
        $(document.body).off(namespace);
        where.removeData("shiftingtiles-playback");
      }

      where.data("shiftingtiles-playback", {
        stats: function() {
          var state = queue.stats();
          state.visibleURLs = visibleURLs();
          state.loading = !!pending;
          state.animating = !!active;
          state.rowPhotoCounts = rowPhotoCounts();
          state.structureChanges = structureChanges;
          state.dynamicRowsEnabled = dynamic.enabled;
          state.adaptiveLayoutEnabled = adaptive.enabled;
          state.localFits = localFits;
          if(lastLocalFit) state.lastLocalFit = $.extend({}, lastLocalFit, {localRange: lastLocalFit.localRange.slice()});
          return state;
        },
        frame: frame,
        destroy: destroy
      });
      where.on("st-photos-update" + namespace, update);
      where.on("animationend" + namespace + " webkitAnimationEnd" + namespace + " oAnimationEnd" + namespace,
        ".leave > .row", function() { $(this).parent().addClass("left").removeClass("leave"); });
      where.on("animationend" + namespace + " webkitAnimationEnd" + namespace + " oAnimationEnd" + namespace,
        ".disappear", function(event) {
          if(active && active.outgoing[0] === this) {
            finishAnimation();
            event.stopPropagation();
          }
        });
      $(document.body).on("keydown" + namespace, function(event) {
        if(event.keyCode === 32) {
          frame();
          event.preventDefault();
          return false;
        }
        if(event.keyCode === 38) {
          where.toggleClass("leave");
          if(adaptive.enabled) {
            cancelPending();
            finishAnimation();
            where.removeClass("gallery-fitting");
          }
        }
      });
      $(document).on("visibilitychange" + namespace, function() {
        if(document.hidden) {
          clearTimer();
          finishAnimation();
        } else {
          if(pending && pending.kind === "transition") activate(pending);
          schedule();
        }
      });
      fillInitial();
      schedule();
    });
  };
})(jQuery);

if (!Array.prototype.reduce) {
  Array.prototype.reduce = function reduce(accumulator) {
    if(this === null || this === undefined) throw new TypeError("Object is null or undefined");
    var i = 0, l = this.length >> 0, curr;
    if(typeof accumulator !== "function") throw new TypeError("First argument is not callable");
    if(arguments.length < 2) {
      if(l === 0) throw new TypeError("Array length is 0 and no second argument");
      curr = this[0];
      i = 1;
    } else {
      curr = arguments[1];
    }
    while(i < l) {
      if(i in this) curr = accumulator.call(undefined, curr, this[i], i, this);
      ++i;
    }
    return curr;
  };
}
