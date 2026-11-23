'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

function fixture(count = 40, options = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="gallery gallery-balanced"></div></body>', {
    url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(ROOT, 'jquery-1.8.3.js'), 'utf8'));
  const $ = w.jQuery, gallery = $('.gallery'), requests = [], timers = new Map();
  let id = 0, W = 1600, H = 900, hidden = false, fits = 0, plans = 0;
  Object.defineProperty(w.document, 'hidden', {get: () => hidden});
  Object.defineProperties(gallery[0], {clientWidth: {get: () => W}, clientHeight: {get: () => H}});
  w.setTimeout = (fn, ms) => {timers.set(++id, {fn, ms}); return id;};
  w.clearTimeout = n => timers.delete(n);
  w.Image = class {constructor() {this.naturalWidth = 2000; this.naturalHeight = 1000;} set src(url) {this.url = url; requests.push(this);}};
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    if(this === gallery[0]) return {width: W, height: H};
    const row = this.classList.contains('row') ? this : this.closest('.row');
    const height = row ? H * parseFloat(row.style.height || '50') / 100 : H;
    if(this === row) return {width: W * 2, height};
    const group = this.parentElement && this.parentElement.classList.contains('dual') ? this.parentElement : this;
    const width = W * 2 * parseFloat(group.style.getPropertyValue('--st-box-width') || (group.classList.contains('dual') ? '10' : '20')) / 100;
    return group === this ? {width, height} : {width: width - 4, height: (height - 4) * parseFloat(this.style.height || '50') / 100};
  };
  w.Math.random = () => 0.999999;
  for(const file of ['album-queue.js', 'gallery-layout.js', 'shiftingtiles.js']) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  assert.equal(typeof w.ShiftingTilesLayout.refitRow, 'function', 'the real planner API is required');
  const realRefit = w.ShiftingTilesLayout.refitRow, realPlan = w.ShiftingTilesLayout.plan;
  w.ShiftingTilesLayout.refitRow = (...args) => {fits++; return realRefit(...args);};
  w.ShiftingTilesLayout.plan = (...args) => {plans++; return realPlan(...args);};
  const source = Array.from({length: count}, (_, i) => `photos/album/p${i}.jpg`);
  gallery.shiftingtiles(source, Object.assign({
    dynamicRows: {enabled: true, probability: 1, minTransitionsBetweenChanges: 0, minTileWidth: 160, minTileHeight: 100},
    adaptiveLayout: {enabled: true, minGain: 0.02, maxNeighbors: 1}
  }, options));
  const api = gallery.data('shiftingtiles-playback');
  const boxes = () => gallery.children('.row').children('.single,.dual').not('.disappear');
  return {dom, w, $, gallery, requests, timers, source, api, boxes, realRefit,
    fits: () => fits, plans: () => plans,
    row: i => gallery.children('.row').eq(i),
    load(request, ratio = 2) {assert.equal(typeof request.onload, 'function'); request.naturalWidth = ratio * 1000; request.naturalHeight = 1000; request.onload();},
    initial() {requests.slice().forEach((request, i) => this.load(request, [2, 2, 1, 1][i % 4]));},
    choose(node, change = true) {
      const index = boxes().toArray().indexOf(node.jquery ? node[0] : node);
      assert.ok(index >= 0);
      const sequence = [(index + 0.01) / boxes().length, change ? 0 : 1];
      w.Math.random = () => sequence.length ? sequence.shift() : 0;
      return api.frame();
    },
    end() {gallery.find('.disappear').trigger('animationend');},
    hide(value) {hidden = value; $(w.document).trigger('visibilitychange');},
    resize(width, height) {W = width; H = height;},
    nominal: () => [...timers.values()].filter(t => t.ms === 5000),
    close() {api.destroy(); dom.window.close();}
  };
}

