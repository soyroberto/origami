(function($) {
  "use strict";
  var instanceNumber = 0;

  $.fn.shiftingtiles = function(images, options) {
    var settings = $.extend({photosource: images, duration: 5000, fallbackPhotos: [], aspectSelection: false}, options);
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
      var aspectSelection = settings.aspectSelection === true;
      var aspectCache = Object.create(null), cacheOrder = [], deferred = Object.create(null);
      var aspectCycle = queue.stats().cycle;
      dynamic.enabled = dynamic.enabled === true;
      dynamic.probability = Math.max(0, Math.min(1, Number(dynamic.probability) || 0));
      dynamic.minTransitionsBetweenChanges = Math.max(0, Math.floor(Number(dynamic.minTransitionsBetweenChanges) || 0));
      dynamic.minTileWidth = Number(dynamic.minTileWidth) > 0 ? Number(dynamic.minTileWidth) : 160;
      dynamic.minTileHeight = Number(dynamic.minTileHeight) > 0 ? Number(dynamic.minTileHeight) : 100;
      var structureChanges = 0, completedSinceChange = dynamic.minTransitionsBetweenChanges;

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
          size.width - 10 >= dynamic.minTileWidth && size.height - 20 >= 2 * dynamic.minTileHeight;
      }

      function duoHeights(size, slots) {
        var usable = size.height - 20;
        if(where.hasClass('gallery-modular')) return [usable / 2, usable / 2 + 10];
        var firstWeight = slots[0].height / slots[0].width;
        var secondWeight = slots[1].height / slots[1].width;
        var first = usable * firstWeight / (firstWeight + secondWeight);
        // The second CSS border-box includes the existing ten-pixel separator.
        return [first, usable - first + 10];
      }

      function clearPhotoData(element) {
        element.css("background-image", "none")
          .removeData("st-photo-url").removeData("st-natural-width").removeData("st-natural-height")
          .removeData("st-image-request").removeData("st-image-loaded-request");
      }

      function prepareIncoming(transaction) {
        var outgoing = transaction.outgoing, incoming = outgoing.clone();
        if(!dynamic.enabled) return incoming;
        var count = transaction.slots.length, size = measure(outgoing);
        var changed = transaction.structureChange;
        if(changed && (rowCount(outgoing) + (count === 2 ? 1 : -1) < 4 ||
          rowCount(outgoing) + (count === 2 ? 1 : -1) > 6)) return null;
        var heights = count === 2 ? duoHeights(size, transaction.slots) : null;
        if(changed && count === 2 && (!canSplit(outgoing) ||
          heights[0] < dynamic.minTileHeight || heights[1] - 10 < dynamic.minTileHeight)) return null;
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
        if(heights && size.height > 20) incoming.children("div").each(function(index) {
          this.style.height = where.hasClass('gallery-modular') ?
            (index ? 'calc(50% + 5px)' : 'calc(50% - 5px)') : (heights[index] / (size.height - 10) * 100) + "%";
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

      function reserveAspect(count) {
        var before = queue.stats().cycle;
        var urls = queue.reserveCandidates(count, Math.min(6, count * 3), visibleURLs());
        if(queue.stats().cycle !== aspectCycle) {
          deferred = Object.create(null);
          aspectCycle = queue.stats().cycle;
        }
        if(queue.stats().cycle !== before) where.trigger("st-galleryrestart");
        // A Duo→Single decision has fewer seats: candidates already at their
        // deadline wait outside this decision rather than accruing a fourth
        // deferral behind another forced photo.
        var admitted = [];
        urls.sort(function(a, b) { return (deferred[b] || 0) - (deferred[a] || 0); });
        urls.forEach(function(url) {
          if(admitted.length + 1 <= count * (4 - (deferred[url] || 0))) admitted.push(url);
          else queue.release(url);
        });
        return admitted;
      }

      function rememberAspect(slot) {
        if(!aspectSelection) return;
        var index = cacheOrder.indexOf(slot.url);
        if(index !== -1) cacheOrder.splice(index, 1);
        // Metadata only, not a growing collection of decoded Image objects.
        aspectCache[slot.url] = {width: slot.width, height: slot.height};
        cacheOrder.push(slot.url);
        while(cacheOrder.length > 64) delete aspectCache[cacheOrder.shift()];
      }

      function selectAspect(transaction) {
        if(!current(transaction) || transaction.selectionReady ||
          !transaction.candidates.every(function(slot) { return slot.settled; })) return;
        var loaded = transaction.candidates.filter(function(slot) { return slot.loaded || slot.cached; });
        var count = transaction.targetCount;
        if(loaded.length < count) { cancelPending(); schedule(); return; }
        // EDF feasibility: reserve enough seats NOW that every examined photo
        // can be shown after at most three eligible deferrals, not just one of
        // several overdue photos. Single examines 3, Duo at most 6.
        var oldest = loaded.slice().sort(function(a, b) {
          return (deferred[b.url] || 0) - (deferred[a.url] || 0) ||
            transaction.candidates.indexOf(a) - transaction.candidates.indexOf(b);
        });
        function required(seats) {
          var n = 0;
          oldest.forEach(function(slot, index) {
            n = Math.max(n, index + 1 - seats * (3 - (deferred[slot.url] || 0)));
          });
          return oldest.slice(0, Math.min(seats, n));
        }
        var size = measure(transaction.outgoing), modular = where.hasClass('gallery-modular');
        var width = Math.max(1, size.width - 10), height = Math.max(1, size.height - 10);
        function mismatch(ratio, target) { return Math.abs(Math.log(ratio / target)); }
        function score(slots) {
          if(slots.length === 1) return mismatch(slots[0].width / slots[0].height, width / height);
          var heights = duoHeights(size, slots);
          if(transaction.structureChange && (heights[0] < dynamic.minTileHeight ||
            heights[1] - 10 < dynamic.minTileHeight)) return Infinity;
          if(!modular) {
            // Natural Duo has ONE shared width and inverse-aspect heights.
            // Compare its joint footprint, not the old/fixed 50/50 leaves.
            var naturalWidth = Math.max(1, size.height - 20) /
              (slots[0].height / slots[0].width + slots[1].height / slots[1].width);
            return mismatch(naturalWidth, width);
          }
          return mismatch(slots[0].width / slots[0].height, width / Math.max(1, heights[0])) +
            mismatch(slots[1].width / slots[1].height, width / Math.max(1, heights[1] - 10));
        }
        function best(seats) {
          var forced = required(seats), result = null, lowest = Infinity;
          function consider(slots) {
            if(!forced.every(function(slot) { return slots.indexOf(slot) !== -1; })) return;
            var value = score(slots);
            if(value < lowest) { lowest = value; result = slots; }
          }
          loaded.forEach(function(a) {
            if(seats === 1) consider([a]);
            else loaded.forEach(function(b) { if(a !== b) consider([a, b]); });
          });
          return result;
        }
        var chosen = best(count);
        if(!chosen && transaction.structureChange && transaction.outgoing.hasClass('single')) {
          // Extreme ratios must not be trapped in an impossible split forever.
          count = 1;
          chosen = best(count);
          // The 6-candidate split pool exceeds a Single's fairness capacity.
          // Unchosen candidates cannot fit this attempted structural change;
          // do not age them for a decision in which they were not eligible.
          chosen = [oldest[0]];
          transaction.eligible = chosen;
          transaction.structureChange = false;
        }
        if(!chosen) { cancelPending(); schedule(); return; }
        transaction.eligible = transaction.eligible || loaded;
        transaction.slots = chosen;
        transaction.candidates.forEach(function(slot) {
          if(chosen.indexOf(slot) === -1) queue.release(slot.url);
        });
        transaction.selectionReady = true;
        // Metadata is NOT proof of a current preload. Cached winners still
        // need a fresh Image/onload/marker before atomic activation. Each URL
        // therefore starts at most one Image in this transaction (<= 6).
        chosen.forEach(function(slot) {
          if(!slot.loaded && current(transaction)) {
            slot.settled = false;
            loadSlot(transaction, slot);
          }
        });
        activate(transaction);
      }

      function pumpAspect(transaction) {
        if(!current(transaction)) return;
        var running = transaction.candidates.filter(function(slot) { return slot.image && !slot.settled; }).length;
        transaction.candidates.forEach(function(slot) {
          if(running >= 2 || slot.started || !current(transaction)) return;
          slot.started = true;
          var cached = aspectCache[slot.url];
          if(cached) {
            slot.width = cached.width; slot.height = cached.height;
            slot.cached = slot.settled = true;
          } else {
            running++;
            loadSlot(transaction, slot);
          }
        });
        selectAspect(transaction);
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
        (transaction.candidates || transaction.slots).forEach(function(slot) {
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
          (transaction.candidates && !transaction.selectionReady) ||
          !transaction.slots.every(function(slot) { return slot.loaded; }) || document.hidden || active) return;
        // Clone only after preload. Its old backgrounds are overwritten while detached.
        var outgoing = transaction.outgoing;
        if(!outgoing.parent().length) {
          cancelPending();
          schedule();
          return;
        }
        var incoming = prepareIncoming(transaction);
        if(!incoming) {
          cancelPending();
          schedule();
          return;
        }
        where.trigger("st-animate-before", outgoing);
        if(!current(transaction) || document.hidden) return;
        var photos = incoming.hasClass("single") ? incoming : incoming.children();
        photos.each(function(index) { setPhoto($(this), transaction.slots[index]); });
        if(transaction.candidates) transaction.eligible.forEach(function(slot) {
          if(transaction.slots.indexOf(slot) !== -1) delete deferred[slot.url];
          else deferred[slot.url] = (deferred[slot.url] || 0) + 1;
        });
        transaction.slots.forEach(function(slot) { queue.commit(slot.url); });
        pending = null;
        active = {outgoing: outgoing, incoming: incoming, structureChange: transaction.structureChange};
        if(dynamic.enabled) incoming.insertAfter(outgoing);
        else outgoing.parent().append(incoming);
        outgoing.addClass("disappear");
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
          if(transaction.candidates) {
            delete aspectCache[slot.url];
            delete deferred[slot.url];
            slot.cached = false;
            slot.settled = true;
            if(transaction.structureChange || transaction.selectionReady) { cancelPending(); schedule(); }
            else pumpAspect(transaction);
            return;
          }
          if(transaction.structureChange) {
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
          rememberAspect(slot);
          if(transaction.candidates) {
            if(transaction.selectionReady) activate(transaction);
            else pumpAspect(transaction);
            return;
          }
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

      function startTransaction(kind, urls, elements, outgoing, targetCount) {
        var transaction = {
          kind: kind, generation: generation, cancelled: false, outgoing: outgoing,
          structureChange: kind === "transition" && outgoing &&
            (targetCount || urls.length) !== (outgoing.hasClass("dual") ? 2 : 1),
          failedURLs: [],
          slots: urls.map(function(url, index) {
            return {url: url, element: elements ? $(elements[index]) : null,
              attempts: 0, deadline: null, image: null, loaded: false, settled: false};
          })
        };
        pending = transaction;
        if(aspectSelection && kind === "transition") {
          transaction.candidates = transaction.slots.slice();
          transaction.targetCount = targetCount;
          pumpAspect(transaction);
          return;
        }
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
        if(!initialReady) {
          var filling = fillInitial();
          schedule();
          return filling;
        }
        var boxes = dynamic.enabled ? where.children(".row").children(".single, .dual").not(".disappear") :
          where.find(".single:not(:last-child), .dual:not(:last-child)");
        if(!boxes.length) return false;
        var outgoing = $(boxes.get(Math.floor(Math.random() * boxes.length)));
        var count = outgoing.hasClass("dual") ? 2 : 1;
        if(dynamic.enabled && completedSinceChange >= dynamic.minTransitionsBetweenChanges &&
          Math.random() < dynamic.probability) {
          if(count === 1 && canSplit(outgoing)) count = 2;
          else if(count === 2 && rowCount(outgoing) > 4) count = 1;
        }
        var urls = aspectSelection ? reserveAspect(count) : reserve(count);
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
          count = 1;
          urls = aspectSelection ? reserveAspect(1) : reserve(1);
        }
        if(!urls.length && dynamic.enabled && acknowledgeHeldPhotos()) return frame();
        if(!urls.length) return false;
        clearTimer();
        startTransaction("transition", urls, null, outgoing, count);
        schedule();
        return true;
      }

      function finishAnimation() {
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
        // The cold Spotify fallback may still be loading when its manifest arrives.
        // Reset this wholly replaced source even before a foreign photo is visible.
        var resetSource = aspectSelection && nextImages.length > 0 && queue.stats().albumSize > 0 &&
          !nextImages.some(function(url) { return !!members[url]; });
        queue.setImages(nextImages);
        updateMembers(nextImages);
        if(aspectSelection) {
          cacheOrder = cacheOrder.filter(function(url) {
            if(members[url]) return true;
            delete aspectCache[url];
            return false;
          });
          Object.keys(deferred).forEach(function(url) { if(!members[url]) delete deferred[url]; });
        }
        if(dynamic.enabled || aspectSelection) {
          var visible = visibleURLs(), stableCount = rowPhotoCounts().reduce(function(sum, count) { return sum + count; }, 0);
          var foreign = visible.some(function(url) { return !members[url]; });
          // If a smaller source cannot support this topology with spare URLs,
          // reset only when necessary. A normal refresh retains queue history.
          if(foreign || resetSource || (stableCount > 8 && queue.stats().albumSize - stableCount < 2) ||
            (queue.stats().albumSize < 8 && stableCount)) {
            generation++;
            cancelPending();
            clearTimer();
            clearPhotos();
            where.children(".row").remove();
            where.children(".loading").remove();
            queue = window.ShiftingTilesAlbumQueue.create(nextImages);
            if(aspectSelection) {
              deferred = Object.create(null);
              aspectCycle = queue.stats().cycle;
            }
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
        if(pending && (pending.candidates || pending.slots).some(function(slot) { return !members[slot.url]; })) cancelPending();
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
        aspectCache = Object.create(null); cacheOrder = []; deferred = Object.create(null);
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
          if(aspectSelection) {
            state.aspectSelectionEnabled = true;
            state.aspectMetadataEntries = cacheOrder.length;
            state.aspectDeferrals = $.extend({}, deferred);
            state.aspectCandidates = pending && pending.candidates ?
              pending.candidates.map(function(slot) { return slot.url; }) : [];
          }
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
        if(event.keyCode === 38) where.toggleClass("leave");
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
