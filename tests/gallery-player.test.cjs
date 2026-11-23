'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const player = require('../gallery-player.js');
function fixture() {
  const dom = new JSDOM('<!doctype html><body><div id="gallery" class="shiftingtiles"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.resolve(__dirname, '../jquery-1.8.3.js'), 'utf8'));
  const $ = w.jQuery, g = $('#gallery'), queue = new Map();
  let serial = 0, resize, width = 1600, height = 800, plans = 0;
  w.requestAnimationFrame = fn => { queue.set(++serial, fn); return serial; };
  w.cancelAnimationFrame = n => queue.delete(n);
  w.ResizeObserver = class { constructor(fn) { resize = fn; } observe() {} disconnect() {} };
  for (let r = 0; r < 2; r++) g.append('<div class="row"><div class="single"></div><div class="single"></div><div class="dual"><div></div><div></div></div></div>');
  Object.defineProperties(g[0], { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
  g.find('.single,.dual>div').each(function (i) {
    const marker = {};
    this.style.backgroundImage = 'url("p' + i + '.jpg")';
    $(this).data('st-photo-url', 'p' + i + '.jpg').data('st-natural-width', 100 + i * 10).data('st-natural-height', 100).data('st-image-request', marker).data('st-image-loaded-request', marker);
  });
  const state = { albumSize: 443, loading: false, animating: false };
  g.data('shiftingtiles-playback', { stats: () => state });
  w.ShiftingTilesLayout = { plan: () => { plans++; return { rows: [0, 1].map(r => ({ height: height / 2, groups: [0, 1, 2, 3].map(i => ({ type: 'single', photoIndices: [r * 4 + i], width: width / 4, childHeights: [height / 2 - 4] })) })) }; } };
  return { dom, w, $, g, state, queue, plans: () => plans, flush: () => { const fns = Array.from(queue.values()); queue.clear(); fns.forEach(fn => fn()); }, resize: (x, y) => { width = x; height = y; resize(); } };
}
test('initial fit preserves eight loaded URLs and metadata, without requesting images', () => {
  const f = fixture(); try {
    f.w.Image = function () { throw Error('No new image requests'); };
    const c = player.attach(f.g); f.flush();
    assert.equal(f.plans(), 1); assert.equal(f.g.find('.single').length, 8);
    assert.equal(new Set(f.g.find('.single').toArray().map(n => f.$(n).data('st-photo-url'))).size, 8);
    assert.equal(c.metrics().fits, 1); c.destroy();
  } finally { f.dom.window.close(); }
});
test('photo events do not change geometry or rearrange existing nodes', () => {
  const f = fixture(); try {
    const c = player.attach(f.g); f.flush(); const node = f.g.find('.single')[0];
    f.$(node).data('st-photo-url', 'new.jpg').data('st-natural-width', 60); node.style.backgroundImage = 'url("new.jpg")';
    f.g.trigger('st-image-ready'); f.g.trigger('st-animate-after'); f.flush();
    assert.equal(f.plans(), 1); assert.equal(f.g.find('.single')[0], node); assert.equal(c.metrics().fits, 1); c.destroy();
  } finally { f.dom.window.close(); }
});
test('resize waits for animation/load completion and fits only once per resize', () => {
  const f = fixture(); try {
    const c = player.attach(f.g); f.flush(); const node = f.g.find('.single').first().addClass('disappear');
    f.resize(1200, 900); f.flush(); assert.equal(f.plans(), 1);
    node.removeClass('disappear'); f.state.loading = true; f.g.trigger('st-animate-after'); f.flush(); assert.equal(f.plans(), 1);
    f.state.loading = false; f.g.trigger('st-image-ready'); f.flush(); assert.equal(f.plans(), 2);
    f.g.trigger('st-animate-after'); f.flush(); assert.equal(f.plans(), 2); c.destroy();
  } finally { f.dom.window.close(); }
});
test('duplicate or pending photo metadata does not fit; nine-photo albums retain Single boxes', () => {
  const f = fixture(); try {
    const leaf = f.g.find('.single').first(); leaf.data('st-photo-url', 'p1.jpg');
    const c = player.attach(f.g); f.flush(); assert.equal(f.plans(), 0);
    leaf.data('st-photo-url', 'p0.jpg'); f.state.albumSize = 9; f.g.trigger('st-initial-ready'); f.flush();
    assert.equal(f.plans(), 0); assert.equal(f.g.find('.single').length, 4); assert.ok(c.metrics().smallAlbum); c.destroy();
  } finally { f.dom.window.close(); }
});

const layout = require('../gallery-layout.js');
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const rowCounts = f => Array.from(f.g.children('.row')).map(row => f.$(row).children('.single,.dual').not('.disappear').toArray()
  .reduce((n, group) => n + (f.$(group).hasClass('dual') ? 2 : 1), 0));
const photoLeaves = f => f.g.children('.row').children('.single,.dual').not('.disappear').toArray()
  .flatMap(group => f.$(group).hasClass('dual') ? Array.from(group.children) : [group]);

function geometryFixture(counts = [5, 6], variant = 0, unknownChildren = false) {
  const f = fixture(), calls = [];
  const sizes = variant ? { 4: [1, 1, 1, 1], 5: [1, 1, 2, 1], 6: [1, 2, 2, 1] } :
    { 4: [1, 2, 1], 5: [1, 2, 2], 6: [2, 2, 2] };
  let photoSerial = 0;
  f.install = nextCounts => {
    f.g.empty();
    nextCounts.forEach((count, r) => {
      const row = f.w.document.createElement('div');
      row.className = 'row';
      row.getBoundingClientRect = () => ({ width: f.g[0].clientWidth,
        height: f.g[0].clientHeight * (row.style.height ? parseFloat(row.style.height) / 100 : (r ? 0.4 : 0.6)) });
      const parts = sizes[count], total = parts.reduce((n, _, i) => n + i + 2, 0);
      parts.forEach((n, j) => {
        const group = f.w.document.createElement('div'), fraction = (j + 2) / total;
        group.className = n === 1 ? 'single' : 'dual';
        group.style.setProperty('--st-box-width', fraction * 50 + '%');
        group.style.setProperty('--st-start-width', fraction * 50 + '%');
        group.getBoundingClientRect = () => ({ width: parseFloat(group.style.getPropertyValue('--st-box-width')) / 50 * f.g[0].clientWidth,
          height: row.getBoundingClientRect().height - 4 });
        const leaves = n === 1 ? [group] : [f.w.document.createElement('div'), f.w.document.createElement('div')];
        leaves.forEach((leaf, c) => {
          const id = photoSerial++, marker = {};
          leaf.style.backgroundImage = `url("geometry-${id}.jpg")`;
          f.$(leaf).data('st-photo-url', `geometry-${id}.jpg`).data('st-natural-width', [65, 170, 115, 230, 80][id % 5])
            .data('st-natural-height', 100).data('st-image-request', marker).data('st-image-loaded-request', marker);
          if (n === 2) {
            leaf.getBoundingClientRect = () => {
              const height = row.getBoundingClientRect().height;
              return { width: group.getBoundingClientRect().width - 4,
                height: unknownChildren ? 0 : leaf.style.height ? parseFloat(leaf.style.height) / 100 * (height - 4) :
                  c ? height - 4 - (height - 8) * 0.42 : (height - 8) * 0.42 };
            };
            group.appendChild(leaf);
          }
        });
        row.appendChild(group);
      });
      f.g[0].appendChild(row);
    });
  };
  f.install(counts);
  f.w.Image = function () { throw Error('No image requests during geometry changes'); };
  f.w.ShiftingTilesLayout = { plan: (rows, W, H, current, options) => {
    calls.push({ rows, W, H, current, options });
    return layout.plan(rows, W, H, current, options);
  } };
  f.calls = calls;
  return f;
}

function verifyDomGeometry(f, counts, W, H) {
  assert.deepEqual(rowCounts(f), counts);
  const leaves = photoLeaves(f);
  assert.equal(leaves.length, counts[0] + counts[1]);
  assert.equal(new Set(leaves.map(leaf => f.$(leaf).data('st-photo-url'))).size, leaves.length);
  near(f.g.children('.row').toArray().reduce((n, row) => n + row.getBoundingClientRect().height, 0), H);
  f.g.children('.row').each(function () {
    const height = this.getBoundingClientRect().height, groups = f.$(this).children('.single,.dual').not('.disappear').toArray();
    assert.ok(groups.length >= 2 && groups.length <= 4);
    near(groups.reduce((n, group) => n + group.getBoundingClientRect().width, 0), W);
    groups.forEach(group => {
      assert.equal(group.style.getPropertyValue('--st-box-width'), group.style.getPropertyValue('--st-start-width'));
      assert.ok(group.getBoundingClientRect().width > 4);
      if (f.$(group).hasClass('dual')) {
        near(Array.from(group.children).reduce((n, leaf) => n + parseFloat(leaf.style.height), 0), 100);
        assert.ok(parseFloat(group.children[0].style.height) > 0);
        assert.ok(parseFloat(group.children[1].style.height) / 100 * (height - 4) > 4);
      }
    });
  });
}

test('DOM geometry handles every 4/5/6 row combination on desktop, tablet and mobile', () => {
  for (const a of [4, 5, 6]) for (const b of [4, 5, 6]) for (const variant of [0, 1]) {
    const f = geometryFixture([a, b], variant);
    try {
      f.state.structureChanges = 1;
      const nodes = f.g.children('.row').children().toArray(), urls = photoLeaves(f).map(leaf => f.$(leaf).data('st-photo-url'));
      const c = player.attach(f.g);
      for (const [W, H] of [[1915, 924], [1024, 768], [390, 844]]) {
        f.resize(W, H); f.flush();
        verifyDomGeometry(f, [a, b], W, H);
        assert.deepEqual(f.g.children('.row').children().toArray(), nodes);
        assert.deepEqual(photoLeaves(f).map(leaf => f.$(leaf).data('st-photo-url')), urls);
        assert.deepEqual(c.metrics().rowPhotoCounts, [a, b]);
        assert.equal(c.metrics().photoCount, a + b);
        assert.equal(c.metrics().rearranged, false);
        assert.equal(f.calls.at(-1).options.preserveTopology, true);
        assert.equal(c.metrics().diagnostics.partitions, 0);
      }
      assert.equal(f.calls.length, 3);
      c.destroy();
    } finally { f.dom.window.close(); }
  }
});

test('unmeasured Duo children keep outer widths and derive inverse-aspect heights', () => {
  const f = geometryFixture([5, 6], 0, true);
  try {
    const c = player.attach(f.g); f.flush();
    assert.ok(f.calls[0].current, 'outer geometry remains available');
    assert.ok(f.calls[0].current.rows.some(row => row.groups.some(group => group.type === 'dual' && group.childHeights == null)));
    verifyDomGeometry(f, [5, 6], 1600, 800);
    const result = c.metrics(), ratios = f.calls[0].rows.flatMap(row => row.flatMap(group => group.ratios));
    result.rows.forEach(row => row.groups.filter(group => group.type === 'dual').forEach(group => {
      near(group.childHeights[0] * ratios[group.photoIndices[0]], (group.childHeights[1] - 4) * ratios[group.photoIndices[1]]);
    }));
    c.destroy();
  } finally { f.dom.window.close(); }
});

test('variable snapshots reject duplicates, pending metadata and malformed leaves until ready', () => {
  for (const counts of [[4, 6], [5, 5], [6, 6]]) {
    const f = geometryFixture(counts);
    try {
      const leaves = photoLeaves(f), first = f.$(leaves[0]), url = first.data('st-photo-url');
      first.data('st-photo-url', f.$(leaves.at(-1)).data('st-photo-url'));
      const c = player.attach(f.g); f.flush(); assert.equal(f.calls.length, 0);
      first.data('st-photo-url', url).data('st-image-request', {});
      f.g.trigger('st-image-ready'); f.flush(); assert.equal(f.calls.length, 0);
      first.data('st-image-loaded-request', first.data('st-image-request'));
      const dual = f.g.find('.dual')[0], missing = dual.children[1];
      dual.removeChild(missing);
      f.g.trigger('st-initial-ready'); assert.doesNotThrow(() => f.flush()); assert.equal(f.calls.length, 0);
      dual.appendChild(missing);
      f.g.trigger('st-image-ready'); f.flush(); assert.equal(f.calls.length, 1);
      assert.equal(c.metrics().photoCount, counts[0] + counts[1]);
      c.destroy();
    } finally { f.dom.window.close(); }
  }
});

test('rows below four, above six, or above four groups do not produce a snapshot', () => {
  let serial = 0;
  function appendUnique(f, row, type) {
    const clone = f.g.find('.' + type).first().clone(), marker = {};
    const leaves = type === 'dual' ? clone.children() : clone;
    leaves.each(function () {
      const url = `extra-${serial++}.jpg`;
      this.style.backgroundImage = `url("${url}")`;
      f.$(this).data('st-photo-url', url).data('st-natural-width', 100).data('st-natural-height', 100)
        .data('st-image-request', marker).data('st-image-loaded-request', marker);
    });
    row.append(clone);
  }
  for (const mutate of [
    f => f.g.children('.row').first().children('.dual').remove(),
    f => { const row = f.g.children('.row').first(); appendUnique(f, row, 'single'); appendUnique(f, row, 'single'); },
    f => appendUnique(f, f.g.children('.row').last(), 'dual')
  ]) {
    const f = geometryFixture([4, 6]);
    try {
      mutate(f);
      const c = player.attach(f.g); f.flush(); assert.equal(f.calls.length, 0); c.destroy();
    } finally { f.dom.window.close(); }
  }
});

test('initial variable snapshots and resize reject mid-animation DOM then begin after its end', () => {
  const f = geometryFixture([5, 6]);
  try {
    const outgoing = f.g.find('.single').first(), incoming = outgoing.clone();
    const url = 'new-transition.jpg', marker = {};
    incoming[0].style.backgroundImage = `url("${url}")`;
    incoming.data('st-photo-url', url).data('st-natural-width', 130).data('st-natural-height', 100)
      .data('st-image-request', marker).data('st-image-loaded-request', marker);
    incoming[0].getBoundingClientRect = outgoing[0].getBoundingClientRect;
    outgoing.addClass('disappear').parent().append(incoming);
    f.state.animating = true;
    const c = player.attach(f.g); f.flush(); assert.equal(f.calls.length, 0);
    f.resize(1024, 768); f.g.trigger('st-image-ready'); f.flush(); assert.equal(f.calls.length, 0);
    f.state.animating = false;
    f.g.trigger('st-animate-after'); f.flush(); assert.equal(f.calls.length, 0, 'outgoing clone still blocks snapshot');
    outgoing.remove(); f.g.trigger('st-animate-after'); f.flush(); assert.equal(f.calls.length, 1);
    verifyDomGeometry(f, [5, 6], 1024, 768);
    assert.equal(c.metrics().fits, 1);
    f.g.trigger('st-image-ready'); f.g.trigger('st-animate-after'); f.flush(); assert.equal(f.calls.length, 1);
    c.destroy();
  } finally { f.dom.window.close(); }
});

test('a resize during variable playback waits for pending loads and animation, then coalesces', () => {
  const f = geometryFixture([6, 6]);
  try {
    const c = player.attach(f.g); f.flush(); assert.equal(f.calls.length, 1);
    const nodes = f.g.children('.row').children().toArray();
    f.state.loading = true;
    f.resize(1024, 768); f.flush(); assert.equal(f.calls.length, 1);
    f.resize(800, 900); f.resize(390, 844); f.g.trigger('st-image-ready'); f.flush(); assert.equal(f.calls.length, 1);
    f.state.loading = false; f.state.animating = true;
    f.g.trigger('st-image-ready'); f.flush(); assert.equal(f.calls.length, 1);
    f.state.animating = false; f.g.trigger('st-animate-after'); f.flush(); assert.equal(f.calls.length, 2);
    verifyDomGeometry(f, [6, 6], 390, 844);
    assert.deepEqual(f.g.children('.row').children().toArray(), nodes);
    f.g.trigger('st-animate-after'); f.g.trigger('st-image-ready'); f.resize(390, 844); f.flush();
    assert.equal(f.calls.length, 2); assert.equal(c.metrics().fits, 2); c.destroy();
  } finally { f.dom.window.close(); }
});

test('structural photo events do not fit; returning to four photos still preserves resize identity', () => {
  const f = geometryFixture([4, 4], 1);
  try {
    const c = player.attach(f.g); f.flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.preserveTopology, false, 'initial eight-photo optimizer is unchanged');
    f.install([5, 6]); f.state.structureChanges = 1;
    f.g.trigger('st-image-ready'); f.g.trigger('st-animate-after'); f.flush();
    assert.equal(f.calls.length, 1, 'no per-photo or structural fit');
    f.install([4, 4]); f.state.structureChanges = 2;
    const nodes = f.g.children('.row').children().toArray();
    f.resize(390, 844); f.flush(); assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.preserveTopology, true);
    assert.equal(c.metrics().diagnostics.partitions, 0);
    assert.deepEqual(f.g.children('.row').children().toArray(), nodes);
    verifyDomGeometry(f, [4, 4], 390, 844);
    c.destroy();
  } finally { f.dom.window.close(); }
});

test('observed variable topology remains sticky without structural stats after counts return to four', () => {
  const f = geometryFixture([5, 6]);
  try {
    const c = player.attach(f.g); f.flush();
    f.install([4, 4]);
    const nodes = f.g.children('.row').children().toArray();
    f.resize(1024, 768); f.flush();
    assert.equal(f.calls[1].options.preserveTopology, true);
    assert.deepEqual(f.g.children('.row').children().toArray(), nodes);
    c.destroy();
  } finally { f.dom.window.close(); }
});

test('resized Single/Duo clones retain shared CSS widths and do not trigger another fit', () => {
  const f = geometryFixture([5, 6], 1);
  try {
    const c = player.attach(f.g); f.flush(); f.resize(390, 844); f.flush();
    f.g.children('.row').children('.single,.dual').each(function () {
      const clone = f.$(this).clone()[0];
      for (const property of ['--st-box-width', '--st-start-width']) {
        assert.equal(clone.style.getPropertyValue(property), this.style.getPropertyValue(property));
        assert.ok(clone.style.getPropertyValue(property));
      }
      if (f.$(this).hasClass('dual')) Array.from(clone.children).forEach((leaf, i) => assert.equal(leaf.style.height, this.children[i].style.height));
    });
    f.g.trigger('st-image-ready'); f.g.trigger('st-animate-after'); f.flush();
    assert.equal(f.calls.length, 2);
    c.destroy(); f.resize(1024, 768); f.g.trigger('st-animate-after'); f.flush(); assert.equal(f.calls.length, 2);
  } finally { f.dom.window.close(); }
});

test('recreated source rows get a fresh initial fit without waiting for a resize', () => {
  const f = geometryFixture([5, 6]);
  try {
    f.state.structureChanges = 4;
    const c = player.attach(f.g); f.flush();
    assert.equal(f.calls.length, 1);
    f.install([4, 4]);
    const urls = photoLeaves(f).map(leaf => f.$(leaf).data('st-photo-url'));
    f.g.trigger('st-initial-ready'); f.flush();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.preserveTopology, false, 'new source restarts the initial optimizer');
    assert.equal(c.metrics().photoCount, 8);
    assert.deepEqual(new Set(photoLeaves(f).map(leaf => f.$(leaf).data('st-photo-url'))), new Set(urls));
    f.g.trigger('st-image-ready'); f.g.trigger('st-animate-after'); f.flush();
    assert.equal(f.calls.length, 2);
    f.state.structureChanges = 5;
    f.resize(1024, 768); f.flush();
    assert.equal(f.calls[2].options.preserveTopology, true, 'subsequent structural changes preserve identity again');
    c.destroy();
  } finally { f.dom.window.close(); }
});

