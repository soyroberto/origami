'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { plan, refitRow, geometry } = require('../gallery-layout.js');

const single = ratio => ({ type: 'single', ratios: [ratio] });
const dual = (a, b) => ({ type: 'dual', ratios: [a, b] });
const sum = values => values.reduce((a, b) => a + b, 0);
const close = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const widthsAt = (W, fractions) => {
  const widths = fractions.map(fraction => W * fraction);
  widths[widths.length - 1] = W - sum(widths.slice(0, -1));
  return widths;
};

function measured(groups, W, H, widths) {
  let coverage = 0;
  const fills = [];
  groups.forEach((g, i) => g.photoIndices.forEach((index, child) => {
    const iw = widths[i] - 2, ih = g.childHeights[child] - (child ? 2 : 0);
    const ratio = groups.ratios[index];
    const fill = Math.exp(-Math.abs(Math.log(ratio) - (Math.log(iw) - Math.log(ih))));
    fills.push(fill);
    coverage += (iw / W) * (ih / H) * fill;
  }));
  return { coverage, meanFill: sum(fills) / fills.length, minFill: Math.min(...fills) };
}

function verify(result, input, W, H, currentWidths, range) {
  assert.equal(result.height, H, 'row height never changes');
  assert.equal(result.groups.length, input.length);
  assert.deepEqual(result.localRange, range);
  assert.ok(range[1] - range[0] + 1 <= 3);
  const ratios = input.flatMap(g => g.ratios), indices = [];
  result.groups.forEach((g, i) => {
    assert.equal(g.type, input[i].type, 'no topology changes or permutations');
    assert.equal(g.photoIndices.length, input[i].ratios.length);
    assert.equal(g.childHeights.length, g.photoIndices.length);
    assert.ok(Number.isFinite(g.width) && g.width > 2);
    if (i < range[0] || i > range[1]) assert.equal(g.width, currentWidths[i], 'outside width is EXACT, not scaled');
    close(sum(g.childHeights), H - 2);
    if (g.type === 'single') assert.equal(g.childHeights[0], H - 2);
    g.photoIndices.forEach((index, child) => {
      indices.push(index);
      const iw = g.width - 2, ih = g.childHeights[child] - (child ? 2 : 0), ratio = ratios[index];
      assert.ok(Number.isFinite(ih) && ih > 0, 'Duo gap is exactly 2px and leaves a positive inner box');
      // Log-space checks preserve contain/aspect assertions even where a physical
      // rendered dimension or scale would underflow or lose subnormal precision.
      const logScale = Math.min(Math.log(iw) - Math.log(ratio), Math.log(ih));
      const logPhotoW = Math.log(ratio) + logScale, logPhotoH = logScale;
      close(logPhotoW - logPhotoH, Math.log(ratio));
      assert.ok(logPhotoW <= Math.log(iw) + 1e-10);
      assert.ok(logPhotoH <= Math.log(ih) + 1e-10);
      assert.ok(Math.abs(logPhotoW - Math.log(iw)) <= 1e-10 || Math.abs(logPhotoH - Math.log(ih)) <= 1e-10);
      const scale = Math.min(iw / ratio, ih);
      const photoW = ratio * scale, photoH = scale;
      const minNormal = Number.MIN_VALUE / Number.EPSILON;
      if (photoW >= minNormal && scale >= minNormal && Number.isFinite(photoW)) {
        close(photoW / photoH, ratio);
        assert.ok(photoW <= iw + Math.max(1, iw) * 1e-12, 'contain never crops horizontally');
        assert.ok(photoH <= ih + Math.max(1, ih) * 1e-12, 'contain never crops vertically');
        close(Math.max(photoW / iw, photoH / ih), 1);
      }
    });
    if (g.type === 'dual' && input[i].ratios.every(r => r >= 1e-8 && r <= 1e8)) {
      close(g.childHeights[0] * input[i].ratios[0], (g.childHeights[1] - 2) * input[i].ratios[1]);
      close(g.childHeights[0], (H - 4) * input[i].ratios[1] / sum(input[i].ratios));
    }
  });
  assert.deepEqual(indices, ratios.map((_, i) => i), 'photo indices are local, complete and in original order');
  close(sum(result.groups.map(g => g.width)), W);
  // Independent contain-area measurement, including borders and exactly one Duo gap.
  const groups = result.groups.slice();
  groups.ratios = ratios;
  const actual = measured(groups, W, H, result.groups.map(g => g.width));
  const baseline = measured(groups, W, H, currentWidths);
  close(result.coverage, actual.coverage);
  close(result.meanFill, actual.meanFill);
  close(result.minFill, actual.minFill);
  close(result.quality, result.meanFill * 0.85 + result.minFill * 0.15);
  close(result.baselineCoverage, baseline.coverage);
  assert.ok(result.coverage >= result.baselineCoverage, 'not even floating-point degradation is accepted');
  assert.equal(result.gain, result.coverage - result.baselineCoverage);
  [result.coverage, result.meanFill, result.minFill, result.quality, result.baselineCoverage, result.gain]
    .forEach(value => assert.ok(Number.isFinite(value) && value >= 0 && value <= 1));
  const d = result.diagnostics;
  assert.equal(d.partitions, 0);
  assert.equal(d.packingCandidates, 0);
  assert.equal(d.shortlistCount, 0);
  assert.equal(d.heightSamples, 1);
  assert.equal(d.localGroupCount, range[1] - range[0] + 1);
  assert.ok(d.evaluatedLayouts >= 1 && d.evaluatedLayouts <= 2);
  assert.ok(d.widthSolves >= 0 && d.widthSolves <= 1);
  assert.equal(d.boundedChecks, d.widthSolves * 60);
  assert.equal(d.reordered, false);
  assert.equal(d.preserveTopology, true);
}

