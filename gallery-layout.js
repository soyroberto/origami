/* Two rows of 4..6 existing photos, contain-only geometry. No DOM, network or timers. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiftingTilesLayout = factory();
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var BORDER = 4, GAP = 4, SHORTLIST = 16, MATERIAL = 0.02, TIE = 1e-12;
  var BOUNDS = { 2: [0.2, 0.8], 3: [0.12, 0.65], 4: [0.12, 0.5] };

  function positive(x) { return typeof x === 'number' && isFinite(x) && x > 0; }
  function sum(values) { return values.reduce(function (a, b) { return a + b; }, 0); }
  function logAdd(a, b) {
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return hi + Math.log1p(Math.exp(lo - hi));
  }
  function harmonicLog(a, b) {
    var lo = Math.min(a, b), hi = Math.max(a, b);
    return lo - Math.log1p(Math.exp(lo - hi));
  }
  function key(rows) {
    return rows.map(function (row) {
      return row.map(function (g) { return g.type + ':' + g.photoIndices.join(','); }).join('|');
    }).join('/');
  }
  function group(indices) { return { type: indices.length === 1 ? 'single' : 'dual', photoIndices: indices.slice() }; }

  function readInput(rows, width, height) {
    if (!positive(width) || !positive(height) || width <= 2 * BORDER || height <= 2 * (BORDER + GAP)) {
      throw new RangeError('Canvas must exceed 8px width and 16px height for two bordered Duo rows.');
    }
    if (!Array.isArray(rows) || rows.length !== 2) throw new TypeError('Expected two rows.');
    var ratios = [], identity = [];
    rows.forEach(function (row) {
      if (!Array.isArray(row) || row.length < 2 || row.length > 4) throw new TypeError('Expected 2..4 groups per row.');
      var count = 0;
      identity.push(row.map(function (g) {
        if (!g || (g.type !== 'single' && g.type !== 'dual') || !Array.isArray(g.ratios) ||
            g.ratios.length !== (g.type === 'single' ? 1 : 2) || !g.ratios.every(positive)) {
          throw new TypeError('Invalid Single/Duo or natural aspect ratios.');
        }
        var indices = g.ratios.map(function (ratio) { var index = ratios.length; ratios.push(ratio); count++; return index; });
        return group(indices);
      }));
      if (count < 4 || count > 6) throw new TypeError('Each row must contain 4..6 photos.');
    });
    return { ratios: ratios, identity: identity };
  }

  function children(indices, ratios, height) {
    if (indices.length === 1) return [height - BORDER];
    var available = height - BORDER - GAP;
    var a = Math.log(ratios[indices[0]]), b = Math.log(ratios[indices[1]]);
    var first = available * Math.exp(b - logAdd(a, b));
    // Keep both inner boxes representably positive even for subnormal/extreme ratios.
    var epsilon = Math.min(available / 2, Math.max(Number.MIN_VALUE, available * 1e-12, height * Number.EPSILON));
    first = Math.max(epsilon, Math.min(available - epsilon, first));
    return [first, height - BORDER - first]; // second includes its 4px top gap
  }

  function currentRows(current, width, height, ratios) {
    if (!current || !Array.isArray(current.rows) || current.rows.length !== 2) throw new TypeError('Invalid currentLayout rows.');
    var seen = [], oldTotal = 0, photoCount = 0;
    current.rows.forEach(function (row) {
      if (!row || !positive(row.height) || !Array.isArray(row.groups) || row.groups.length < 2 || row.groups.length > 4) {
        throw new TypeError('Invalid currentLayout row.');
      }
      oldTotal += row.height;
      var count = 0;
      row.groups.forEach(function (g) {
        var n = g && g.type === 'single' ? 1 : g && g.type === 'dual' ? 2 : 0;
        var knownHeights = g && g.childHeights != null;
        if (!n || !Array.isArray(g.photoIndices) || g.photoIndices.length !== n || !positive(g.width) ||
            g.width <= BORDER || row.height <= BORDER + (n === 2 ? GAP : 0) ||
            (knownHeights && (!Array.isArray(g.childHeights) || g.childHeights.length !== n || !g.childHeights.every(positive) ||
              (n === 2 && g.childHeights[1] <= GAP)))) throw new TypeError('Invalid currentLayout group geometry.');
        if (knownHeights && Math.abs(sum(g.childHeights) - (row.height - BORDER)) > Math.max(1, row.height) * 1e-8) {
          throw new TypeError('currentLayout children must sum to row height minus 4px.');
        }
        g.photoIndices.forEach(function (index) {
          if (!Number.isInteger(index) || index < 0 || index >= ratios.length || seen[index]) {
            throw new TypeError('currentLayout must use every source index exactly once.');
          }
          seen[index] = true; count++; photoCount++;
        });
      });
      if (count < 4 || count > 6 || !positive(sum(row.groups.map(function (g) { return g.width; })))) throw new TypeError('Invalid currentLayout photo count.');
    });
    if (photoCount !== ratios.length) throw new TypeError('currentLayout must use every source index exactly once.');
    if (!positive(oldTotal)) throw new TypeError('Invalid currentLayout total height.');
    // A previous plan may come from a different canvas. Preserve identity and scale
    // outer widths/row proportions, then preserve the Duo's INNER height split.
    var sameHeight = oldTotal === height;
    var firstHeight = sameHeight ? current.rows[0].height : height * (current.rows[0].height / oldTotal);
    return current.rows.map(function (row, r) {
      var h = r ? height - firstHeight : firstHeight;
      var totalWidth = sum(row.groups.map(function (g) { return g.width; }));
      var sameWidth = Math.abs(totalWidth - width) <= Math.max(1, width) * 1e-12;
      var used = 0;
      var groups = row.groups.map(function (g, index) {
        var w = sameWidth ? g.width : width * (g.width / totalWidth);
        // Preserve the current values verbatim when only summation order changed.
        if (!sameWidth && index === row.groups.length - 1) w = width - used;
        used += w;
        var child;
        if (g.childHeights == null) child = children(g.photoIndices, ratios, h);
        else if (h === row.height) child = g.childHeights.slice();
        else if (g.type === 'single') child = [h - BORDER];
        else {
          var inner = h - BORDER - GAP;
          var proportion = g.childHeights[0] / (row.height - BORDER - GAP);
          child = [inner * proportion, h - BORDER - inner * proportion];
        }
        if (w <= BORDER || child[0] <= 0 || (g.type === 'dual' && child[1] <= GAP)) {
          throw new RangeError('currentLayout cannot fit positive bordered photo boxes on this canvas.');
        }
        return { type: g.type, photoIndices: g.photoIndices.slice(), width: w, childHeights: child };
      });
      return { height: h, groups: groups };
    });
  }

  function measure(rows, ratios, width, height) {
    var coverage = 0, fills = [], rowFill = [];
    rows.forEach(function (row) {
      var rowFills = [];
      row.groups.forEach(function (g) {
        var iw = g.width - BORDER;
        g.photoIndices.forEach(function (index, c) {
          var ih = g.childHeights[c] - (c ? GAP : 0);
          // Contain: fill = min(photoRatio / boxRatio, boxRatio / photoRatio).
          // Log space avoids intermediate overflow; normalized areas avoid W*H overflow.
          var fill = Math.exp(-Math.abs(Math.log(ratios[index]) - (Math.log(iw) - Math.log(ih))));
          fill = Math.max(0, Math.min(1, fill));
          fills.push(fill); rowFills.push(fill);
          coverage += (iw / width) * (ih / height) * fill;
        });
      });
      rowFill.push(sum(rowFills) / rowFills.length);
    });
    var meanFill = sum(fills) / fills.length, minFill = Math.min.apply(Math, fills);
    return { rows: rows, coverage: Math.max(0, Math.min(1, coverage)), meanFill: meanFill,
      minFill: minFill, rowFill: rowFill,
      photoCount: fills.length, rowPhotoCounts: rows.map(function (row) {
        return sum(row.groups.map(function (g) { return g.photoIndices.length; }));
      }),
      quality: meanFill * 0.55 + Math.min.apply(Math, rowFill) * 0.30 + minFill * 0.15 };
  }

  function positions(rows) {
    var result = [];
    rows.forEach(function (row, r) {
      row.forEach(function (g, j) {
        g.photoIndices.forEach(function (index, c) {
          result[index] = { row: r, x: (j + 0.5) / row.length, type: g.type, child: c };
        });
      });
    });
    return result;
  }
  function distance(rows, reference) {
    var p = positions(rows), d = 0;
    p.forEach(function (v, i) {
      var old = reference[i];
      d += (v.row !== old.row ? 8 : 0) + (v.type !== old.type ? 2 : 0) + Math.abs(v.x - old.x) + (v.child !== old.child ? 0.1 : 0);
    });
    return d;
  }
  function packingOptions(indices, rank) {
    var options = [];
    function add(parts) {
      parts = parts.map(function (part) { return part.slice().sort(function (a, b) { return rank[a] - rank[b]; }); });
      parts.sort(function (a, b) { return rank[a[0]] - rank[b[0]]; });
      options.push(parts.map(group));
    }
    add(indices.map(function (i) { return [i]; }));
    for (var a = 0; a < 4; a++) for (var b = a + 1; b < 4; b++) {
      var parts = [[indices[a], indices[b]]];
      for (var c = 0; c < 4; c++) if (c !== a && c !== b) parts.push([indices[c]]);
      add(parts);
    }
    for (var partner = 1; partner < 4; partner++) {
      var rest = indices.filter(function (_, i) { return i !== 0 && i !== partner; });
      add([[indices[0], indices[partner]], rest]);
    }
    return options; // 1 all-Single + 6 one-Duo + 3 two-Duo
  }
  function effectiveLog(row, logs) {
    return row.reduce(function (total, g) {
      var value = g.type === 'single' ? logs[g.photoIndices[0]] : harmonicLog(logs[g.photoIndices[0]], logs[g.photoIndices[1]]);
      return total === null ? value : logAdd(total, value);
    }, null);
  }

  function widthsFor(row, ratios, height, width, diagnostics) {
    var bounds = BOUNDS[row.length], lower = Math.max(bounds[0], (BORDER + Math.max(1e-9, width * Number.EPSILON * 4)) / width);
    var upper = bounds[1];
    if (lower * row.length >= 1 || lower > upper) return null;
    var logs = row.map(function (g) {
      var value = g.type === 'single' ? Math.log(ratios[g.photoIndices[0]]) + Math.log(height - BORDER) :
        harmonicLog(Math.log(ratios[g.photoIndices[0]]), Math.log(ratios[g.photoIndices[1]])) + Math.log(height - BORDER - GAP);
      // Ideal OUTER width is natural inner width plus the two 2px side borders.
      return logAdd(value, Math.log(BORDER));
    });
    var largest = Math.max.apply(Math, logs);
    logs = logs.map(function (v) { return v - largest; });
    var lowLog = Math.log(lower), highLog = Math.log(upper);
    var lo = lowLog - 1, hi = highLog - Math.min.apply(Math, logs) + 1;
    var fractions, total;
    // Bounded bisection; an active cap can release an earlier floor.
    for (var pass = 0; pass < 60; pass++) {
      var mid = lo + (hi - lo) / 2;
      fractions = logs.map(function (v) {
        var x = v + mid;
        return x <= lowLog ? lower : x >= highLog ? upper : Math.exp(x);
      });
      total = sum(fractions);
      if (total > 1) hi = mid; else lo = mid;
    }
    diagnostics.widthSolves++; diagnostics.boundedChecks += 60;
    var remaining = 1 - total;
    for (var i = 0; i < fractions.length && remaining !== 0; i++) {
      var delta = Math.max(lower - fractions[i], Math.min(upper - fractions[i], remaining));
      fractions[i] += delta; remaining -= delta;
    }
    var result = fractions.map(function (f) { return f * width; });
    // Last group absorbs only roundoff, so left-to-right summation is exactly W.
    result[result.length - 1] = width - sum(result.slice(0, -1));
    return result;
  }
  function layoutFor(shape, ratios, width, height, firstHeight, diagnostics) {
    var result = [];
    for (var r = 0; r < 2; r++) {
      var h = r ? height - firstHeight : firstHeight;
      var hasDuo = shape[r].some(function (g) { return g.type === 'dual'; });
      if (h <= BORDER + (hasDuo ? GAP : 0)) return null;
      var widths = widthsFor(shape[r], ratios, h, width, diagnostics);
      if (!widths) return null;
      result.push({ height: h, groups: shape[r].map(function (g, i) {
        return { type: g.type, photoIndices: g.photoIndices.slice(), width: widths[i], childHeights: children(g.photoIndices, ratios, h) };
      }) });
    }
    return result;
  }

  function refitRow(groups, width, height, currentWidths, options) {
    if (!Array.isArray(groups) || groups.length < 2 || groups.length > 4) {
      throw new TypeError('Expected 2..4 Single/Duo groups in one row.');
    }
    for (var index = 0; index < groups.length; index++) {
      if (!(index in groups)) throw new TypeError('Groups must not contain empty slots.');
    }
    var ratios = [], identity = groups.map(function (g) {
      if (!g || (g.type !== 'single' && g.type !== 'dual') || !Array.isArray(g.ratios) ||
          g.ratios.length !== (g.type === 'single' ? 1 : 2) || !positive(g.ratios[0]) ||
          (g.type === 'dual' && !positive(g.ratios[1]))) {
        throw new TypeError('Invalid Single/Duo or natural aspect ratios.');
      }
      return group(g.ratios.map(function (ratio) { var index = ratios.length; ratios.push(ratio); return index; }));
    });
    if (ratios.length < 4 || ratios.length > 6) throw new TypeError('Each row must contain 4..6 photos.');
    var hasDuo = identity.some(function (g) { return g.type === 'dual'; });
    if (!positive(width) || !positive(height) || width <= BORDER * groups.length || height <= BORDER + (hasDuo ? GAP : 0)) {
      throw new RangeError('Canvas must fit positive bordered photo boxes in the row.');
    }
    if (!Array.isArray(currentWidths) || currentWidths.length !== groups.length ||
        !identity.every(function (_, i) { return positive(currentWidths[i]); })) {
      throw new TypeError('Expected one positive finite current width per group.');
    }
    if (currentWidths.some(function (w) { return w <= BORDER; })) {
      throw new RangeError('Current widths must exceed the 4px border.');
    }
    var totalWidth = sum(currentWidths);
    if (!positive(totalWidth) || Math.abs(totalWidth - width) > Math.max(1, width) * 1e-10) {
      throw new RangeError('Current widths must sum to the canvas width.');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options) || !Number.isInteger(options.anchorIndex)) {
      throw new TypeError('Expected an integer anchorIndex in options.');
    }
    if (options.anchorIndex < 0 || options.anchorIndex >= groups.length) throw new RangeError('anchorIndex is outside the row.');
    var maxNeighbors = options.maxNeighbors === undefined ? 1 : options.maxNeighbors;
    if (!Number.isInteger(maxNeighbors)) throw new TypeError('maxNeighbors must be an integer.');
    if (maxNeighbors < 0 || maxNeighbors > 1) throw new RangeError('At most one neighbor per side is permitted.');
    var start = Math.max(0, options.anchorIndex - maxNeighbors), end = Math.min(groups.length - 1, options.anchorIndex + maxNeighbors);
    var diagnostics = { partitions: 0, packingCandidates: 0, shortlistCount: 0, evaluatedLayouts: 1,
      widthSolves: 0, boundedChecks: 0, heightSamples: 1, localGroupCount: end - start + 1,
      reordered: false, preserveTopology: true, decision: 'kept-baseline' };
    function rowFor(widths) {
      return { height: height, groups: identity.map(function (g, i) {
        return { type: g.type, photoIndices: g.photoIndices.slice(), width: widths[i], childHeights: children(g.photoIndices, ratios, height) };
      }) };
    }
    var baseline = measure([rowFor(currentWidths)], ratios, width, height), result = baseline;
    if (end > start) {
      var localWidth = sum(currentWidths.slice(start, end + 1));
      var fitted = widthsFor(identity.slice(start, end + 1), ratios, height, localWidth, diagnostics);
      if (fitted) {
        var widths = currentWidths.slice();
        fitted.forEach(function (w, i) { widths[start + i] = w; });
        // Only the final LOCAL group absorbs roundoff; outside widths stay verbatim.
        widths[end] = width - sum(widths.slice(0, end)) - sum(widths.slice(end + 1));
        if (widths.every(function (w) { return positive(w) && w > BORDER; })) {
          var candidate = measure([rowFor(widths)], ratios, width, height);
          diagnostics.evaluatedLayouts++;
          if (candidate.coverage > baseline.coverage) { result = candidate; diagnostics.decision = 'local-refit'; }
        }
      }
    }
    return { height: height, groups: result.rows[0].groups, coverage: result.coverage, meanFill: result.meanFill,
      minFill: result.minFill, quality: result.quality, baselineCoverage: baseline.coverage,
      gain: result.coverage - baseline.coverage, localRange: [start, end], diagnostics: diagnostics };
  }

  function plan(rows, width, height, currentLayout, options) {
    var requireSingle = options && options.requireSingle;
    function permitted(shape) {
      return !requireSingle || shape.some(function (row) { return row.some(function (g) { return g.type === 'single'; }); });
    }
    var input = readInput(rows, width, height), ratios = input.ratios;
    var oldRows = currentLayout == null ? null : currentRows(currentLayout, width, height, ratios);
    var identity = oldRows ? oldRows.map(function (row) { return row.groups.map(function (g) { return group(g.photoIndices); }); }) : input.identity;
    // Dynamic rows never enter the eight-photo combinatorial optimizer. Resizing
    // scales current geometry, or fits the supplied shape once if unmeasured.
    // Topology takes precedence over requireSingle; playback handles recovery.
    if (ratios.length !== 8 || (options && options.preserveTopology)) {
      var linearDiagnostics = { partitions: 0, packingCandidates: 0, shortlistCount: 0, evaluatedLayouts: 1,
        widthSolves: 0, boundedChecks: 0, heightSamples: 1, shortlistLimit: 0, materialThreshold: MATERIAL,
        decision: 'preserved-topology', reordered: false, preserveTopology: true };
      var geometry = oldRows || layoutFor(identity, ratios, width, height, height / 2, linearDiagnostics);
      if (!geometry) throw new RangeError('Canvas is too small for positive bordered photo boxes.');
      var preserved = measure(geometry, ratios, width, height);
      linearDiagnostics.bestQuality = preserved.quality;
      linearDiagnostics.identityQuality = preserved.quality;
      linearDiagnostics.oldCurrent = oldRows ? { coverage: preserved.coverage, meanFill: preserved.meanFill,
        minFill: preserved.minFill, rowFill: preserved.rowFill.slice(), quality: preserved.quality } : null;
      preserved.diagnostics = linearDiagnostics;
      return preserved;
    }
    var old = oldRows && permitted(oldRows.map(function (r) { return r.groups; })) ? measure(oldRows, ratios, width, height) : null;
    var reference = positions(identity), rank = [], serial = 0;
    identity.forEach(function (row) { row.forEach(function (g) { g.photoIndices.forEach(function (i) { rank[i] = serial++; }); }); });
    var logs = ratios.map(Math.log), canvasLog = Math.log(width) - Math.log(height), candidates = [];
    var diagnostics = { partitions: 0, packingCandidates: 0, shortlistCount: 0, evaluatedLayouts: 0,
      widthSolves: 0, boundedChecks: 0, heightSamples: 41, shortlistLimit: SHORTLIST, materialThreshold: MATERIAL };
    for (var a = 1; a <= 5; a++) for (var b = a + 1; b <= 6; b++) for (var c = b + 1; c <= 7; c++) {
      var top = [0, a, b, c], bottom = [];
      for (var index = 1; index < 8; index++) if (top.indexOf(index) === -1) bottom.push(index);
      var first = packingOptions(top, rank), second = packingOptions(bottom, rank);
      diagnostics.partitions++;
      first.forEach(function (r0) {
        var s0 = effectiveLog(r0, logs);
        second.forEach(function (r1) {
          var s1 = effectiveLog(r1, logs), shape = [r0, r1], d = distance(shape, reference);
          if (!permitted(shape)) return;
          var aspect = harmonicLog(s0, s1);
          var fit = Math.exp(-Math.abs(aspect - canvasLog));
          candidates.push({ shape: shape, key: key(shape), distance: d, heuristic: fit - d * 0.0003 });
        });
      });
    }
    diagnostics.packingCandidates = candidates.length;
    candidates.sort(function (a, b) {
      return b.heuristic - a.heuristic || a.distance - b.distance || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
    var shortlist = candidates.slice(0, SHORTLIST), identityKey = key(identity);
    if (permitted(identity) && !shortlist.some(function (c) { return c.key === identityKey; })) shortlist.push({ shape: identity, key: identityKey, distance: 0 });
    diagnostics.shortlistCount = shortlist.length;
    var preferredHeight = oldRows ? oldRows[0].height / height : 0.5;
    var best = null, bestIdentity = null;
    function better(candidate, previous) {
      return !previous || candidate.result.quality > previous.result.quality + TIE ||
        (Math.abs(candidate.result.quality - previous.result.quality) <= TIE &&
          (candidate.distance < previous.distance - TIE ||
            (Math.abs(candidate.distance - previous.distance) <= TIE && candidate.heightDistance < previous.heightDistance - TIE)));
    }
    shortlist.forEach(function (candidate) {
      for (var percent = 30; percent <= 70; percent++) {
        var geometry = layoutFor(candidate.shape, ratios, width, height, height * (percent / 100), diagnostics);
        if (!geometry) continue;
        diagnostics.evaluatedLayouts++;
        var entry = { result: measure(geometry, ratios, width, height), key: candidate.key, distance: candidate.distance,
          heightDistance: Math.abs(percent / 100 - preferredHeight) };
        if (better(entry, best)) best = entry;
        if (candidate.key === identityKey && better(entry, bestIdentity)) bestIdentity = entry;
      }
    });
    if (!best && !old) throw new RangeError('Canvas is too small for positive bordered photo boxes.');
    var result, decision;
    // Compare actual measured current geometry, never trust cached scores supplied by a caller.
    if (old && (!best || best.result.quality - old.quality < MATERIAL)) {
      result = old; decision = 'kept-current';
    } else if (bestIdentity && best.key !== identityKey && best.result.quality - bestIdentity.result.quality < MATERIAL) {
      if (old && bestIdentity.result.quality - old.quality < MATERIAL) { result = old; decision = 'kept-current'; }
      else { result = bestIdentity.result; decision = 'identity-refit'; }
    } else { result = best.result; decision = best.key === identityKey ? 'identity-refit' : 'material-repack'; }
    diagnostics.decision = decision;
    diagnostics.reordered = key(result.rows.map(function (r) { return r.groups; })) !== identityKey;
    diagnostics.bestQuality = best ? best.result.quality : old.quality;
    diagnostics.identityQuality = bestIdentity ? bestIdentity.result.quality : null;
    diagnostics.oldCurrent = old ? { coverage: old.coverage, meanFill: old.meanFill, minFill: old.minFill, rowFill: old.rowFill.slice(), quality: old.quality } : null;
    result.diagnostics = diagnostics;
    return result;
  }

  function planAligned(rows, width, height, currentWidths, options) {
    // Aligned cells are always physical left-to-right columns, never a packing.
    if (!Array.isArray(rows) || rows.length !== 2) throw new TypeError('Expected exactly two aligned rows.');
    for (var r = 0; r < 2; r++) {
      if (!Array.isArray(rows[r]) || rows[r].length !== 3) throw new TypeError('Expected exactly three aligned columns per row.');
      for (var c = 0; c < 3; c++) {
        var source = rows[r][c];
        if (!source || !Array.isArray(source.ratios) ||
            !positive(source.ratios[0]) || (source.type === 'dual' && !positive(source.ratios[1]))) {
          throw new TypeError('Invalid aligned Single/Duo or natural aspect ratios.');
        }
      }
    }
    var input = readInput(rows, width, height), ratios = input.ratios, identity = input.identity;
    if (width <= 3 * BORDER) throw new RangeError('Canvas must exceed 12px width for three bordered columns.');
    if (options === undefined) options = {};
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Expected aligned options.');
    var anchor = options.anchorIndex, maxNeighbors = options.maxNeighbors === undefined ? 1 : options.maxNeighbors;
    var minGain = options.minGain === undefined ? MATERIAL : options.minGain;
    if (anchor !== undefined && !Number.isInteger(anchor)) throw new TypeError('anchorIndex must be an integer.');
    if (anchor !== undefined && (anchor < 0 || anchor > 2)) throw new RangeError('anchorIndex is outside the aligned columns.');
    if (!Number.isInteger(maxNeighbors)) throw new TypeError('maxNeighbors must be an integer.');
    if (maxNeighbors < 0 || maxNeighbors > 1) throw new RangeError('At most one neighbor per side is permitted.');
    if (typeof minGain !== 'number' || !isFinite(minGain)) throw new TypeError('minGain must be finite.');
    if (minGain < 0 || minGain > 1) throw new RangeError('minGain must be between zero and one.');
    var startup = currentWidths == null;
    if (startup) {
      currentWidths = [width / 3, width / 3, width - 2 * (width / 3)];
      if (currentWidths.some(function (w) { return !positive(w) || w <= BORDER; })) {
        throw new RangeError('Canvas cannot represent three positive bordered photo boxes.');
      }
    }
    else {
      if (!Array.isArray(currentWidths) || currentWidths.length !== 3 ||
          ![0, 1, 2].every(function (i) { return positive(currentWidths[i]); })) {
        throw new TypeError('Expected three positive finite logical column widths.');
      }
      if (currentWidths.some(function (w) { return w <= BORDER; })) throw new RangeError('Column widths must exceed 4px.');
      var total = sum(currentWidths);
      if (!positive(total) || Math.abs(total - width) > Math.max(1, width) * 1e-10) {
        throw new RangeError('Logical column widths must sum to the canvas width.');
      }
      if (anchor === undefined) throw new TypeError('Current widths require an anchorIndex.');
      currentWidths = currentWidths.slice();
    }
    var start = startup ? 0 : Math.max(0, anchor - maxNeighbors);
    var end = startup ? 2 : Math.min(2, anchor + maxNeighbors), h = height / 2;
    var diagnostics = { aligned: true, reordered: false, preserveTopology: true, partitions: 0,
      packingCandidates: 0, widthSolves: 0, boundedChecks: 0, evaluatedLayouts: 1,
      localGroupCount: end - start + 1, decision: 'kept-baseline' };
    function rowsFor(widths) {
      return identity.map(function (row) {
        return { height: h, groups: row.map(function (g, i) {
          var first = (h - BORDER - GAP) / 2;
          return { type: g.type, photoIndices: g.photoIndices.slice(), width: widths[i],
            childHeights: g.type === 'single' ? [h - BORDER] : [first, first + GAP] };
        }) };
      });
    }
    var baseline = measure(rowsFor(currentWidths), ratios, width, height), result = baseline;
    var chosen = currentWidths.slice();
    // For one photo, contain area as a function of INNER width x is
    // min(x*x/ratio, ratio*innerHeight*innerHeight). Between its natural-width
    // breakpoints the sum for BOTH rows is convex (quadratic plus constants).
    // Its maximum on a bounded, conserved-width plane is therefore at a vertex:
    // all but one local columns are at a floor, cap or photo breakpoint. There
    // are at most 6 points/column, 108 checks for 3 columns, 12 for 2. This is
    // a width-only solve, with no partitions, permutations or global packing.
    if (end > start) {
      var lower = Math.max(width * BOUNDS[3][0], BORDER + Math.max(1e-12, width * Number.EPSILON * 4));
      var upper = width * BOUNDS[3][1];
      var localWidth = sum(currentWidths.slice(start, end + 1)), n = end - start + 1;
      if (lower <= upper && lower <= localWidth / n && upper >= localWidth / n) {
        diagnostics.widthSolves = 1;
        var points = [];
        for (var col = start; col <= end; col++) {
          var values = [lower, upper];
          identity.forEach(function (row) {
            var g = row[col], innerHeight = g.type === 'single' ? h - BORDER : (h - BORDER - GAP) / 2;
            g.photoIndices.forEach(function (index) {
              var logNatural = Math.log(ratios[index]) + Math.log(innerHeight);
              // Only interior breakpoints are useful; clip in log space before
              // exponentiating so even MIN_VALUE/MAX_VALUE aspects stay finite.
              if (logNatural > Math.log(lower - BORDER) && logNatural < Math.log(upper - BORDER)) {
                var point = BORDER + Math.exp(logNatural);
                if (point > lower && point < upper && values.indexOf(point) === -1) values.push(point);
              }
            });
          });
          points.push(values);
        }
        function check(free, fixed) {
          diagnostics.boundedChecks++;
          var widths = currentWidths.slice();
          fixed.forEach(function (item) { widths[start + item[0]] = item[1]; });
          // Only the free LOCAL column absorbs roundoff; outside is verbatim.
          var remainder = width;
          for (var i = 0; i < 3; i++) if (i !== start + free) remainder -= widths[i];
          var tolerance = Math.max(1, width) * Number.EPSILON * 8;
          if (!positive(remainder) || remainder <= BORDER || remainder < lower - tolerance || remainder > upper + tolerance) return;
          widths[start + free] = remainder;
          var candidate = measure(rowsFor(widths), ratios, width, height);
          diagnostics.evaluatedLayouts++;
          if (candidate.coverage > result.coverage + TIE) { result = candidate; chosen = widths; }
        }
        for (var free = 0; free < n; free++) {
          var fixedColumns = [];
          for (var j = 0; j < n; j++) if (j !== free) fixedColumns.push(j);
          points[fixedColumns[0]].forEach(function (a) {
            if (n === 2) check(free, [[fixedColumns[0], a]]);
            else points[fixedColumns[1]].forEach(function (b) {
              check(free, [[fixedColumns[0], a], [fixedColumns[1], b]]);
            });
          });
        }
      }
    }
    // minGain is deliberately advisory: playback decides whether to apply the
    // returned joint fit. Never return a coverage-worse candidate, at any gain.
    if (result !== baseline) diagnostics.decision = startup ? 'initial-aligned-fit' : 'local-aligned-fit';
    result.columnWidths = chosen;
    result.baselineCoverage = baseline.coverage;
    result.gain = result.coverage - baseline.coverage;
    result.localRange = [start, end];
    result.diagnostics = diagnostics;
    return result;
  }
  return { plan: plan, refitRow: refitRow, planAligned: planAligned,
    geometry: Object.freeze({ border: BORDER, gap: GAP, separator: 4 }) };
}));