function invariant(f) {
  const s = f.api.stats(), urls = Array.from(s.visibleURLs);
  assert.equal(new Set(urls).size, urls.length, 'outgoing, stable and incoming URLs are unique');
  assert.ok(urls.every(url => f.source.includes(url)));
  assert.ok(Array.from(s.rowPhotoCounts).every(n => n >= 4 && n <= 6));
  assert.ok(f.nominal().length <= 1);
  return urls;
}
function geometry(f) {
  return f.boxes().toArray().map(n => ({node: n, style: n.getAttribute('style'), children: Array.from(n.children).map(c => c.getAttribute('style'))}));
}
function complete(f, node, ratios = [2, 2], change = true) {
  const before = f.requests.length, old = invariant(f);
  assert.equal(f.choose(node, change), true);
  const next = f.requests.slice(before);
  assert.ok(next.length >= 1 && next.length <= 2, 'no massive preload pool');
  assert.ok(next.every(request => !old.includes(request.url)));
  next.forEach((request, i) => f.load(request, ratios[i % ratios.length]));
  invariant(f); f.end(); invariant(f);
  assert.equal(f.api.stats().reservedCount, 0);
  assert.equal(f.nominal().length, 1);
  return next;
}

for(const [ratio, neighbor] of [[0.5, 2], [1, 2], [4, 0.5]]) test(`local ${ratio} aspect improves contain coverage without a global plan`, () => {
  const f = fixture(40, {dynamicRows: {enabled: false}});
  try {
    f.initial();
    const outgoing = f.row(0).children('.single').first(), sibling = outgoing.next();
    sibling.data('st-natural-width', neighbor * 1000).data('st-natural-height', 1000);
    const unchanged = f.row(0).children().last()[0], otherRow = geometry(f).slice(3), url = outgoing.data('st-photo-url');
    const oldWidth = outgoing[0].getBoundingClientRect().width, before = f.requests.length;
    assert.equal(f.choose(outgoing, false), true); assert.equal(f.requests.length, before + 1);
    const prior = geometry(f); f.load(f.requests[before], ratio);
    assert.equal(f.plans(), 0); assert.equal(f.api.stats().localFits, 1);
    assert.ok(f.api.stats().lastLocalFit.gain >= 0.02);
    assert.ok(f.api.stats().lastLocalFit.coverage > f.api.stats().lastLocalFit.baselineCoverage);
    assert.ok(f.gallery.hasClass('gallery-fitting'));
    assert.equal(outgoing.data('st-photo-url'), url);
    near(parseFloat(outgoing[0].style.getPropertyValue('--st-start-width')) / 50 * 1600, oldWidth);
    assert.equal(f.row(0).children().last()[0], unchanged);
    assert.equal(unchanged.getAttribute('style'), prior[2].style);
    assert.deepEqual(geometry(f).slice(-3), otherRow);
    near(f.row(0).children('.single,.dual').not('.disappear').toArray().reduce((sum, n) => sum + n.getBoundingClientRect().width, 0), 1600);
    invariant(f); f.end(); assert.ok(!f.gallery.hasClass('gallery-fitting')); invariant(f);
  } finally {f.close();}
});

test('candidate coverage chooses useful Duo, while poor square Duo stays Single and releases the extra URL', () => {
  for(const [ratios, type] of [[[2, 2], 'dual'], [[1, 1], 'single'], [[0.5, 0.5], 'single']]) {
    const f = fixture();
    try {
      f.initial(); const outgoing = f.row(0).children('.single').first(), old = geometry(f);
      assert.equal(f.choose(outgoing), true); assert.equal(f.requests.length, 10);
      f.load(f.requests[8], ratios[0]);
      assert.deepEqual(geometry(f), old); assert.equal(f.api.stats().seenCount, 8);
      f.load(f.requests[9], ratios[1]);
      const incoming = outgoing.next(); assert.ok(incoming.hasClass(type));
      assert.equal(f.api.stats().seenCount, type === 'dual' ? 10 : 9);
      assert.equal(f.api.stats().reservedCount, 0);
      if(type === 'dual') {
        assert.ok(f.api.stats().lastLocalFit.structuralGain >= 0.02);
        near(Array.from(incoming.children()).reduce((sum, n) => sum + parseFloat(n.style.height), 0), 100);
        assert.equal(incoming.data('st-photo-url'), undefined);
      } else {
        const released = f.requests[9].url; f.end();
        const next = complete(f, f.row(0).children('.single').first(), [2], false);
        assert.equal(next.length, 1); assert.equal(next[0].url, released, 'unused preload is next, not silently consumed');
        assert.ok(Array.from(f.api.stats().visibleURLs).includes(released));
      }
      invariant(f); f.end();
    } finally {f.close();}
  }
});

