'use strict';
// JSDOM + deterministic physical-rectangle fixture, not a real-browser rendering claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

function fixture(count = 40, options = {}, config = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="gallery"></div></body>', {
    url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(ROOT, 'jquery-1.8.3.js'), 'utf8'));
  const $ = w.jQuery, gallery = $('.gallery'), requests = [], timers = new Map(), rafs = new Map(), observers = [];
  let serial = 0, W = 1600, H = 900, hidden = false, progress = 0, transitionStart = null;
  Object.defineProperty(w.document, 'hidden', {get: () => hidden});
  Object.defineProperties(gallery[0], {clientWidth: {get: () => W}, clientHeight: {get: () => H}});
  w.setTimeout = (fn, ms) => {timers.set(++serial, {fn, ms}); return serial;};
  w.clearTimeout = n => timers.delete(n);
  w.requestAnimationFrame = fn => {rafs.set(++serial, fn); return serial;};
  w.cancelAnimationFrame = n => rafs.delete(n);
  if (!config.windowResize) w.ResizeObserver = class {
    constructor(fn) {this.fn = fn; this.disconnected = false; observers.push(this);}
    observe() {}
    disconnect() {this.disconnected = true;}
  };
  w.Image = class {constructor() {this.naturalWidth = 2000; this.naturalHeight = 1000;} set src(url) {this.url = url; requests.push(this);}};
  const rect = (left, top, width, height) => ({x: left, y: top, left, top, width, height, right: left + width, bottom: top + height});
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === gallery[0]) return rect(0, 0, W + 4, H + 4);
    const row = this.classList.contains('row') ? this : this.closest('.row');
    if (!row) return rect(0, 0, 0, 0);
    const top = 2 + Number(row.getAttribute('data-st-row')) * H / 2;
    if (this === row) return rect(2, top, W, H / 2);
    const slot = this.classList.contains('st-slot') ? this : this.closest('.st-slot');
    if (!slot) return rect(0, 0, 0, 0);
    const c = Number(slot.getAttribute('data-st-column'));
    function property(name) {
      const target = parseFloat(gallery[0].style.getPropertyValue(name));
      return transitionStart && gallery.hasClass('gallery-fitting') ? transitionStart[name] +
        (target - transitionStart[name]) * progress : target;
    }
    let width = W * property('--st-col-' + c) / 100;
    let left = 2 + W * property('--st-left-' + c) / 100;
    if (config.quantize) {width = Math.round(width * 64) / 64; left = Math.round(left * 64) / 64;}
    if (this === slot) return rect(left, top, width, H / 2);
    const box = this.parentElement.classList.contains('dual') ? this.parentElement : this;
    const contentWidth = (width - 4) * (box.classList.contains('disappear') ? 1 - progress : 1);
    if (this === box) return rect(left + 2, top + 2, contentWidth, H / 2 - 4);
    function childHeight(child) {
      const value = child.style.height || '50%';
      const calc = /^calc\(([\d.]+)% ([+-]) ([\d.]+)px\)$/.exec(value);
      return calc ? Number(calc[1]) / 100 * (H / 2 - 4) + (calc[2] === '+' ? 1 : -1) * Number(calc[3]) : parseFloat(value) / 100 * (H / 2 - 4);
    }
    const firstHeight = childHeight(box.children[0]);
    const childTop = top + 2 + (this === box.children[1] ? firstHeight : 0);
    return rect(left + 2, childTop, contentWidth, childHeight(this));
  };
  w.Math.random = () => 0.999999;
  for (const file of ['album-queue.js', 'gallery-layout.js', 'gallery-player.js', 'gallery-aligned-playback.js', 'shiftingtiles.js']) {
    if (file !== 'gallery-aligned-playback.js' || !config.missingModule) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  assert.equal(typeof w.ShiftingTilesLayout.planAligned, 'function', 'real geometry-agent planAligned is required, never substitute a fake production planner');
  const calls = [], real = w.ShiftingTilesLayout.planAligned;
  w.ShiftingTilesLayout.planAligned = (...args) => {calls.push(args); return real(...args);};
  let legacyCalls = 0;
  for (const name of ['plan', 'refitRow']) {
    const original = w.ShiftingTilesLayout[name];
    w.ShiftingTilesLayout[name] = (...args) => {legacyCalls++; return original(...args);};
  }
  const oldController = w.ShiftingTilesPlayer.attach(gallery);
  const source = Array.from({length: count}, (_, i) => `photos/album/p${i}.jpg`);
  const events = [];
  for (const name of ['st-initial-ready', 'st-animate-before', 'st-animate', 'st-animate-after', 'st-preload-cancelled']) gallery.on(name, () => events.push(name));
  gallery.shiftingtiles(source, Object.assign({alignedLayout: {enabled: true, minGain: 0.02, maxNeighbors: 1},
    dynamicRows: {enabled: true, probability: 1, minTransitionsBetweenChanges: 0, minTileWidth: 160, minTileHeight: 100}}, options));
  const api = gallery.data('shiftingtiles-playback');
  const cells = () => gallery.children('.row').children('.st-slot');
  const boxes = () => cells().children('.single,.dual').not('.disappear');
  return {dom, w, $, gallery, api, requests, timers, rafs, observers, source, calls, oldController, events, cells, boxes,
    legacyCalls: () => legacyCalls,
    row: i => gallery.children('.row').eq(i),
    slot: (r, c) => gallery.children('.row').eq(r).children('.st-slot').eq(c),
    box: (r, c) => gallery.children('.row').eq(r).children('.st-slot').eq(c).children('.single,.dual').not('.disappear'),
    nominal: () => [...timers.values()].filter(t => t.ms === 5000),
    load(request, ratio = 2) {assert.equal(typeof request.onload, 'function'); request.naturalWidth = ratio * 1000; request.naturalHeight = 1000; request.onload();},
    initial() {requests.slice().forEach((r, i) => this.load(r, [2, 2, 1, 1][i % 4]));},
    choose(node, change = true) {
      const index = boxes().toArray().indexOf(node.jquery ? node[0] : node);
      assert.ok(index >= 0);
      const sequence = [(index + 0.01) / boxes().length, change ? 0 : 1];
      w.Math.random = () => sequence.length ? sequence.shift() : 0;
      return api.frame();
    },
    end() {gallery.find('.disappear').trigger('animationend');},
    transition() {transitionStart = {}; for (let c = 0; c < 3; c++) for (const kind of ['col', 'left']) {
      const name = '--st-' + kind + '-' + c; transitionStart[name] = parseFloat(gallery[0].style.getPropertyValue(name));
    } progress = 0;},
    phase(value) {progress = value;},
    hide(value) {hidden = value; $(w.document).trigger('visibilitychange');},
    flush() {const callbacks = [...rafs.values()]; rafs.clear(); callbacks.forEach(fn => fn());},
    resize(width, height) {W = width; H = height; if (config.windowResize) w.dispatchEvent(new w.Event('resize')); else observers.filter(o => !o.disconnected).forEach(o => o.fn());},
    close() {api.destroy(); oldController.destroy(); dom.window.close();}
  };
}
function invariant(f, expectedCells) {
  const s = f.api.stats(), urls = Array.from(s.visibleURLs);
  assert.equal(s.alignedLayoutEnabled, true);
  assert.equal(new Set(urls).size, urls.length, 'outgoing and incoming URLs are excluded together');
  assert.ok(urls.every(url => f.source.includes(url)));
  assert.ok(Array.from(s.rowPhotoCounts).every(n => n >= 4 && n <= 6));
  assert.equal(f.cells().length, 6);
  if (expectedCells) assert.deepEqual(f.cells().toArray(), expectedCells, 'cell identities and order never change');
  assert.ok(f.nominal().length <= 1);
  assert.equal(f.legacyCalls(), 0, 'aligned never uses independent plan/refitRow');
  return urls;
}
function geometry(f) {
  const W = f.gallery[0].clientWidth, H = f.gallery[0].clientHeight, style = f.gallery[0].style;
  const widths = [0, 1, 2].map(c => parseFloat(style.getPropertyValue('--st-col-' + c)));
  near(widths.reduce((n, x) => n + x, 0), 100);
  let left = 0;
  for (let c = 0; c < 3; c++) {
    near(parseFloat(style.getPropertyValue('--st-left-' + c)), left); left += widths[c];
    const a = f.slot(0, c)[0], b = f.slot(1, c)[0], ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    assert.equal(a.style.width, `var(--st-col-${c})`); assert.equal(b.style.width, a.style.width);
    assert.equal(a.style.left, `var(--st-left-${c})`); assert.equal(b.style.left, a.style.left);
    near(ar.left, br.left); near(ar.width, br.width); near(ar.height, H / 2); near(br.height, H / 2);
    near(br.top - ar.top, H / 2);
  }
  for (let r = 0; r < 2; r++) {
    const row = f.row(r)[0].getBoundingClientRect(); near(row.width, W); near(row.height, H / 2);
    const splits = [];
    f.row(r).find('.dual').each(function () {
      const a = this.children[0].getBoundingClientRect(), b = this.children[1].getBoundingClientRect();
      near(a.bottom, b.top); near(a.height + b.height, H / 2 - 4);
      near(a.height, (H / 2 - 8) / 2); near(b.height - 4, a.height);
      const overlayTop = row.top + H / 4 - 2;
      const separatorUnion = Math.max(b.top + 4, overlayTop + 4) - Math.min(b.top, overlayTop);
      near(separatorUnion, 4, 'Duo border and fixed overlay must coincide, not form a wider black band');
      splits.push(a.bottom);
    });
    splits.forEach(y => near(y, splits[0]));
  }
}
function complete(f, node, ratios = [2, 2], change = true, identities = f.cells().toArray()) {
  const n = f.requests.length, old = invariant(f, identities);
  assert.equal(f.choose(node, change), true, JSON.stringify(f.api.stats()));
  const next = f.requests.slice(n);
  assert.ok(next.length >= 1 && next.length <= 2, 'only one or two next URLs are preloaded');
  assert.ok(next.every(r => !old.includes(r.url)));
  next.forEach((r, i) => f.load(r, ratios[i % ratios.length]));
  invariant(f, identities); geometry(f); f.end(); invariant(f, identities); geometry(f);
  assert.equal(f.api.stats().reservedCount, 0); assert.equal(f.nominal().length, 1);
  return next;
}

