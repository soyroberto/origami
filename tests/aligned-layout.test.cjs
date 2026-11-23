'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { planAligned, geometry } = require('../gallery-layout.js');

const single = ratio => ({ type: 'single', ratios: [ratio] });
const dual = (a, b) => ({ type: 'dual', ratios: [a, b] });
const sum = values => values.reduce((a, b) => a + b, 0);
const close = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const widthsAt = (W, fractions) => {
  const widths = fractions.map(f => W * f);
  widths[2] = W - sum(widths.slice(0, 2));
  return widths;
};
const capture = () => [[dual(0.6, 0.67), single(1.6), single(1.8)], [dual(0.7, 0.6), single(1.8), single(1.4)]];
const mixed = () => [[single(1), dual(0.3, 3.1), single(1.6)], [dual(2.7, 0.4), single(0.6), dual(1.5, 0.8)]];
const viewports = [[1915, 924], [1024, 768], [390, 844]];

// Independent physical contain-area calculation, not the planner's log-fill
// formula. The normalized version also handles enormous canvas dimensions.
function measured(input, W, H, widths) {
  let coverage = 0;
  const rowCoverage = [], fills = [], rowFill = [];
  input.forEach(row => {
    let area = 0;
    const local = [];
    row.forEach((g, c) => {
      const iw = widths[c] - 4, ih = g.type === 'single' ? H / 2 - 4 : (H / 2 - 8) / 2;
      g.ratios.forEach(ratio => {
        const normalizedW = iw / W, normalizedH = ih / H;
        const logPhotoW = Math.min(Math.log(iw), Math.log(ratio) + Math.log(ih));
        const logPhotoH = Math.min(Math.log(ih), Math.log(iw) - Math.log(ratio));
        const fill = Math.exp(logPhotoW - Math.log(iw)) * Math.exp(logPhotoH - Math.log(ih));
        area += normalizedW * normalizedH * fill;
        local.push(fill); fills.push(fill);
      });
    });
    coverage += area; rowCoverage.push(area); rowFill.push(sum(local) / local.length);
  });
  return { coverage, rowCoverage, meanFill: sum(fills) / fills.length, minFill: Math.min(...fills), rowFill };
}