test('material threshold, probability, cooldown, capacity and row limits gate structure independently', () => {
  const threshold = fixture(40, {adaptiveLayout: {enabled: true, minGain: 0.99}});
  try {threshold.initial(); complete(threshold, threshold.row(0).children('.single').first());
    assert.deepEqual(Array.from(threshold.api.stats().rowPhotoCounts), [4, 4]); assert.equal(threshold.api.stats().localFits, 0);
  } finally {threshold.close();}
  for(const size of [9, 10]) {
    const f = fixture(size); try {f.initial(); const next = complete(f, f.row(0).children('.single').first());
      assert.equal(next.length, 1); assert.equal(f.api.stats().structureChanges, 0);
    } finally {f.close();}
  }
  const chance = fixture(40, {dynamicRows: {enabled: true, probability: 0}});
  try {chance.initial(); assert.equal(complete(chance, chance.row(0).children('.single').first()).length, 1);
    assert.equal(chance.api.stats().structureChanges, 0);
  } finally {chance.close();}
  const f = fixture(40, {dynamicRows: {enabled: true, probability: 1, minTransitionsBetweenChanges: 3}});
  try {f.initial(); complete(f, f.row(0).children('.single').first()); assert.equal(f.api.stats().structureChanges, 1);
    for(let i = 0; i < 3; i++) assert.equal(complete(f, f.row(0).children('.single').first()).length, 1);
    assert.equal(complete(f, f.row(0).children('.single').first(), [4, 4]).length, 2);
    assert.equal(f.api.stats().structureChanges, 2);
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [6, 4]);
  } finally {f.close();}
});

for(const reason of ['error', 'timeout']) test(`adaptive ${reason} rolls back both preloads, metadata and every width; stale callbacks are harmless`, () => {
  const f = fixture();
  try {
    f.initial(); const old = geometry(f), urls = invariant(f);
    f.choose(f.row(0).children('.single').first()); f.load(f.requests[8], 2);
    const stale = f.requests[9].onload;
    if(reason === 'error') f.requests[9].onerror();
    else {const entry = [...f.timers.entries()].find(([, t]) => t.ms === 20000); assert.ok(entry); f.timers.delete(entry[0]); entry[1].fn();}
    stale(); assert.deepEqual(geometry(f), old); assert.deepEqual(invariant(f), urls);
    assert.equal(f.api.stats().seenCount, 8); assert.equal(f.api.stats().reservedCount, 0);
    assert.equal(f.api.stats().localFits, 0); assert.equal(f.api.stats().animating, false);
    assert.ok(!f.gallery.hasClass('gallery-fitting')); assert.equal(f.requests.length, 10);
    assert.equal(f.nominal().length, 1);
  } finally {f.close();}
});

test('normal Duo replacement is atomic even with structural probability disabled', () => {
  const f = fixture();
  try {f.initial(); const old = geometry(f), urls = invariant(f);
    f.choose(f.row(0).children('.dual').first(), false);
    f.load(f.requests[8], 1); assert.deepEqual(geometry(f), old);
    f.requests[9].onerror(); assert.deepEqual(geometry(f), old); assert.deepEqual(invariant(f), urls);
    assert.equal(f.api.stats().reservedCount, 0); assert.equal(f.api.stats().seenCount, 8);
  } finally {f.close();}
});