test('opt-in initial eight is atomic, replaces only old layout controller, and sets one ready event/timer', () => {
  const f = fixture(443);
  try {
    assert.equal(f.requests.length, 8); assert.equal(f.api.stats().seenCount, 0); assert.equal(f.nominal().length, 0);
    assert.notEqual(f.gallery.data('shiftingtiles-layout'), f.oldController);
    assert.equal(f.observers[0].disconnected, true); assert.equal(f.rafs.size, 0);
    const cells = f.cells().toArray();
    f.requests.slice(0, 7).forEach((r, i) => f.load(r, [2, 2, 1, 1][i % 4]));
    assert.equal(f.api.stats().seenCount, 0); assert.equal(f.api.stats().visibleURLs.length, 0);
    f.load(f.requests[7], 1);
    assert.equal(f.api.stats().seenCount, 8); assert.equal(f.events.filter(e => e === 'st-initial-ready').length, 1);
    assert.equal(f.nominal().length, 1); invariant(f, cells); geometry(f);
    const metrics = f.gallery.data('shiftingtiles-layout').metrics();
    assert.equal(metrics.aligned, true); assert.equal(metrics.rearranged, false);
    assert.deepEqual(Array.from(f.calls[0][0], row => Array.from(row, g => g.type)), [['single', 'single', 'dual'], ['single', 'single', 'dual']]);
    assert.equal(f.calls[0][3], null);
  } finally {f.close();}
});