const fixtures = [
  {
    name: 'two portrait photos in an overly wide Duo',
    groups: [dual(0.6, 0.67), single(1.6), single(1.8)],
    W: 1915, H: 500, widths: [1050, 430, 435], anchor: 0, minimumGain: 0.25
  },
  {
    name: 'two portrait Duos borrow locally from a landscape Single',
    groups: [dual(0.6, 0.67), dual(0.7, 0.6), single(1.6)],
    W: 1915, H: 500, widths: [800, 800, 315], anchor: 1, minimumGain: 0.30
  },
  {
    name: 'square covers in an overly wide and low Duo',
    groups: [dual(1, 1), single(1.5), single(1.8)],
    W: 1915, H: 330, widths: [1100, 390, 425], anchor: 0, minimumGain: 0.08
  },
  {
    name: 'landscape Single in a box that is far too tall',
    groups: [single(2.4), single(0.2), single(1), single(1.5)],
    W: 1366, H: 520, widths: [125, 721, 260, 260], anchor: 0, minimumGain: 0.22
  }
];

for (const fixture of fixtures) {
  test(`capture pathology: ${fixture.name} improves materially without cropping`, () => {
    const { groups, W, H, widths, anchor, minimumGain } = fixture;
    const result = refitRow(groups, W, H, widths, { anchorIndex: anchor, maxNeighbors: 1 });
    verify(result, groups, W, H, widths, [Math.max(0, anchor - 1), Math.min(groups.length - 1, anchor + 1)]);
    assert.ok(result.gain > minimumGain);
    assert.equal(result.diagnostics.decision, 'local-refit');
    console.log('ADAPTIVE_CONTAIN_FIXTURE', JSON.stringify({ name: fixture.name,
      before: result.baselineCoverage, after: result.coverage, gain: result.gain,
      beforeWidths: widths, afterWidths: result.groups.map(g => g.width), localRange: result.localRange,
      meanFill: result.meanFill, minFill: result.minFill, diagnostics: result.diagnostics }));
  });
}

test('CommonJS and browser UMD expose the exact API and frozen 2px geometry', () => {
  const layout = require('../gallery-layout.js');
  assert.deepEqual(Object.keys(layout).sort(), ['geometry', 'plan', 'refitRow']);
  assert.deepEqual(geometry, { border: 2, gap: 2, separator: 2 });
  assert.ok(Object.isFrozen(geometry));
  assert.throws(() => { geometry.border = 10; }, TypeError);
  for (const context of [{}, { window: {} }]) {
    vm.runInNewContext(fs.readFileSync(require.resolve('../gallery-layout.js'), 'utf8'), context);
    const exported = context.window ? context.window.ShiftingTilesLayout : context.ShiftingTilesLayout;
    assert.equal(typeof exported.plan, 'function');
    assert.equal(typeof exported.refitRow, 'function');
    assert.equal(JSON.stringify(exported.geometry), JSON.stringify(geometry));
    assert.ok(Object.isFrozen(exported.geometry));
  }
});

