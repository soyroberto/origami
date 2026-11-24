/* Two rows of 4..6 existing photos, contain-only geometry. No DOM, network or timers. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiftingTilesLayout = factory();
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var BORDER = 10, GAP = 10, SHORTLIST = 16, MATERIAL = 0.02, TIE = 1e-12;
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
    if (!positive(width) || !positive(height) || width <= 20 || height <= 40) {
      throw new RangeError('Canvas must exceed 20px width and 40px height for two bordered Duo rows.');
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
    var epsilon = Math.max(Number.MIN_VALUE, available * 1e-12);
    first = Math.max(epsilon, Math.min(available - epsilon, first));
    return [first, height - BORDER - first]; // second includes its 10px top gap
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
          throw new TypeError('currentLayout children must sum to row height minus 10px.');
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
      // Ideal OUTER width is natural inner width plus the two 5px side borders.
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

  // Shared modules constrain the grid, not the number or identity of its boxes.
  // Keep the legacy planner below available for its original callers.
  function modularPlan(input, width, height, current, options) {
    var previous = current == null ? null : currentRows(current, width, height, input.ratios);
    var identity = previous ? previous.map(function (row) {
      return row.groups.map(function (g) { return group(g.photoIndices); });
    }) : input.identity;
    var preserve = !!options.preserveTopology || input.ratios.length !== 8;
    var reference = positions(identity), evaluated = 0;

    function allowed(shape) {
      return preserve || !options.requireSingle || shape.some(function (row) {
        return row.some(function (g) { return g.type === 'single'; });
      });
    }
    function widths(n, units) {
      var choices = [], bounds = BOUNDS[n];
      function visit(parts, left) {
        if (parts.length === n) {
          if (!left) choices.push(parts);
          return;
        }
        var remaining = n - parts.length - 1;
        for (var span = 1; span <= left - remaining; span++) {
          var fraction = span / units;
          if (fraction >= bounds[0] && fraction <= bounds[1] && width * fraction > BORDER) {
            visit(parts.concat(span), left - span);
          }
        }
      }
      visit([], units);
      return choices;
    }
    function geometry(shape, spans, units) {
      return shape.map(function (row, r) {
        var h = r ? height - height / 2 : height / 2, used = 0;
        return { height: h, groups: row.map(function (g, j) {
          var w = j === row.length - 1 ? width - used : width * spans[r][j] / units;
          used += w;
          var first = (h - BORDER - GAP) / 2;
          if (w <= BORDER || h <= BORDER || (g.type === 'dual' && first <= 0)) {
            throw new RangeError('Canvas is too small for positive modular photo boxes.');
          }
          return { type: g.type, photoIndices: g.photoIndices.slice(), width: w, span: spans[r][j],
            childHeights: g.type === 'single' ? [h - BORDER] : [first, h - BORDER - first] };
        }) };
      });
    }
    function entry(shape, spans, units) {
      var result;
      try { result = measure(geometry(shape, spans, units), input.ratios, width, height); }
      catch (error) { if (error instanceof RangeError) return null; throw error; }
      evaluated++;
      result.modularUnits = units;
      return { result: result, key: key(shape), distance: distance(shape, reference), units: units };
    }
    function better(candidate, old) {
      return candidate && (!old || candidate.result.quality > old.result.quality + TIE ||
        (Math.abs(candidate.result.quality - old.result.quality) <= TIE &&
          (candidate.distance < old.distance ||
            (candidate.distance === old.distance && Math.abs(candidate.units - 5) < Math.abs(old.units - 5)))));
    }
    function contiguous(row) {
      var indices = [].concat.apply([], row.map(function (g) { return g.photoIndices; })), shapes = [];
      function visit(parts, start) {
        if (start === indices.length) { if (parts.length >= 2 && parts.length <= 4) shapes.push(parts); return; }
        if (parts.length === 4) return;
        for (var count = 1; count <= 2 && start + count <= indices.length; count++) {
          visit(parts.concat([group(indices.slice(start, start + count))]), start + count);
        }
      }
      visit([], 0);
      return shapes;
    }

    var kept = null, knownUnits = current && current.modularUnits;
    if (previous && [4, 5, 6].indexOf(knownUnits) !== -1 && allowed(identity)) {
      var knownSpans = current.rows.map(function (row) { return row.groups.map(function (g) { return g.modularSpan; }); });
      if (knownSpans.every(function (row) {
        return sum(row) === knownUnits && row.every(function (span) { return Number.isInteger(span) && span > 0; });
      })) kept = entry(identity, knownSpans, knownUnits);
    }

    var best = kept, bestIdentity = kept;
    if (!preserve || !kept) {
      var first = preserve ? [identity[0]] : contiguous(identity[0]);
      var second = preserve ? [identity[1]] : contiguous(identity[1]);
      [4, 5, 6].forEach(function (units) {
        first.forEach(function (top) { second.forEach(function (bottom) {
          var shape = [top, bottom];
          if (!allowed(shape)) return;
          var a = widths(top.length, units), b = widths(bottom.length, units);
          a.forEach(function (s0) { b.forEach(function (s1) {
            var candidate = entry(shape, [s0, s1], units);
            if (better(candidate, best)) best = candidate;
            if (key(shape) === key(identity) && better(candidate, bestIdentity)) bestIdentity = candidate;
          }); });
        }); });
      });
    }
    if (!best) throw new RangeError('Canvas is too small for positive modular photo boxes.');
    var chosen = best;
    // Content replacement and resizing must not reshuffle a good modular grid.
    if (kept && best.result.quality - kept.result.quality < MATERIAL) chosen = kept;
    else if (bestIdentity && best.key !== key(identity) && best.result.quality - bestIdentity.result.quality < MATERIAL) chosen = bestIdentity;
    var reordered = chosen.key !== key(identity), result = chosen.result;
    result.diagnostics = { decision: preserve ? 'modular-preserved-topology' : reordered ? 'modular-repack' : 'modular-identity-fit',
      reordered: reordered, preserveTopology: preserve, alignment: 'shared-modules', partitions: 0,
      packingCandidates: preserve ? 0 : evaluated, shortlistCount: 0, shortlistLimit: 0,
      evaluatedLayouts: evaluated, widthSolves: 0, boundedChecks: 0, heightSamples: 1,
      materialThreshold: MATERIAL, bestQuality: best.result.quality,
      identityQuality: bestIdentity ? bestIdentity.result.quality : null,
      oldCurrent: previous ? (function () { var old = measure(previous, input.ratios, width, height);
        return { coverage: old.coverage, meanFill: old.meanFill, minFill: old.minFill, rowFill: old.rowFill, quality: old.quality };
      }()) : null };
    return result;
  }

  function plan(rows, width, height, currentLayout, options) {
    var requireSingle = options && options.requireSingle;
    function permitted(shape) {
      return !requireSingle || shape.some(function (row) { return row.some(function (g) { return g.type === 'single'; }); });
    }
    var input = readInput(rows, width, height), ratios = input.ratios;
    if (options && options.modularLayout) return modularPlan(input, width, height, currentLayout, options);
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
  return { plan: plan };
}));