test('eight-photo album remains exactly static with no new HTTP, duplicate, or structural change', () => {
  const f = fixture(8);
  try {f.initial(); const nodes = f.boxes().toArray(), cells = f.cells().toArray();
    for (let i = 0; i < 20; i++) {assert.equal(f.api.frame(), false); invariant(f, cells); geometry(f);}
    assert.equal(f.requests.length, 8); assert.deepEqual(f.boxes().toArray(), nodes);
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [4, 4]); assert.equal(f.api.stats().structureChanges, 0);
    assert.equal(f.nominal().length, 1);
  } finally {f.close();}
});

test('Single/Duo coverage compares both rows with the SAME first photo and releases unused extra without committing', () => {
  for (const ratio of [0.5, 1, 2, 4]) {
    const f = fixture();
    try {f.initial(); const cells = f.cells().toArray(), outgoing = f.box(0, 0), n = f.requests.length;
      const beforeStyle = f.gallery[0].getAttribute('style'), beforeSeen = f.api.stats().seenCount;
      f.choose(outgoing); assert.equal(f.requests.length, n + 2); f.load(f.requests[n], ratio);
      assert.equal(f.gallery[0].getAttribute('style'), beforeStyle); assert.equal(f.api.stats().seenCount, beforeSeen);
      const start = f.calls.length; f.load(f.requests[n + 1], ratio);
      const calls = f.calls.slice(start); assert.equal(calls.length, 2);
      calls.forEach(args => {assert.equal(args[0].length, 2); assert.equal(args[0][0].length, 3); assert.equal(args[0][1].length, 3);
        assert.equal(args[0][0][0].ratios[0], ratio); near(Array.from(args[3]).reduce((n, x) => n + x, 0), args[1]);
        assert.equal(args[4].anchorIndex, 0); assert.equal(args[4].maxNeighbors, 1);});
      assert.deepEqual(Array.from(calls[0][0][1], g => g.type), Array.from(calls[1][0][1], g => g.type));
      const incoming = outgoing.next(); assert.equal(incoming.parent()[0], outgoing.parent()[0]);
      assert.equal(outgoing[0].style.getPropertyValue('--st-start-width'), '100%');
      invariant(f, cells); geometry(f);
      const chosen = incoming.hasClass('dual') ? 2 : 1;
      assert.equal(f.api.stats().seenCount, beforeSeen + chosen); assert.equal(f.api.stats().reservedCount, 0);
      if (chosen === 1) {const released = f.requests[n + 1].url; f.end(); const next = complete(f, f.box(0, 0), [1], false, cells);
        assert.equal(next[0].url, released); assert.ok(Array.from(f.api.stats().visibleURLs).includes(released));}
      f.end();
    } finally {f.close();}
  }
});

test('outgoing shrinks inside one stable slot; paired column boundaries stay identical at transition samples and resize', () => {
  const f = fixture(40, {dynamicRows: {enabled: false}});
  try {f.initial(); const cells = f.cells().toArray(), outgoing = f.box(0, 0);
    f.choose(outgoing, false); f.load(f.requests.at(-1), 0.5);
    assert.equal(outgoing.parent()[0], outgoing.next().parent()[0]); assert.equal(outgoing.parent().children().length, 2);
    const target = f.cells().toArray().map(n => n.getBoundingClientRect());
    for (const phase of [0, 0.125, 0.5, 0.875, 1]) {
      f.phase(phase); invariant(f, cells); geometry(f);
      assert.deepEqual(f.cells().toArray().map(n => n.getBoundingClientRect()), target, 'face width cannot reflow separator parents');
    }
    f.resize(1024, 768); f.flush(); geometry(f); assert.equal(f.gallery.data('shiftingtiles-layout').metrics().width, 1600);
    f.end(); f.flush(); geometry(f); invariant(f, cells);
    assert.equal(f.gallery.data('shiftingtiles-layout').metrics().width, 1024);
  } finally {f.close();}
});