test('all anchor positions preserve exact widths outside their at-most-three-group window', () => {
  const groups = [single(2.4), dual(0.6, 1.3), single(0.7), dual(1, 1.8)];
  const W = 1915, H = 460, widths = widthsAt(W, [0.08, 0.52, 0.25, 0.15]);
  for (let anchor = 0; anchor < groups.length; anchor++) {
    const result = refitRow(groups, W, H, widths, { anchorIndex: anchor, maxNeighbors: 1 });
    verify(result, groups, W, H, widths, [Math.max(0, anchor - 1), Math.min(groups.length - 1, anchor + 1)]);
  }
});

test('one-group window leaves every width exact and performs no width solve', () => {
  const { groups, W, H, widths } = fixtures[0];
  const result = refitRow(groups, W, H, widths, { anchorIndex: 1, maxNeighbors: 0 });
  verify(result, groups, W, H, widths, [1, 1]);
  assert.deepEqual(result.groups.map(g => g.width), widths);
  assert.equal(result.gain, 0);
  assert.equal(result.diagnostics.widthSolves, 0);
  assert.equal(result.diagnostics.boundedChecks, 0);
});

test('a coverage-worse width solution returns the exact baseline, not a higher fill score', () => {
  const groups = [single(2.4), single(0.7), single(1), single(1.5)];
  const widths = [125, 421, 450, 370];
  const result = refitRow(groups, 1366, 520, widths, { anchorIndex: 0, maxNeighbors: 1 });
  verify(result, groups, 1366, 520, widths, [0, 1]);
  assert.equal(result.diagnostics.widthSolves, 1, 'candidate was evaluated before fallback');
  assert.equal(result.diagnostics.evaluatedLayouts, 2);
  assert.equal(result.diagnostics.decision, 'kept-baseline');
  assert.equal(result.gain, 0);
  assert.deepEqual(result.groups.map(g => g.width), widths);
});

test('already fitted geometry has no pointless refit or negative floating-point gain', () => {
  const { groups, W, H, widths, anchor } = fixtures[0];
  const first = refitRow(groups, W, H, widths, { anchorIndex: anchor, maxNeighbors: 1 });
  const current = first.groups.map(g => g.width);
  const second = refitRow(groups, W, H, current, { anchorIndex: anchor, maxNeighbors: 1 });
  verify(second, groups, W, H, current, [0, 1]);
  assert.deepEqual(second.groups, first.groups);
  assert.equal(second.gain, 0);
  assert.equal(second.diagnostics.decision, 'kept-baseline');
});

test('desktop, tablet and mobile retain every 4/5/6-photo topology and original order', () => {
  const shapes = [
    [single(2), single(0.6), single(1), single(1.7)],
    [dual(0.6, 1.2), single(1.8), single(0.7)],
    [dual(0.7, 1.8), dual(1, 1.3)],
    [dual(0.6, 0.7), dual(1.1, 1.2), single(1.8)],
    [single(1), dual(0.5, 2), single(1.8), single(0.8)],
    [dual(0.6, 1.8), dual(1, 1.2), dual(0.8, 1.6)],
    [single(1), dual(0.4, 2), dual(1.1, 1.5), single(0.7)]
  ];
  for (const [W, H] of [[1915, 462], [1024, 384], [390, 422]]) {
    for (const groups of shapes) {
      const fractions = groups.map((_, i) => i + 1), total = sum(fractions);
      const widths = widthsAt(W, fractions.map(f => f / total));
      for (let anchor = 0; anchor < groups.length; anchor++) {
        const result = refitRow(groups, W, H, widths, { anchorIndex: anchor, maxNeighbors: 1 });
        verify(result, groups, W, H, widths, [Math.max(0, anchor - 1), Math.min(groups.length - 1, anchor + 1)]);
      }
    }
  }
});