function verify(result, input, W, H, baselineWidths, range) {
  assert.equal(result.rows.length, 2);
  assert.equal(result.columnWidths.length, 3);
  assert.deepEqual(result.localRange, range);
  close(sum(result.columnWidths), W);
  const ratios = input.flatMap(row => row.flatMap(g => g.ratios));
  const indices = [], xs = [], splits = [];
  result.rows.forEach((row, r) => {
    assert.equal(row.height, H / 2, 'central row boundary is exactly H/2');
    assert.equal(row.groups.length, 3, 'three stable cells regardless of photo count');
    let x = 0;
    xs[r] = []; splits[r] = [];
    row.groups.forEach((g, c) => {
      xs[r].push(x); x += g.width;
      assert.equal(g.width, result.columnWidths[c], 'shared logical column width in both rows');
      assert.equal(g.type, input[r][c].type);
      assert.ok(Number.isFinite(g.width) && g.width > 4);
      if (c < range[0] || c > range[1]) assert.equal(g.width, baselineWidths[c], 'outside width is EXACT in BOTH rows');
      assert.equal(g.photoIndices.length, input[r][c].ratios.length);
      assert.equal(g.childHeights.length, g.photoIndices.length);
      if (g.type === 'single') assert.deepEqual(g.childHeights, [H / 2 - 4]);
      else {
        const first = (H / 2 - 8) / 2;
        assert.deepEqual(g.childHeights, [first, first + 4]);
        // Slot border top 2px; Duo separator center another 2px after child.
        splits[r].push(r * H / 2 + 2 + first + 2);
      }
      close(sum(g.childHeights), row.height - 4);
      g.photoIndices.forEach((index, child) => {
        indices.push(index);
        const iw = g.width - 4, ih = g.childHeights[child] - (child ? 4 : 0), ratio = ratios[index];
        assert.ok(Number.isFinite(ih) && ih > 0, '4px gap leaves a positive inner box');
        const logScale = Math.min(Math.log(iw) - Math.log(ratio), Math.log(ih));
        const logW = Math.log(ratio) + logScale, logH = logScale;
        close(logW - logH, Math.log(ratio));
        assert.ok(logW <= Math.log(iw) + 1e-10, 'complete photo: no horizontal crop');
        assert.ok(logH <= Math.log(ih) + 1e-10, 'complete photo: no vertical crop');
        assert.ok(Math.abs(logW - Math.log(iw)) <= 1e-10 || Math.abs(logH - Math.log(ih)) <= 1e-10);
        const scale = Math.min(iw / ratio, ih), photoW = ratio * scale;
        const minNormal = Number.MIN_VALUE / Number.EPSILON;
        if (photoW >= minNormal && scale >= minNormal && Number.isFinite(photoW)) {
          close(photoW / scale, ratio, 1e-9);
          assert.ok(photoW <= iw + Math.max(1, iw) * 1e-12);
          assert.ok(scale <= ih + Math.max(1, ih) * 1e-12);
        }
      });
    });
    close(x, W);
    splits[r].forEach(y => close(y, (r + 0.5) * H / 2));
  });
  assert.deepEqual(xs[0], xs[1], 'all vertical division x coordinates are identical, including mixed types');
  assert.deepEqual(indices, ratios.map((_, i) => i), 'GLOBAL indices: complete and in original row/cell/child order');
  assert.equal(result.photoCount, ratios.length);
  assert.deepEqual(result.rowPhotoCounts, input.map(row => sum(row.map(g => g.ratios.length))));
  const actual = measured(input, W, H, result.columnWidths), baseline = measured(input, W, H, baselineWidths);
  close(result.coverage, actual.coverage);
  close(result.meanFill, actual.meanFill);
  close(result.minFill, actual.minFill);
  result.rowFill.forEach((fill, r) => close(fill, actual.rowFill[r]));
  close(result.quality, result.meanFill * 0.55 + Math.min(...result.rowFill) * 0.30 + result.minFill * 0.15);
  close(result.baselineCoverage, baseline.coverage);
  assert.ok(result.coverage >= result.baselineCoverage, 'no coverage-worse candidate, even by rounding');
  assert.equal(result.gain, result.coverage - result.baselineCoverage);
  [result.coverage, result.meanFill, result.minFill, ...result.rowFill, result.quality, result.baselineCoverage, result.gain]
    .forEach(value => assert.ok(Number.isFinite(value) && value >= 0 && value <= 1));
  const d = result.diagnostics, localCount = range[1] - range[0] + 1;
  assert.equal(d.aligned, true);
  assert.equal(d.reordered, false);
  assert.equal(d.preserveTopology, true);
  assert.equal(d.partitions, 0);
  assert.equal(d.packingCandidates, 0);
  assert.equal(d.localGroupCount, localCount);
  assert.ok(d.widthSolves >= 0 && d.widthSolves <= 1);
  assert.ok(d.boundedChecks <= (localCount === 3 ? 108 : localCount === 2 ? 12 : 0));
  assert.ok(d.evaluatedLayouts >= 1 && d.evaluatedLayouts <= d.boundedChecks + 1);
}

test('exact aligned API is available in CommonJS and browser UMD with frozen 4/4/4 geometry', () => {
  assert.deepEqual(Object.keys(require('../gallery-layout.js')).sort(), ['geometry', 'plan', 'planAligned', 'refitRow']);
  assert.deepEqual(geometry, { border: 4, gap: 4, separator: 4 });
  assert.ok(Object.isFrozen(geometry));
  for (const context of [{}, { window: {} }]) {
    vm.runInNewContext(fs.readFileSync(require.resolve('../gallery-layout.js'), 'utf8'), context);
    const api = context.window ? context.window.ShiftingTilesLayout : context.ShiftingTilesLayout;
    assert.equal(typeof api.planAligned, 'function');
    assert.equal(JSON.stringify(api.geometry), JSON.stringify(geometry));
  }
  const result = planAligned(mixed(), 1915, 924);
  assert.deepEqual(Object.keys(result).sort(), ['baselineCoverage', 'columnWidths', 'coverage', 'diagnostics', 'gain', 'localRange',
    'meanFill', 'minFill', 'photoCount', 'quality', 'rowFill', 'rowPhotoCounts', 'rows'].sort());
});