for (const reason of ['error', 'timeout', 'invalid-ratio']) test(`atomic ${reason} rolls back metadata/geometry/reservations and stale callback cannot activate`, () => {
  const f = fixture();
  try {f.initial(); const old = invariant(f), cells = f.cells().toArray(), nodes = f.boxes().toArray(), style = f.gallery[0].getAttribute('style');
    f.choose(f.box(0, 0)); f.load(f.requests[8]); const stale = f.requests[9].onload;
    if (reason === 'error') f.requests[9].onerror();
    else if (reason === 'invalid-ratio') f.load(f.requests[9], Infinity);
    else {const [id, timer] = [...f.timers.entries()].find(([, t]) => t.ms === 20000); f.timers.delete(id); timer.fn();}
    stale(); assert.deepEqual(invariant(f, cells), old); assert.deepEqual(f.boxes().toArray(), nodes);
    assert.equal(f.gallery[0].getAttribute('style'), style); assert.equal(f.api.stats().seenCount, 8);
    assert.equal(f.api.stats().reservedCount, 0); assert.equal(f.api.stats().animating, false); assert.equal(f.api.stats().loading, false);
    assert.equal(f.nominal().length, 1); geometry(f);
  } finally {f.close();}
});

test('normal Duo replacement is atomic even when structural probability is zero', () => {
  const f = fixture(40, {dynamicRows: {enabled: true, probability: 0}});
  try {f.initial(); const old = invariant(f); f.choose(f.box(0, 2)); f.load(f.requests[8]);
    assert.deepEqual(invariant(f), old); assert.equal(f.api.stats().seenCount, 8);
    f.requests[9].onerror(); assert.deepEqual(invariant(f), old); assert.equal(f.api.stats().reservedCount, 0);
  } finally {f.close();}
});

for (const windowResize of [false, true]) test(`resize while loading revalidates at activation; pending fit resumes on abort (${windowResize ? 'window' : 'observer'})`, () => {
  const f = fixture(40, {}, {windowResize});
  try {f.initial(); const cells = f.cells().toArray(); f.choose(f.box(0, 0));
    const before = f.gallery[0].getAttribute('style'); f.resize(1200, 800); f.flush(); f.load(f.requests[8]);
    assert.equal(f.gallery[0].getAttribute('style'), before); f.load(f.requests[9]);
    assert.equal(f.calls.at(-1)[1], 1200); assert.equal(f.calls.at(-1)[2], 800); geometry(f); f.end(); f.flush();
    f.choose(f.box(0, 0), false); const n = f.requests.length - 1;
    f.resize(390, 844); f.flush(); f.requests[n].onerror(); f.flush();
    assert.equal(f.gallery.data('shiftingtiles-layout').metrics().width, 390); geometry(f); invariant(f, cells);
    const count = f.calls.length; f.gallery.trigger('st-preload-cancelled'); f.flush(); assert.equal(f.calls.length, count);
  } finally {f.close();}
});

test('subpixel DOM measurements are never summed: logical widths alone feed planAligned and paired columns', () => {
  const f = fixture(40, {dynamicRows: {enabled: false}}, {quantize: true});
  try {f.initial(); const logical = Array.from(f.api.stats().columnWidths), cells = f.cells().toArray();
    f.choose(f.box(0, 0), false); f.resize(1599, 899); f.load(f.requests.at(-1), 0.5);
    const widths = Array.from(f.calls.at(-1)[3]); near(widths.reduce((n, x) => n + x, 0), 1599);
    widths.forEach((width, i) => near(width, logical[i] / 1600 * 1599));
    geometry(f); invariant(f, cells); f.end(); f.flush();
  } finally {f.close();}
});

test('hidden preload commits only on valid resume; hide finishes active animation; leave and destroy cancel everything', () => {
  const f = fixture();
  try {f.initial(); const cells = f.cells().toArray(); f.choose(f.box(0, 0)); f.hide(true);
    f.load(f.requests[8]); f.load(f.requests[9]); assert.equal(f.api.stats().seenCount, 8); assert.equal(f.nominal().length, 0);
    f.hide(false); assert.equal(f.api.stats().animating, true); geometry(f);
    f.hide(true); assert.equal(f.api.stats().animating, false); assert.equal(f.gallery.find('.disappear').length, 0); assert.equal(f.nominal().length, 0);
    f.hide(false); f.choose(f.box(0, 0)); const callbacks = f.requests.filter(r => r.onload).map(r => r.onload);
    f.$(f.w.document.body).trigger(f.$.Event('keydown', {keyCode: 38})); callbacks.forEach(fn => fn());
    assert.equal(f.api.stats().loading, false); assert.equal(f.api.stats().reservedCount, 0); assert.equal(f.api.frame(), false);
    f.api.destroy(); assert.equal(f.timers.size, 0); assert.equal(f.rafs.size, 0);
    assert.ok(f.observers.every(o => o.disconnected)); assert.equal(f.gallery.data('shiftingtiles-layout'), undefined);
    invariant(f, cells); const n = f.requests.length; f.resize(800, 600); f.hide(false); f.$(f.w.document.body).trigger(f.$.Event('keydown', {keyCode: 32}));
    assert.equal(f.requests.length, n); assert.equal(f.timers.size, 0); assert.equal(f.rafs.size, 0);
  } finally {f.close();}
});