test('hidden preload revalidates on resume; hide/end/leave/destroy clean fitting without new timers', () => {
  const f = fixture();
  try {f.initial(); const old = geometry(f);
    f.choose(f.row(0).children('.single').first()); f.hide(true);
    f.load(f.requests[8]); f.load(f.requests[9]); assert.deepEqual(geometry(f), old);
    assert.equal(f.nominal().length, 0); assert.equal(f.api.stats().seenCount, 8);
    f.hide(false); assert.ok(f.gallery.hasClass('gallery-fitting')); assert.equal(f.nominal().length, 1);
    f.hide(true); assert.ok(!f.gallery.hasClass('gallery-fitting')); assert.equal(f.api.stats().animating, false);
    f.hide(false); f.choose(f.row(0).children('.single').first());
    const callbacks = f.requests.filter(r => r.onload).map(r => r.onload), before = geometry(f);
    f.$(f.w.document.body).trigger(f.$.Event('keydown', {keyCode: 38}));
    callbacks.forEach(fn => fn()); assert.deepEqual(geometry(f), before);
    assert.equal(f.api.stats().reservedCount, 0); assert.equal(f.api.stats().loading, false);
    assert.equal(f.api.frame(), false); assert.ok(!f.gallery.hasClass('gallery-fitting'));
    f.api.destroy(); assert.equal(f.timers.size, 0);
  } finally {f.close();}
});

test('resize and extreme ratio invalidation keep DOM untouched, while valid resize uses current row dimensions', () => {
  const f = fixture();
  try {f.initial(); const old = geometry(f);
    f.choose(f.row(0).children('.single').first()); f.resize(0, 0);
    f.load(f.requests[8]); f.load(f.requests[9]);
    assert.deepEqual(geometry(f), old); assert.equal(f.api.stats().reservedCount, 0); assert.equal(f.api.stats().seenCount, 8);
    f.resize(1600, 900); f.choose(f.row(0).children('.single').first());
    f.load(f.requests.at(-2), 1e100); f.load(f.requests.at(-1), 1e-100);
    invariant(f); assert.equal(f.api.stats().reservedCount, 0); f.end();
    const outgoing = f.row(0).children('.single').first(); assert.ok(outgoing.length);
    f.choose(outgoing, false); f.resize(1200, 800); f.load(f.requests.at(-1), 0.5);
    near(f.row(0).children('.single,.dual').not('.disappear').toArray().reduce((n, box) => n + box.getBoundingClientRect().width, 0), 1200);
    assert.equal(f.plans(), 0); invariant(f); f.end();
  } finally {f.close();}
});

test('source refresh preserves reservations/history; new source cancels stale loads and recreates eight slots', () => {
  const f = fixture();
  try {f.initial(); f.choose(f.row(0).children('.single').first());
    const stale = f.requests.slice(8).map(r => r.onload);
    f.gallery.trigger('st-photos-update', [f.source.slice()]); assert.equal(f.api.stats().reservedCount, 2);
    const replacement = f.source.map(url => url.replace('album', 'replacement'));
    f.gallery.trigger('st-photos-update', [replacement]); stale.forEach(fn => fn());
    assert.equal(f.requests.length, 18); assert.equal(f.api.stats().seenCount, 0);
    f.requests.slice(10).forEach(r => f.load(r));
    assert.equal(f.api.stats().seenCount, 8); assert.equal(f.api.stats().reservedCount, 0);
    const urls = Array.from(f.api.stats().visibleURLs); assert.equal(new Set(urls).size, 8);
    assert.ok(urls.every(url => replacement.includes(url))); assert.equal(f.nominal().length, 1);
    assert.ok(!f.gallery.hasClass('gallery-fitting'));
  } finally {f.close();}
});