test('desktop, tablet and mobile share all x boundaries and horizontal Duo lines independently of ratios and types', () => {
  for (const [W, H] of viewports) {
    const input = mixed(), baseline = widthsAt(W, [1 / 3, 1 / 3, 1 / 3]);
    const result = planAligned(input, W, H, null);
    verify(result, input, W, H, baseline, [0, 2]);
    result.columnWidths.forEach(w => assert.ok(w / W >= 0.12 - 1e-12 && w / W <= 0.65 + 1e-12));
    assert.equal(result.rows[0].groups[0].type, 'single');
    assert.equal(result.rows[1].groups[0].type, 'dual', 'paired columns need not have the same type or photo');
  }
});

test('contain area materially reduces black filler for BOTH rows without changing topology', () => {
  const input = capture(), W = 1915, H = 1000, widths = [1050, 430, 435];
  const result = planAligned(input, W, H, widths, { anchorIndex: 0, maxNeighbors: 1, minGain: 0.02 });
  verify(result, input, W, H, widths, [0, 1]);
  assert.ok(result.gain > 0.30);
  assert.deepEqual(result.columnWidths, [235.25, 1244.75, 435]);
  const before = measured(input, W, H, widths), after = measured(input, W, H, result.columnWidths);
  after.rowCoverage.forEach((area, r) => assert.ok(area > before.rowCoverage[r] + 0.14));
  assert.ok(1 - result.coverage < 1 - result.baselineCoverage - 0.30);
  console.log('ALIGNED_CONTAIN_FIXTURE', JSON.stringify({ before: result.baselineCoverage, after: result.coverage, gain: result.gain,
    beforeWidths: widths, afterWidths: result.columnWidths, beforeRows: before.rowCoverage, afterRows: after.rowCoverage, diagnostics: result.diagnostics }));
});

test('local changes share widths in both rows, conserve the window and leave outside geometry exact', () => {
  const input = mixed();
  for (const [W, H] of viewports) for (const anchor of [0, 1, 2]) {
    const widths = widthsAt(W, [0.5, 0.2, 0.3]);
    const result = planAligned(input, W, H, widths, { anchorIndex: anchor });
    const range = [Math.max(0, anchor - 1), Math.min(2, anchor + 1)];
    verify(result, input, W, H, widths, range);
    close(sum(result.columnWidths.slice(range[0], range[1] + 1)), sum(widths.slice(range[0], range[1] + 1)));
    if (anchor === 0) close(sum(result.columnWidths.slice(0, 2)), sum(widths.slice(0, 2)), 1e-12);
    if (anchor === 2) assert.equal(result.columnWidths[0], widths[0]);
  }
});

test('changing viewport uses caller-scaled logical widths rather than DOM quantization or independent row fits', () => {
  const input = capture(), original = planAligned(input, 1915, 1000);
  for (const [W, H] of viewports) {
    const widths = widthsAt(W, original.columnWidths.map(w => w / 1915));
    const result = planAligned(input, W, H, widths, { anchorIndex: 0, maxNeighbors: 1 });
    verify(result, input, W, H, widths, [0, 1]);
    assert.equal(result.rows[0].groups[2].width, widths[2]);
    assert.equal(result.rows[1].groups[2].width, widths[2]);
  }
});