test('same-source refresh preserves history/reservations; replacement cancels stale data and reuses original cells', () => {
  const f = fixture();
  try {f.initial(); const cells = f.cells().toArray(); f.choose(f.box(0, 0)); const stale = f.requests.slice(8).map(r => r.onload);
    f.gallery.trigger('st-photos-update', [f.source.slice()]); assert.equal(f.api.stats().reservedCount, 2); assert.equal(f.requests.length, 10);
    const replacement = f.source.map(url => url.replace('album', 'replacement')); f.source = replacement;
    f.gallery.trigger('st-photos-update', [replacement]); stale.forEach(fn => fn());
    assert.equal(f.api.stats().seenCount, 0); assert.equal(f.requests.length, 18); assert.equal(f.api.stats().visibleURLs.length, 0);
    f.requests.slice(10).forEach(r => f.load(r)); invariant(f, cells); geometry(f);
    assert.equal(f.api.stats().seenCount, 8); assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [4, 4]); assert.equal(f.nominal().length, 1);
  } finally {f.close();}
});

for (const size of [9, 10, 11, 17, 443]) test(`${size}-photo aligned playback completes two full cycles without repeated incoming or simultaneous duplicates`, () => {
  const f = fixture(size);
  try {f.initial(); const cells = f.cells().toArray(); let seed = 97331;
    f.w.Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
    let cycle = 1, displayed = new Set(f.api.stats().visibleURLs), incoming = new Set(displayed), completed = 0;
    for (let step = 0; step < 2200 && completed < 2; step++) {
      const n = f.requests.length, old = invariant(f, cells); assert.equal(f.api.frame(), true, JSON.stringify(f.api.stats()));
      if (f.api.stats().cycle !== cycle) {
        assert.equal(displayed.size, size, 'entire album actually visible before reuse including continuously held photos');
        cycle = f.api.stats().cycle; completed++; displayed = new Set(old); incoming = new Set();
      }
      const requests = f.requests.slice(n); assert.ok(requests.length >= 1 && requests.length <= 2);
      assert.equal(new Set(requests.map(r => r.url)).size, requests.length); assert.ok(requests.every(r => !old.includes(r.url)));
      requests.forEach(r => f.load(r, (Number(r.url.match(/p(\d+)/)[1]) % 3 + 1) * 0.8));
      const committed = invariant(f, cells).filter(url => !old.includes(url)); assert.ok(committed.length >= 1 && committed.length <= 2);
      committed.forEach(url => {assert.equal(incoming.has(url), false, 'no incoming repeats in the same cycle'); incoming.add(url); displayed.add(url);});
      geometry(f); f.end(); invariant(f, cells); assert.equal(f.api.stats().reservedCount, 0); assert.equal(f.nominal().length, 1);
    }
    assert.equal(completed, 2);
  } finally {f.close();}
});

test('material threshold and probability keep topology unchanged; small albums retain two spare URLs', () => {
  for (const [size, options] of [[40, {alignedLayout: {enabled: true, minGain: 0.99}}],
    [40, {dynamicRows: {enabled: true, probability: 0}}], [9, {}], [10, {}]]) {
    const f = fixture(size, options);
    try {f.initial(); const next = complete(f, f.box(0, 0)); assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [4, 4]);
      assert.equal(f.api.stats().structureChanges, 0); if (size < 11 || options.dynamicRows) assert.equal(next.length, 1);
    } finally {f.close();}
  }
});

test('old player flush refuses aligned DOM even if a stale controller is attached again', () => {
  const f = fixture();
  try {f.initial(); const cells = f.cells().toArray(), calls = f.calls.length;
    const stale = f.w.ShiftingTilesPlayer.attach(f.gallery); f.flush(); f.resize(1200, 800); f.flush();
    assert.equal(f.legacyCalls(), 0); assert.deepEqual(f.cells().toArray(), cells); assert.ok(f.calls.length >= calls);
    assert.equal(stale.metrics(), null); stale.destroy();
  } finally {f.close();}
});

test('missing aligned module and default-disabled settings retain legacy dispatch', () => {
  for (const config of [{missingModule: true}, {}]) {
    const f = fixture(8, config.missingModule ? {} : {alignedLayout: {enabled: false}}, config);
    try {assert.equal(f.api.stats().alignedLayoutEnabled, false); assert.equal(f.gallery.hasClass('gallery-aligned'), false);
      assert.equal(f.gallery.children('.row').length, 2); assert.equal(f.gallery.find('.st-slot').length, 0); assert.equal(f.requests.length, 8);
    } finally {f.close();}
  }
});