for(const size of [9, 10, 11, 17, 443]) test(`${size}-photo adaptive playback completes whole cycles with no repeat, duplicates or lost extra reservation`, () => {
  const f = fixture(size);
  try {
    f.initial(); let seed = 97331;
    f.w.Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
    let cycle = 1, displayed = new Set(f.api.stats().visibleURLs), incoming = new Set(displayed), completed = 0;
    for(let step = 0; step < 2000 && completed < 2; step++) {
      const n = f.requests.length, old = invariant(f);
      assert.equal(f.api.frame(), true, JSON.stringify(f.api.stats()));
      if(f.api.stats().cycle !== cycle) {
        assert.equal(displayed.size, size, 'full album was actually visible before reuse');
        cycle = f.api.stats().cycle; completed++; displayed = new Set(old); incoming = new Set();
      }
      const requests = f.requests.slice(n); assert.ok(requests.length >= 1 && requests.length <= 2);
      assert.equal(new Set(requests.map(r => r.url)).size, requests.length);
      assert.ok(requests.every(r => !old.includes(r.url)));
      requests.forEach(r => f.load(r, (Number(r.url.match(/p(\d+)/)[1]) % 3 + 1) * 0.8));
      const committed = invariant(f).filter(url => !old.includes(url));
      assert.ok(committed.length >= 1 && committed.length <= 2);
      for(const url of committed) {assert.equal(incoming.has(url), false, 'committed incoming URL never repeats in its cycle'); incoming.add(url); displayed.add(url);}
      f.end(); invariant(f); assert.equal(f.nominal().length, 1); assert.equal(f.api.stats().reservedCount, 0);
    }
    assert.equal(completed, 2); assert.equal(f.plans(), 0);
  } finally {f.close();}
});

test('missing planner API safely uses legacy playback; disabled adaptation does not call refit', () => {
  for(const disabled of [false, true]) {
    const f = fixture(40, disabled ? {adaptiveLayout: {enabled: false}} : {});
    try {f.initial(); if(!disabled) delete f.w.ShiftingTilesLayout.refitRow;
      complete(f, f.row(0).children('.single').first());
      assert.equal(f.fits(), 0); assert.equal(f.api.stats().localFits, 0);
      assert.equal(f.api.stats().adaptiveLayoutEnabled, !disabled);
    } finally {f.close();}
  }
});

test('Duo compaction is coverage-guided with the same first incoming photo, and releases its unused sibling', () => {
  for(const ratio of [0.5, 2]) {
    const f = fixture();
    try {
      f.initial(); complete(f, f.row(0).children('.single').first());
      assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [5, 4]);
      const outgoing = f.row(0).children('.dual').first(), n = f.requests.length, seen = f.api.stats().seenCount;
      f.choose(outgoing); assert.equal(f.requests.length, n + 2);
      f.load(f.requests[n], ratio); f.load(f.requests[n + 1], ratio);
      const incoming = outgoing.next();
      if(ratio === 0.5) {
        assert.ok(incoming.hasClass('single')); assert.equal(incoming.data('st-photo-url'), f.requests[n].url);
        assert.equal(f.api.stats().seenCount, seen + 1);
        assert.ok(f.api.stats().lastLocalFit.structuralGain >= 0.02);
        f.end(); const next = complete(f, f.row(0).children('.single').first(), [1], false);
        assert.equal(next[0].url, f.requests[n + 1].url);
      } else {
        assert.ok(incoming.hasClass('dual')); assert.equal(f.api.stats().seenCount, seen + 2);
        assert.equal(f.api.stats().structureChanges, 1, 'good Duo is not compacted merely because probability allows it');
      }
      invariant(f); f.end();
    } finally {f.close();}
  }
});

test('four-block rows adjust only anchor and one neighbor per side, preserving the fourth box and other row', () => {
  const f = fixture(40, {dynamicRows: {enabled: false}});
  try {
    f.initial(); const row = f.row(0), duo = row.children('.dual');
    duo.children().each(function () {f.$(this).clone(true).addClass('single').css('height', '').insertBefore(duo);}); duo.remove();
    row.children().each(function(i) {
      const width = [10, 20, 10, 10][i] + '%';
      this.style.setProperty('--st-box-width', width); this.style.setProperty('--st-start-width', width);
    });
    const nodes = row.children().toArray(), outside = geometry(f)[3], other = geometry(f).slice(4), oldHeight = row[0].getBoundingClientRect().height;
    complete(f, f.$(nodes[1]), [0.5], false);
    assert.equal(f.api.stats().localFits, 1); assert.deepEqual(Array.from(f.api.stats().lastLocalFit.localRange), [0, 2]);
    assert.equal(row.children()[0], nodes[0]); assert.equal(row.children()[2], nodes[2]); assert.equal(row.children()[3], nodes[3]);
    assert.deepEqual(geometry(f)[3], outside); assert.deepEqual(geometry(f).slice(4), other);
    near(row[0].getBoundingClientRect().height, oldHeight);
    near(row.children().toArray().reduce((n, node) => n + node.getBoundingClientRect().width, 0), 1600);
    assert.equal(f.plans(), 0);
  } finally {f.close();}
});