test('cancelled precache resumes only a pending resize and does not fit on ordinary failures', () => {
  const f = geometryFixture([5, 6]);
  try {
    const c = player.attach(f.g); f.flush();
    f.g.trigger('st-preload-cancelled'); f.flush();
    assert.equal(f.calls.length, 1);
    f.state.loading = true;
    f.resize(1200, 900); f.flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.queue.size, 0);
    f.state.loading = false;
    f.g.trigger('st-preload-cancelled');
    assert.equal(f.queue.size, 1);
    f.flush();
    assert.equal(f.calls.length, 2);
    assert.equal(c.metrics().width, 1200);
    assert.equal(c.metrics().height, 900);
    f.g.trigger('st-preload-cancelled'); f.flush();
    assert.equal(f.calls.length, 2);
    c.destroy();
  } finally { f.dom.window.close(); }
});

test('local fits alone preserve eight-photo topology on resize, and a fresh source resets the baseline', () => {
  const f = geometryFixture([4, 4], 1);
  try {
    f.state.localFits = 0;
    const c = player.attach(f.g); f.flush();
    assert.equal(f.calls[0].options.preserveTopology, false);
    f.install([4, 4]); f.state.localFits = 1;
    const nodes = f.g.children('.row').children().toArray();
    f.g.trigger('st-image-ready'); f.g.trigger('st-animate-after'); f.flush();
    assert.equal(f.calls.length, 1, 'no global plan on a local replacement');
    f.resize(1024, 768); f.flush();
    assert.equal(f.calls[1].options.preserveTopology, true);
    assert.equal(c.metrics().diagnostics.partitions, 0);
    assert.deepEqual(f.g.children('.row').children().toArray(), nodes);
    f.install([4, 4]); f.g.trigger('st-initial-ready'); f.flush();
    assert.equal(f.calls[2].options.preserveTopology, false, 'new source is not stuck with a former local-fit baseline');
    f.install([4, 4]); f.state.localFits = 2;
    const nextNodes = f.g.children('.row').children().toArray();
    f.resize(390, 844); f.flush();
    assert.equal(f.calls[3].options.preserveTopology, true);
    assert.deepEqual(f.g.children('.row').children().toArray(), nextNodes);
    c.destroy();
  } finally {f.dom.window.close();}
});