test('opposed row aspects optimize the joint area, not only the anchor row or individual fill', () => {
  const input = [[single(1.6), single(0.2), dual(1, 1)], [single(0.2), single(2.5), dual(1, 1)]];
  const W = 1915, H = 1000, widths = [1050, 430, 435];
  const result = planAligned(input, W, H, widths, { anchorIndex: 0 });
  verify(result, input, W, H, widths, [0, 1]);
  const lo = Math.max(W * 0.12, 1480 - W * 0.65), hi = Math.min(W * 0.65, 1480 - W * 0.12);
  let bestTop = { area: -1 }, bestJoint = -1;
  for (let i = 0; i <= 1000; i++) {
    const a = lo + (hi - lo) * i / 1000, candidate = [a, 1480 - a, 435];
    const value = measured(input, W, H, candidate);
    bestJoint = Math.max(bestJoint, value.coverage);
    if (value.rowCoverage[0] > bestTop.area) bestTop = { area: value.rowCoverage[0], coverage: value.coverage, widths: candidate };
  }
  assert.ok(result.coverage >= bestJoint - 1e-10, 'bounded vertex solve dominates an independent dense width scan');
  assert.ok(result.coverage > bestTop.coverage + 0.005, 'top-only optimal width loses significant joint area');
  assert.ok(Math.abs(result.columnWidths[0] - bestTop.widths[0]) > 10);
});

function countRows(counts, variant) {
  const sizes = { 4: [1, 1, 2], 5: [1, 2, 2], 6: [2, 2, 2] };
  let index = 0;
  return counts.map((count, r) => {
    const shape = sizes[count].slice();
    if ((variant + r) % 2) shape.reverse();
    return shape.map(n => ({ type: n === 1 ? 'single' : 'dual', ratios: Array.from({ length: n }, () => [0.3, 2.8, 1, 0.7, 1.6][index++ % 5]) }));
  });
}

test('all 4..6 photos per row, 8..12 total, retain three columns and GLOBAL source order', () => {
  const totals = new Set();
  for (const a of [4, 5, 6]) for (const b of [4, 5, 6]) for (const variant of [0, 1]) {
    const input = countRows([a, b], variant), before = JSON.stringify(input);
    for (const [W, H] of viewports) {
      const widths = widthsAt(W, [0.2, 0.5, 0.3]), result = planAligned(input, W, H, widths, { anchorIndex: 1 });
      verify(result, input, W, H, widths, [0, 2]);
      assert.deepEqual(result.rowPhotoCounts, [a, b]);
      totals.add(result.photoCount);
    }
    assert.equal(JSON.stringify(input), before);
  }
  assert.deepEqual([...totals].sort((a, b) => a - b), [8, 9, 10, 11, 12]);
});

test('one-column window is an exact baseline with zero width solves', () => {
  const input = mixed(), W = 1915, H = 924, widths = [700, 600, 615];
  for (const anchor of [0, 1, 2]) {
    const result = planAligned(input, W, H, widths, { anchorIndex: anchor, maxNeighbors: 0 });
    verify(result, input, W, H, widths, [anchor, anchor]);
    assert.deepEqual(result.columnWidths, widths);
    assert.equal(result.gain, 0);
    assert.equal(result.diagnostics.widthSolves, 0);
    assert.equal(result.diagnostics.boundedChecks, 0);
  }
});

test('already optimal widths and infeasible local caps return the exact baseline', () => {
  const input = capture(), W = 1915, H = 1000;
  const first = planAligned(input, W, H, [1050, 430, 435], { anchorIndex: 0 });
  const second = planAligned(input, W, H, first.columnWidths, { anchorIndex: 0 });
  verify(second, input, W, H, first.columnWidths, [0, 1]);
  assert.equal(second.diagnostics.widthSolves, 1, 'candidates were checked before the baseline fallback');
  assert.ok(second.diagnostics.evaluatedLayouts > 1);
  assert.deepEqual(second.columnWidths, first.columnWidths);
  assert.equal(second.gain, 0);
  assert.equal(second.diagnostics.decision, 'kept-baseline');
  const widths = [5, 5, 1905], infeasible = planAligned(input, W, H, widths, { anchorIndex: 0 });
  verify(infeasible, input, W, H, widths, [0, 1]);
  assert.deepEqual(infeasible.columnWidths, widths);
  assert.equal(infeasible.diagnostics.widthSolves, 0);
});