test('extreme finite natural aspects stay finite across normal, minimal and huge canvases', () => {
  const shapes = [
    [dual(Number.MIN_VALUE, Number.MAX_VALUE), dual(1e-300, 1e300)],
    [single(Number.MIN_VALUE), dual(1e-200, 1e200), single(Number.MAX_VALUE)],
    [single(Number.MIN_VALUE), single(Number.MAX_VALUE), single(1e-300), single(1e300)]
  ];
  for (const groups of shapes) {
    const tinyW = groups.length * 2 + 1e-10;
    for (const [W, H] of [[1915, 462], [1024, 384], [390, 422], [tinyW, 4 + 1e-10], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
      const widths = widthsAt(W, groups.map(() => 1 / groups.length));
      for (let anchor = 0; anchor < groups.length; anchor++) {
        const result = refitRow(groups, W, H, widths, { anchorIndex: anchor, maxNeighbors: 1 });
        verify(result, groups, W, H, widths, [Math.max(0, anchor - 1), Math.min(groups.length - 1, anchor + 1)]);
      }
    }
  }
});

test('local width bounds may be infeasible on a tiny canvas, but the baseline stays valid', () => {
  const groups = [dual(0.6, 1.6), dual(1, 1)];
  const widths = [2.00000000005, 2.00000000005], W = sum(widths), H = 4.0000000001;
  const result = refitRow(groups, W, H, widths, { anchorIndex: 0, maxNeighbors: 1 });
  verify(result, groups, W, H, widths, [0, 1]);
  assert.deepEqual(result.groups.map(g => g.width), widths);
  assert.equal(result.gain, 0);
  assert.equal(result.diagnostics.widthSolves, 0);
});

test('pure deterministic refit does not mutate frozen input, widths or options', () => {
  const fixture = fixtures[3];
  const groups = Object.freeze(fixture.groups.map(g => Object.freeze({ type: g.type, ratios: Object.freeze(g.ratios.slice()) })));
  const widths = Object.freeze(fixture.widths.slice());
  const options = Object.freeze({ anchorIndex: fixture.anchor, maxNeighbors: 1 });
  const before = JSON.stringify({ groups, widths, options });
  const result = refitRow(groups, fixture.W, fixture.H, widths, options);
  assert.deepEqual(result, refitRow(groups, fixture.W, fixture.H, widths, options));
  assert.equal(JSON.stringify({ groups, widths, options }), before);
  result.groups[0].photoIndices[0] = 99;
  assert.equal(refitRow(groups, fixture.W, fixture.H, widths, options).groups[0].photoIndices[0], 0);
});

test('invalid shapes, aspects, widths, canvas sizes and options fail explicitly', () => {
  const groups = [dual(0.6, 1.6), dual(1, 1)], W = 800, H = 400, widths = [400, 400];
  const fit = (g = groups, w = W, h = H, current = widths, options = { anchorIndex: 0, maxNeighbors: 1 }) => refitRow(g, w, h, current, options);
  for (const g of [null, {}, [], [dual(1, 1)], Array.from({ length: 5 }, () => single(1)),
    [single(1), single(1)], [dual(1, 1), dual(1, 1), dual(1, 1), single(1)],
    [dual(1, 1), { type: 'triple', ratios: [1, 1] }],
    [dual(1, 1), { type: 'single', ratios: [1, 1] }],
    [dual(1, 1), { type: 'dual', ratios: [1, ,] }],
    [dual(1, 1), , dual(1, 1)]]) assert.throws(() => fit(g), TypeError);
  for (const ratio of [0, -1, NaN, Infinity, -Infinity, '1', null, undefined]) {
    assert.throws(() => fit([dual(ratio, 1), dual(1, 1)]), TypeError);
  }
  for (const current of [null, {}, [], [800], [400, 400, 1], [0, 800], [-1, 801], [NaN, 400], [Infinity, 400], ['400', 400], [400, ,]]) {
    assert.throws(() => fit(groups, W, H, current), TypeError);
  }
  for (const current of [[2, 798], [1, 799], [400, 399]]) assert.throws(() => fit(groups, W, H, current), RangeError);
  for (const w of [0, -1, 4, NaN, Infinity, '800']) assert.throws(() => fit(groups, w), RangeError);
  for (const h of [0, -1, 4, NaN, Infinity, '400']) assert.throws(() => fit(groups, W, h), RangeError);
  const singles = Array.from({ length: 4 }, () => single(1));
  assert.throws(() => fit(singles, 8, H, [2, 2, 2, 2]), RangeError);
  assert.throws(() => fit(singles, W, 2, [200, 200, 200, 200]), RangeError);
  for (const options of [null, [], {}, { anchorIndex: 0.5 }, { anchorIndex: '0' }, { anchorIndex: NaN },
    { anchorIndex: 0, maxNeighbors: 0.5 }, { anchorIndex: 0, maxNeighbors: '1' }, { anchorIndex: 0, maxNeighbors: null }]) {
    assert.throws(() => fit(groups, W, H, widths, options), TypeError);
  }
  for (const options of [{ anchorIndex: -1 }, { anchorIndex: 2 }, { anchorIndex: 0, maxNeighbors: 2 }, { anchorIndex: 0, maxNeighbors: -1 }]) {
    assert.throws(() => fit(groups, W, H, widths, options), RangeError);
  }
  assert.deepEqual(fit(groups, W, H, widths, { anchorIndex: 0 }), fit());
});

test('floating-point width sums are tolerated, but material mismatches and overflowing sums are not', () => {
  const groups = [dual(1, 1), dual(1, 1)];
  const W = 1000, widths = [500, 500 + 1e-9];
  const result = refitRow(groups, W, 400, widths, { anchorIndex: 0, maxNeighbors: 1 });
  verify(result, groups, W, 400, widths, [0, 1]);
  assert.throws(() => refitRow(groups, W, 400, [500, 499.9], { anchorIndex: 0, maxNeighbors: 1 }), RangeError);
  assert.throws(() => refitRow(groups, Number.MAX_VALUE, 400, [Number.MAX_VALUE, Number.MAX_VALUE], { anchorIndex: 0, maxNeighbors: 1 }), RangeError);
});

test('local fitting leaves startup eight-photo optimization and 8..12-photo preservation intact', () => {
  const input = [[single(1), dual(1, 1), single(1.6)], [single(1.5), single(0.6), dual(1.5, 1)]];
  const startup = plan(input, 1915, 924);
  assert.equal(startup.photoCount, 8);
  assert.equal(startup.diagnostics.partitions, 35);
  assert.equal(startup.diagnostics.packingCandidates, 3500);
  const ratios = input.flatMap(row => row.flatMap(g => g.ratios));
  const row = startup.rows[0], localGroups = row.groups.map(g => ({ type: g.type, ratios: g.photoIndices.map(i => ratios[i]) }));
  const refitted = refitRow(localGroups, 1915, row.height, row.groups.map(g => g.width), { anchorIndex: 0, maxNeighbors: 1 });
  assert.deepEqual(refitted.groups.flatMap(g => g.photoIndices), Array.from({ length: 4 }, (_, i) => i));
  const preserved = plan(input, 390, 844, startup, { preserveTopology: true });
  assert.equal(preserved.diagnostics.partitions, 0);
  assert.deepEqual(preserved.rows.map(r => r.groups.map(g => g.photoIndices)), startup.rows.map(r => r.groups.map(g => g.photoIndices)));
  for (const photoCount of [9, 10, 11, 12]) {
    const first = Math.ceil(photoCount / 2), second = photoCount - first;
    const makeRow = count => count === 4 ? [dual(1, 1), dual(1, 1)] :
      count === 5 ? [dual(1, 1), dual(1, 1), single(1)] : [dual(1, 1), dual(1, 1), dual(1, 1)];
    const dynamic = plan([makeRow(first), makeRow(second)], 390, 844);
    assert.equal(dynamic.photoCount, photoCount);
    assert.equal(dynamic.diagnostics.partitions, 0);
    assert.equal(dynamic.diagnostics.packingCandidates, 0);
  }
});

test('bounded local work remains independent of startup packing search', () => {
  const fixture = fixtures[1], calls = 1000, start = performance.now();
  for (let i = 0; i < calls; i++) {
    const result = refitRow(fixture.groups, fixture.W, fixture.H, fixture.widths, { anchorIndex: 1, maxNeighbors: 1 });
    assert.equal(result.diagnostics.widthSolves, 1);
    assert.equal(result.diagnostics.boundedChecks, 60);
    assert.equal(result.diagnostics.evaluatedLayouts, 2);
    assert.equal(result.diagnostics.localGroupCount, 3);
    assert.equal(result.diagnostics.packingCandidates, 0);
  }
  console.log('ADAPTIVE_BOUNDED_RUNTIME', JSON.stringify({ calls, elapsedMs: +(performance.now() - start).toFixed(3), maxGroups: 3, maxWidthSolves: 1, maxBisections: 60, advisoryOnly: true }));
});