test('last pending photo forces one-photo merge when both six-photo rows have no Singles', () => {
  const f = fixture(17);
  try {
    f.initial();
    for(const row of [0, 1]) {
      complete(f, f.row(row).children('.single').first(), [2, 2]);
      complete(f, f.row(row).children('.single').first(), [4, 4]);
    }
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [6, 6]);
    assert.equal(f.gallery.find('.single').length, 0); assert.equal(f.api.stats().seenCount, 16);
    const next = complete(f, f.row(0).children('.dual').first(), [1], false);
    assert.equal(next.length, 1); assert.equal(f.api.stats().seenCount, 17);
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [5, 6]);
    assert.equal(f.api.stats().cycle, 1);
    complete(f, f.row(0).children('.single').first(), [1], false);
    assert.equal(f.api.stats().cycle, 2);
  } finally {f.close();}
});

test('a split that loses minimum dimensions on resize is cancelled without committing a normal substitute', () => {
  const f = fixture();
  try {
    f.initial(); const old = geometry(f), urls = invariant(f);
    f.choose(f.row(0).children('.single').first()); f.resize(1600, 400);
    f.load(f.requests[8]); f.load(f.requests[9]);
    assert.deepEqual(geometry(f), old); assert.deepEqual(invariant(f), urls);
    assert.equal(f.api.stats().seenCount, 8); assert.equal(f.api.stats().reservedCount, 0);
    assert.equal(f.api.stats().localFits, 0); assert.equal(f.api.stats().animating, false);
    assert.equal(f.nominal().length, 1);
  } finally {f.close();}
});

test('invalid incoming ratios abort atomically, including a loaded Duo sibling', () => {
  const f = fixture();
  try {
    f.initial(); const old = geometry(f), urls = invariant(f);
    f.choose(f.row(0).children('.dual').first(), false);
    f.load(f.requests[8], Infinity); f.load(f.requests[9], 1);
    assert.deepEqual(geometry(f), old); assert.deepEqual(invariant(f), urls);
    assert.equal(f.api.stats().seenCount, 8); assert.equal(f.api.stats().reservedCount, 0);
    assert.equal(f.api.stats().localFits, 0); assert.equal(f.api.stats().animating, false);
    assert.equal(f.nominal().length, 1);
  } finally {f.close();}
});

test('destroy during a local animation removes fitting and cancels the only nominal timer', () => {
  const f = fixture();
  try {
    f.initial(); f.choose(f.row(0).children('.single').first());
    f.load(f.requests[8]); f.load(f.requests[9]);
    assert.ok(f.gallery.hasClass('gallery-fitting')); assert.equal(f.nominal().length, 1);
    f.api.destroy();
    assert.ok(!f.gallery.hasClass('gallery-fitting')); assert.equal(f.timers.size, 0);
    assert.equal(f.api.stats().animating, false); assert.equal(f.api.stats().reservedCount, 0);
    invariant(f);
  } finally {f.close();}
});