test('minGain is advisory to playback, not an excuse to return a worse or unmeasured layout', () => {
  const input = capture(), args = [input, 1915, 1000, [1050, 430, 435]];
  const result = planAligned(...args, { anchorIndex: 0, minGain: 1 });
  assert.ok(result.gain > 0.30 && result.gain < 1);
  assert.deepEqual(result, planAligned(...args, { anchorIndex: 0, minGain: 0 }));
});

test('finite extreme aspects and minimum/maximum canvas dimensions preserve geometry and contain scores', () => {
  const input = [[dual(Number.MIN_VALUE, Number.MAX_VALUE), single(1e-300), single(1e300)],
    [single(Number.MAX_VALUE), dual(1e-200, 1e200), dual(Number.MIN_VALUE, 1)]];
  for (const [W, H] of [...viewports, [12 + 2e-10, 16 + 2e-10], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
    const widths = widthsAt(W, [1 / 3, 1 / 3, 1 / 3]);
    const startup = planAligned(input, W, H);
    verify(startup, input, W, H, widths, [0, 2]);
    for (const anchor of [0, 1, 2]) verify(planAligned(input, W, H, widths, { anchorIndex: anchor }), input, W, H, widths,
      [Math.max(0, anchor - 1), Math.min(2, anchor + 1)]);
  }
});

test('frozen input, logical widths and options are not mutated or retained by reference', () => {
  const input = Object.freeze(mixed().map(row => Object.freeze(row.map(g => Object.freeze({ type: g.type, ratios: Object.freeze(g.ratios) })))));
  const widths = Object.freeze([700, 600, 615]), options = Object.freeze({ anchorIndex: 1, minGain: 0.02 });
  const before = JSON.stringify({ input, widths, options });
  const first = planAligned(input, 1915, 924, widths, options);
  assert.deepEqual(first, planAligned(input, 1915, 924, widths, options));
  assert.equal(JSON.stringify({ input, widths, options }), before);
  first.rows[1].groups[0].photoIndices[0] = 99; first.columnWidths[0] = 1;
  assert.equal(planAligned(input, 1915, 924, widths, options).rows[1].groups[0].photoIndices[0], 4);
});

test('invalid shapes, sparse entries, aspects, canvases, current widths and options fail explicitly', () => {
  const input = mixed(), widths = [700, 600, 615];
  const fit = (rows = input, W = 1915, H = 924, current = widths, options = { anchorIndex: 1 }) => planAligned(rows, W, H, current, options);
  for (const rows of [null, {}, [], [input[0]], [input[0], input[1], input[0]], [input[0], ,],
    [[dual(1, 1), dual(1, 1)], input[1]], [Array.from({ length: 4 }, () => single(1)), input[1]],
    [[single(1), single(1), single(1)], input[1]], [[single(1), , dual(1, 1)], input[1]],
    [[dual(1, 1), { type: 'triple', ratios: [1] }, single(1)], input[1]],
    [[dual(1, 1), { type: 'single', ratios: [1, 1] }, single(1)], input[1]],
    [[dual(1, 1), { type: 'dual', ratios: [1, ,] }, single(1)], input[1]]]) assert.throws(() => fit(rows), TypeError);
  for (const ratio of [0, -1, NaN, Infinity, -Infinity, '1', null, undefined]) {
    const rows = mixed(); rows[1][0].ratios[0] = ratio;
    assert.throws(() => fit(rows), TypeError);
  }
  for (const W of [0, -1, 12, NaN, Infinity, '1915']) assert.throws(() => fit(input, W), RangeError);
  for (const H of [0, -1, 16, NaN, Infinity, '924']) assert.throws(() => fit(input, 1915, H), RangeError);
  assert.throws(() => planAligned(input, 12 + Number.EPSILON * 8, 924), RangeError,
    'at the first representable W above 12px, exact thirds would leave one zero inner width');
  for (const current of [{}, [], [1915], [700, 600], [700, 600, 615, 1], [700, , 1215], [0, 600, 1315],
    [NaN, 600, 615], [Infinity, 600, 615], ['700', 600, 615]]) assert.throws(() => fit(input, 1915, 924, current), TypeError);
  for (const current of [[4, 600, 1311], [1, 600, 1314], [700, 600, 614]]) assert.throws(() => fit(input, 1915, 924, current), RangeError);
  assert.throws(() => fit(input, Number.MAX_VALUE, 924, [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]), RangeError);
  for (const options of [null, [], {}, { anchorIndex: 0.5 }, { anchorIndex: '1' }, { anchorIndex: NaN },
    { anchorIndex: 1, maxNeighbors: 0.5 }, { anchorIndex: 1, maxNeighbors: '1' }, { anchorIndex: 1, maxNeighbors: null },
    { anchorIndex: 1, minGain: NaN }, { anchorIndex: 1, minGain: Infinity }, { anchorIndex: 1, minGain: '0.02' }]) {
    assert.throws(() => fit(input, 1915, 924, widths, options), TypeError);
  }
  for (const options of [{ anchorIndex: -1 }, { anchorIndex: 3 }, { anchorIndex: 1, maxNeighbors: 2 },
    { anchorIndex: 1, maxNeighbors: -1 }, { anchorIndex: 1, minGain: -0.01 }, { anchorIndex: 1, minGain: 1.01 }]) {
    assert.throws(() => fit(input, 1915, 924, widths, options), RangeError);
  }
  assert.deepEqual(planAligned(input, 1915, 924), planAligned(input, 1915, 924, null));
  assert.deepEqual(fit(input, 1915, 924, widths, { anchorIndex: 1 }), fit());
});

test('logical floating-point sums tolerate arithmetic roundoff, but never accept a material mismatch', () => {
  const input = capture(), widths = [700, 600, 615 + 1e-9];
  const result = planAligned(input, 1915, 1000, widths, { anchorIndex: 0 });
  verify(result, input, 1915, 1000, widths, [0, 1]);
  assert.equal(result.columnWidths[2], widths[2]);
  assert.throws(() => planAligned(input, 1915, 1000, [700, 600, 614.9], { anchorIndex: 0 }), RangeError);
});

test('twelve distinct natural-width breakpoints exercise the full 108-check bound', () => {
  const input = [[dual(0.6, 0.8), dual(1, 1.2), dual(1.4, 1.6)],
    [dual(0.7, 0.9), dual(1.1, 1.3), dual(1.5, 1.7)]];
  const W = 1000, H = 1000, widths = widthsAt(W, [1 / 3, 1 / 3, 1 / 3]);
  const result = planAligned(input, W, H);
  verify(result, input, W, H, widths, [0, 2]);
  assert.equal(result.diagnostics.widthSolves, 1);
  assert.equal(result.diagnostics.boundedChecks, 108);
  // Independent coarse plane scan: topology and index order never change.
  for (let a = 120; a <= 650; a += 10) for (let b = 120; b <= 650; b += 10) {
    const c = W - a - b;
    if (c >= 120 && c <= 650) assert.ok(result.coverage >= measured(input, W, H, [a, b, c]).coverage - 1e-10);
  }
});

test('bounded joint width work has no global packing, height search or photo-count-dependent explosion', () => {
  const input = countRows([6, 6], 0), calls = 1000, started = performance.now();
  let maxChecks = 0, maxLayouts = 0;
  for (let i = 0; i < calls; i++) {
    const W = 1915 + i % 10, widths = widthsAt(W, [0.2, 0.5, 0.3]);
    const result = planAligned(input, W, 924, widths, { anchorIndex: 1 });
    const d = result.diagnostics;
    assert.equal(d.partitions, 0); assert.equal(d.packingCandidates, 0);
    assert.equal(d.widthSolves, 1);
    assert.ok(d.boundedChecks <= 108);
    assert.ok(d.evaluatedLayouts <= 109);
    assert.equal(result.photoCount, 12);
    maxChecks = Math.max(maxChecks, d.boundedChecks); maxLayouts = Math.max(maxLayouts, d.evaluatedLayouts);
  }
  console.log('ALIGNED_BOUNDED_RUNTIME', JSON.stringify({ calls, elapsedMs: +(performance.now() - started).toFixed(3),
    maxChecks, maxLayouts, maxWidthSolves: 1, partitions: 0, packingCandidates: 0, advisoryOnly: true }));
});