function grow(f, row, target, cells = f.cells().toArray()) {
  if (target >= 5) {complete(f, f.box(row, 0), [2, 2], true, cells); assert.ok(f.box(row, 0).hasClass('dual'));}
  if (target >= 6) {complete(f, f.box(row, 1), [4, 4], true, cells); assert.ok(f.box(row, 1).hasClass('dual'));}
  assert.equal(f.api.stats().rowPhotoCounts[row], target);
}

test('4→5→6→5→4 changes only faces inside existing slots and all 4/5/6 row combinations share physical geometry on resize', () => {
  for (const a of [4, 5, 6]) for (const b of [4, 5, 6]) {
    const f = fixture(80);
    try {f.initial(); const cells = f.cells().toArray(); grow(f, 0, a, cells); grow(f, 1, b, cells);
      const faces = f.boxes().toArray(), urls = invariant(f, cells);
      for (const [W, H] of [[1915, 924], [1024, 768], [390, 844]]) {
        f.resize(W, H); f.flush(); geometry(f); invariant(f, cells);
        assert.deepEqual(f.boxes().toArray(), faces); assert.deepEqual(Array.from(f.api.stats().visibleURLs), urls);
        assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [a, b]);
        const plan = f.gallery.data('shiftingtiles-layout').metrics();
        assert.equal(plan.diagnostics.partitions, 0); assert.equal(plan.diagnostics.reordered, false);
        assert.deepEqual(Array.from(plan.rowPhotoCounts), [a, b]);
      }
    } finally {f.close();}
  }
  const f = fixture(80);
  try {f.initial(); const cells = f.cells().toArray(); grow(f, 0, 6, cells);
    complete(f, f.box(0, 0), [0.5, 0.5], true, cells); assert.equal(f.api.stats().rowPhotoCounts[0], 5);
    complete(f, f.box(0, 1), [1, 1], true, cells); assert.equal(f.api.stats().rowPhotoCounts[0], 4);
    assert.equal(f.api.stats().structureChanges, 4); assert.ok(f.box(0, 0).hasClass('single')); assert.ok(f.box(0, 1).hasClass('single'));
    const changes = f.api.stats().structureChanges; complete(f, f.box(0, 2), [0.5, 0.5], true, cells);
    assert.equal(f.api.stats().rowPhotoCounts[0], 4); assert.equal(f.api.stats().structureChanges, changes, 'minimum four blocks compaction');
  } finally {f.close();}
});

test('last odd pending photo forces a one-photo merge when both rows are all Duo, without bypassing row bounds', () => {
  const f = fixture(17);
  try {f.initial(); const cells = f.cells().toArray(); grow(f, 0, 6, cells); grow(f, 1, 6, cells);
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [6, 6]); assert.equal(f.boxes().filter('.single').length, 0);
    assert.equal(f.api.stats().seenCount, 16);
    const next = complete(f, f.box(0, 0), [1], false, cells); assert.equal(next.length, 1);
    assert.equal(f.api.stats().seenCount, 17); assert.equal(f.api.stats().cycle, 1);
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [5, 6]);
    assert.ok(f.boxes().filter('.single').length > 0);
    complete(f, f.boxes().filter('.single').first(), [1], false, cells); assert.equal(f.api.stats().cycle, 2);
  } finally {f.close();}
});

test('cooldown counts successful finished transitions only; failed split does not consume eligibility or two spares', () => {
  const f = fixture(80, {dynamicRows: {enabled: true, probability: 1, minTransitionsBetweenChanges: 3}});
  try {f.initial(); const cells = f.cells().toArray(); f.choose(f.box(0, 0)); f.load(f.requests[8]); f.requests[9].onerror();
    assert.equal(f.api.stats().structureChanges, 0); complete(f, f.box(0, 0), [2, 2], true, cells);
    assert.equal(f.api.stats().structureChanges, 1);
    for (let i = 0; i < 3; i++) assert.equal(complete(f, f.box(0, 1), [2], true, cells).length, 1);
    complete(f, f.box(0, 1), [4, 4], true, cells); assert.equal(f.api.stats().structureChanges, 2);
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [6, 4]);
  } finally {f.close();}
  const small = fixture(11);
  try {small.initial(); grow(small, 0, 5); const next = complete(small, small.box(0, 1), [4, 4]);
    assert.equal(next.length, 1); assert.deepEqual(Array.from(small.api.stats().rowPhotoCounts), [5, 4]);
    assert.equal(small.api.stats().structureChanges, 1);
  } finally {small.close();}
});

test('resize invalidates optional split dimensions but valid normal replacement is not blanked or consumed by aspect', () => {
  const f = fixture();
  try {f.initial(); const cells = f.cells().toArray(); f.choose(f.box(0, 0)); const extra = f.requests[9].url;
    f.resize(1600, 400); f.load(f.requests[8]); f.load(f.requests[9]);
    assert.ok(f.box(0, 0).hasClass('single')); assert.equal(f.api.stats().seenCount, 9);
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [4, 4]); assert.equal(f.api.stats().reservedCount, 0);
    geometry(f); invariant(f, cells); f.end(); f.flush();
    const next = complete(f, f.box(0, 0), [1], false, cells); assert.equal(next[0].url, extra);
    f.choose(f.box(0, 0), false); const seen = f.api.stats().seenCount; f.resize(0, 0); f.load(f.requests.at(-1), 1);
    assert.equal(f.api.stats().seenCount, seen); assert.equal(f.api.stats().reservedCount, 0); assert.equal(f.api.stats().loading, false);
    f.resize(1200, 800); f.flush(); geometry(f);
  } finally {f.close();}
});