for(const [name, widths, step, offset, structural] of [
  ['negative 1/64px sum', [639.99, 640.005, 320.005], 1 / 64, 0, false],
  ['positive 1/64px sum', [639.995, 640.009, 319.996], 1 / 64, 0, false],
  ['fractional clientWidth rounding', [639.99, 640.005, 320.005], 1 / 64, 0.4, false],
  ['quantized eligible split', [639.99, 640.005, 320.005], 1 / 64, 0, true]
]) test(`subpixel DOM ${name} is reconciled locally without rejecting the real planner`, () => {
  const f = fixture(40, structural ? {} : {dynamicRows: {enabled: false}});
  try {
    f.initial();
    f.row(0).children().each(function(i) {
      this.style.setProperty('--st-box-width', widths[i] / 1600 * 50 + '%');
      this.style.setProperty('--st-start-width', widths[i] / 1600 * 50 + '%');
    });
    const rect = f.w.HTMLElement.prototype.getBoundingClientRect;
    f.w.HTMLElement.prototype.getBoundingClientRect = function() {
      const measured = rect.call(this);
      const value = measured.width * (1600 + offset) / 1600;
      measured.width = Math.round(value / step) * step;
      return measured;
    };
    const nodes = f.row(0).children().toArray(), outgoing = f.$(nodes[0]);
    const rawWidths = nodes.map(node => node.getBoundingClientRect().width);
    assert.ok(Math.abs(rawWidths.reduce((sum, w) => sum + w, 0) - 1600) > 1e-6);
    const old = geometry(f), seen = f.api.stats().seenCount, calls = [];
    const refit = f.w.ShiftingTilesLayout.refitRow;
    f.w.ShiftingTilesLayout.refitRow = (...args) => {
      calls.push({width: args[1], widths: Array.from(args[3]), anchor: args[4].anchorIndex});
      return refit(...args);
    };
    const n = f.requests.length;
    assert.equal(f.choose(outgoing, structural), true);
    assert.equal(f.requests.length - n, structural ? 2 : 1);
    f.requests.slice(n).forEach(request => f.load(request, structural ? 2 : 0.5));
    assert.ok(calls.length >= 1, 'real refitRow must run with valid reconciled measurements');
    for(const call of calls) {
      near(call.widths.reduce((sum, w) => sum + w, 0), call.width);
      assert.equal(call.anchor, 0);
      assert.equal(call.widths[1], rawWidths[1]);
      assert.equal(call.widths[2], rawWidths[2], 'no global rescaling to conceal roundoff');
      near(call.widths[0], 1600 - rawWidths[1] - rawWidths[2]);
    }
    assert.equal(f.api.stats().localFits, 1);
    assert.ok(f.api.stats().lastLocalFit.gain >= 0.02);
    assert.equal(f.api.stats().seenCount, seen + (structural ? 2 : 1));
    assert.equal(f.api.stats().reservedCount, 0);
    assert.ok(outgoing.next().hasClass(structural ? 'dual' : 'single'));
    near(parseFloat(outgoing[0].style.getPropertyValue('--st-start-width')) / 50 * 1600, rawWidths[0]);
    assert.deepEqual(geometry(f).at(2), old[2], 'out-of-window box is exactly unchanged');
    assert.deepEqual(geometry(f).slice(-3), old.slice(-3), 'the other row is exactly unchanged');
    invariant(f); f.end(); invariant(f);
    assert.equal(f.nominal().length, 1);
    assert.ok(!f.gallery.hasClass('gallery-fitting'));
  } finally {f.close();}
});

test('materially mismatched DOM widths are not hidden by subpixel reconciliation', () => {
  const f = fixture();
  try {
    f.initial();
    f.row(0).children().each(function(i) {
      this.style.setProperty('--st-box-width', [640, 641.5, 320][i] / 1600 * 50 + '%');
    });
    const old = geometry(f), urls = invariant(f);
    assert.equal(f.choose(f.row(0).children('.single').first()), true);
    f.load(f.requests[8]); f.load(f.requests[9]);
    assert.equal(f.fits(), 0);
    assert.equal(f.api.stats().seenCount, 8);
    assert.equal(f.api.stats().reservedCount, 0);
    assert.equal(f.api.stats().localFits, 0);
    assert.equal(f.api.stats().animating, false);
    assert.deepEqual(geometry(f), old);
    assert.deepEqual(invariant(f), urls);
    assert.equal(f.nominal().length, 1);
  } finally {f.close();}
});