test('initial failed URLs retry within the album atomically; exhausted attempts retain a recovery clock rather than foreign fallback', () => {
  const f = fixture();
  try {const initial = f.requests.slice(); initial.slice(1).forEach(r => f.load(r));
    initial[0].onerror(); const second = f.requests.at(-1); second.onerror(); const third = f.requests.at(-1); third.onerror();
    assert.equal(f.api.stats().visibleURLs.length, 0); assert.equal(f.api.stats().seenCount, 0); assert.equal(f.api.stats().reservedCount, 0);
    assert.equal(f.nominal().length, 1);
    const [id, timer] = [...f.timers.entries()].find(([, t]) => t.ms === 5000); f.timers.delete(id); const n = f.requests.length; timer.fn();
    assert.equal(f.requests.length, n + 8); f.requests.slice(n).forEach(r => f.load(r));
    assert.equal(f.api.stats().seenCount, 8); assert.equal(f.api.stats().failedCount, 3); invariant(f); geometry(f);
    assert.ok(f.requests.every(r => f.source.includes(r.url))); assert.equal(f.nominal().length, 1);
  } finally {f.close();}
});

test('material common fit interpolates all paired left/width boundaries together without moving cells or changing Duo heights', () => {
  const f = fixture(40, {dynamicRows: {enabled: false}});
  try {f.initial(); const cells = f.cells().toArray(); const old = f.cells().toArray().map(n => n.getBoundingClientRect());
    f.transition(); f.choose(f.box(0, 1), false); f.load(f.requests.at(-1), 0.5);
    assert.ok(f.gallery.hasClass('gallery-fitting')); assert.equal(f.api.stats().localFits, 1);
    assert.ok(f.api.stats().lastLocalFit.gain >= 0.02); assert.deepEqual(Array.from(f.api.stats().lastLocalFit.localRange), [0, 2]);
    const widths = Array.from(f.api.stats().columnWidths);
    // CSS ease = cubic-bezier(.25,.1,.25,1); numeric bisection converts time to easing progress.
    function ease(time) {
      const bezier = (t, p1, p2) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) {const mid = (lo + hi) / 2; if (bezier(mid, 0.25, 0.25) < time) lo = mid; else hi = mid;}
      return bezier((lo + hi) / 2, 0.1, 1);
    }
    for (const time of [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1]) {
      const progress = ease(time); f.phase(progress); invariant(f, cells); geometry(f);
      let left = 2;
      for (let c = 0; c < 3; c++) {
        const targetWidth = widths[c], targetLeft = left;
        const actual = f.slot(0, c)[0].getBoundingClientRect();
        near(actual.width, old[c].width + (targetWidth - old[c].width) * progress);
        near(actual.left, old[c].left + (targetLeft - old[c].left) * progress);
        if (c > 0) near(f.slot(0, c - 1)[0].getBoundingClientRect().right, actual.left);
        left += targetWidth;
      }
    }
    f.end(); assert.ok(!f.gallery.hasClass('gallery-fitting')); geometry(f); invariant(f, cells);
  } finally {f.close();}
});

test('source reductions below eight or without two spares reset only faces and cancel all unsafe photos/reservations', () => {
  for (const size of [7, 8, 9, 10, 12]) {
    const f = fixture(40);
    try {f.initial(); const cells = f.cells().toArray(); grow(f, 0, 6, cells); grow(f, 1, 6, cells);
      const next = Array.from(f.api.stats().visibleURLs).slice(0, size); f.source = next;
      f.gallery.trigger('st-photos-update', [next]); f.flush();
      const n = f.requests.length - (size < 8 ? 0 : 8); f.requests.slice(n).forEach(r => {if (r.onload) f.load(r);});
      assert.deepEqual(f.cells().toArray(), cells); assert.equal(f.api.stats().albumSize, size);
      assert.equal(f.api.stats().reservedCount, 0);
      if (size < 8) {assert.equal(f.api.stats().visibleURLs.length, 0); assert.equal(f.nominal().length, 0);}
      else {assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts), [4, 4]); invariant(f, cells); geometry(f); assert.equal(f.nominal().length, 1);}
    } finally {f.close();}
  }
});

test('source update inside initial layout callback cannot expose or commit stale initial content', () => {
  const f = fixture();
  try {const cells = f.cells().toArray(), replacement = f.source.map(url => url.replace('album', 'replacement'));
    let updated = false;
    f.gallery.on('st-layout-updated.reentrant', () => {
      if (updated) return; updated = true; f.source = replacement; f.gallery.trigger('st-photos-update', [replacement]);
    });
    f.initial(); assert.equal(updated, true); assert.equal(f.requests.length, 16);
    assert.equal(f.gallery[0].style.visibility, 'hidden'); assert.equal(f.api.stats().seenCount, 0);
    assert.equal(f.api.stats().visibleURLs.length, 0); assert.equal(f.events.filter(e => e === 'st-initial-ready').length, 0);
    f.requests.slice(8).forEach(r => f.load(r)); invariant(f, cells); geometry(f);
    assert.equal(f.gallery[0].style.visibility, ''); assert.equal(f.api.stats().seenCount, 8);
    assert.equal(f.events.filter(e => e === 'st-initial-ready').length, 1);
  } finally {f.close();}
});

for (const size of [8, 9]) for (const failure of ['error', 'timeout']) test(`initial ${size}-photo ${failure} recovers on the normal clock without losing displayed history or becoming permanently hidden`, () => {
  const f = fixture(size);
  try {
    const original = f.requests.slice(), stale = original[0].onload;
    original.slice(1).forEach(request => f.load(request));
    if (failure === 'error') original[0].onerror();
    else {const [id, deadline] = [...f.timers.entries()].find(([, t]) => t.ms === 20000); f.timers.delete(id); deadline.fn();}
    if (size === 9) f.requests.at(-1).onerror(); // Exhaust the only alternate in a nine-photo source.
    assert.equal(f.api.stats().visibleURLs.length, 0);
    assert.equal(f.api.stats().seenCount, 0);
    assert.equal(f.api.stats().reservedCount, 0);
    assert.equal(f.api.stats().failedCount, size === 8 ? 1 : 2);
    assert.equal(f.gallery[0].style.visibility, 'hidden');
    assert.equal(f.nominal().length, 1);
    const n = f.requests.length;
    const [id, clock] = [...f.timers.entries()].find(([, t]) => t.ms === 5000);
    f.timers.delete(id); clock.fn();
    assert.equal(f.requests.length, n + 8, 'one bounded batch of eight retries after the clock, never a busy loop');
    assert.equal(f.api.stats().seenCount, 0);
    assert.equal(f.api.stats().failedCount, 0, 'fresh initial attempt is allowed only before any image is displayed');
    stale(); assert.equal(f.api.stats().seenCount, 0);
    f.requests.slice(n).forEach(request => f.load(request));
    assert.equal(f.gallery[0].style.visibility, '');
    assert.equal(f.api.stats().seenCount, 8);
    assert.equal(f.api.stats().visibleURLs.length, 8);
    assert.equal(f.events.filter(name => name === 'st-initial-ready').length, 1);
    invariant(f); geometry(f);
    if (size === 8) {assert.equal(f.api.frame(), false); assert.equal(f.requests.length, n + 8);}
    else {complete(f, f.box(0, 0), [1], false); assert.equal(f.api.stats().seenCount, 9);}
  } finally {f.close();}
});

test('persistent failure of an eight-photo initial batch waits between bounded retries instead of busy-looping or silently giving up', () => {
  const f = fixture(8);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const n = f.requests.length;
      f.requests[n - 8].onerror();
      assert.equal(f.requests.length, n);
      assert.equal(f.api.stats().loading, false);
      assert.equal(f.api.stats().seenCount, 0);
      assert.equal(f.api.stats().reservedCount, 0);
      assert.equal(f.nominal().length, 1);
      const [id, clock] = [...f.timers.entries()].find(([, t]) => t.ms === 5000);
      f.timers.delete(id); clock.fn();
      assert.equal(f.requests.length, n + 8);
      assert.equal(f.api.stats().reservedCount, 8);
    }
    const n = f.requests.length - 8;
    f.requests.slice(n).forEach(request => f.load(request));
    assert.equal(f.api.stats().seenCount, 8); invariant(f); geometry(f);
  } finally {f.close();}
});

for (const state of ['preloading', 'animating', 'fitting']) test(`live Duo halves and overlay stay exactly aligned at 4px during height resize while ${state}`, () => {
  const f = fixture(40, {dynamicRows: {enabled: false}});
  try {
    f.initial(); const cells = f.cells().toArray();
    f.choose(f.box(0, state === 'fitting' ? 1 : 0), false);
    if (state !== 'preloading') f.load(f.requests.at(-1), 0.5);
    if (state === 'fitting') assert.ok(f.gallery.hasClass('gallery-fitting'));
    const style = f.gallery[0].getAttribute('style'), calls = f.calls.length;
    for (const H of [1800, 400, 844, 900]) {
      f.resize(1600, H); f.flush();
      assert.equal(f.gallery[0].getAttribute('style'), style, 'joint width optimization still waits for the atomic transition');
      assert.equal(f.calls.length, calls);
      geometry(f); invariant(f, cells); // No exemption for live Duo halves or border/overlay union.
      f.gallery.find('.dual').each(function () {
        assert.equal(this.children[0].style.height, 'calc(50% - 2px)');
        assert.equal(this.children[1].style.height, 'calc(50% + 2px)');
      });
    }
    if (state === 'preloading') f.load(f.requests.at(-1), 0.5);
    f.end(); f.flush(); geometry(f); invariant(f, cells);
  } finally {f.close();}
});
