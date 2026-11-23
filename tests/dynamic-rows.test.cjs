const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const photos = count => Array.from({length: count}, (_, i) => 'photos/album/photo-' + i + '.jpg');

function fixture(count = 40, options = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="gallery gallery-balanced"></div></body>', {
    url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(ROOT, 'jquery-1.8.3.js'), 'utf8'));
  let hidden = false, timerId = 0, boxWidth = 500, rowHeight = 420;
  Object.defineProperty(w.document, 'hidden', {configurable: true, get: () => hidden});
  const timers = new Map(), requests = [], events = [];
  w.setTimeout = (fn, ms) => { timers.set(++timerId, {fn, ms}); return timerId; };
  w.clearTimeout = id => timers.delete(id);
  w.Image = class {
    constructor() { this.naturalWidth = 1600; this.naturalHeight = 900; }
    set src(url) { this.url = url; requests.push(this); }
  };
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const isRow = this.classList.contains('row');
    let width = isRow ? 2000 : boxWidth, height = rowHeight;
    if (this.parentElement && this.parentElement.classList.contains('dual')) {
      width -= 10;
      height = parseFloat(this.style.height || '50') / 100 * (rowHeight - 10);
    }
    return {x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height};
  };
  w.Math.random = () => 0.999999;
  for (const file of ['album-queue.js', 'shiftingtiles.js']) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const $ = w.jQuery, gallery = $('.gallery'), source = photos(count);
  for (const name of ['st-image-ready', 'st-initial-ready', 'st-animate-before', 'st-animate',
    'st-animate-after', 'st-galleryrestart', 'st-layout-updated']) gallery.on(name, () => events.push(name));
  const dynamicRows = Object.assign({enabled: true, probability: 1, minTransitionsBetweenChanges: 0,
    minTileWidth: 160, minTileHeight: 100}, options.dynamicRows);
  gallery.shiftingtiles(source, Object.assign({}, options, {dynamicRows}));
  const api = gallery.data('shiftingtiles-playback');
  function boxes() { return gallery.children('.row').children('.single,.dual').not('.disappear'); }
  return {
    dom, w, $, gallery, source, api, requests, timers, events, boxes,
    row: i => gallery.children('.row').eq(i),
    counts: () => Array.from(api.stats().rowPhotoCounts),
    load(request, width = 1600, height = 900) {
      assert.equal(typeof request.onload, 'function');
      request.naturalWidth = width; request.naturalHeight = height; request.onload();
    },
    ready() { requests.slice().forEach(request => { if (request.onload) request.onload(); }); },
    choose(node, change = true) {
      const index = boxes().toArray().indexOf(node.jquery ? node[0] : node);
      assert.ok(index >= 0);
      const sequence = [(index + 0.01) / boxes().length, change ? 0 : 0.999999];
      w.Math.random = () => sequence.length ? sequence.shift() : 0;
      return api.frame();
    },
    end() { gallery.find('.disappear').trigger('animationend'); },
    timers5000: () => [...timers.values()].filter(timer => timer.ms === 5000),
    tick() {
      const item = [...timers.entries()].find(([, timer]) => timer.ms === 5000);
      assert.ok(item); timers.delete(item[0]); item[1].fn();
    },
    hide(value) { hidden = value; $(w.document).trigger('visibilitychange'); },
    measure(width, height) { boxWidth = width; rowHeight = height; },
    close() { api.destroy(); dom.window.close(); }
  };
}

function unique(f) {
  const state = f.api.stats(), urls = Array.from(state.visibleURLs);
  assert.equal(new Set(urls).size, urls.length, 'incoming and outgoing must be unique');
  assert.ok(urls.every(url => f.source.includes(url)), 'only this library is allowed');
  assert.ok(f.counts().every(count => count >= 4 && count <= 6));
  const stable = f.gallery.find('.single,.dual>div').filter(function () {
    return !f.$(this).closest('.disappear').length;
  });
  assert.equal(stable.length, f.counts().reduce((sum, count) => sum + count, 0));
  assert.ok(stable.length >= 8 && stable.length <= 12);
  assert.ok(f.timers5000().length <= 1);
  return urls;
}

function complete(f, node, change = true) {
  const old = unique(f), before = f.requests.length;
  assert.equal(f.choose(node, change), true);
  const incoming = f.requests.slice(before);
  assert.ok(incoming.every(request => !old.includes(request.url)));
  assert.equal(new Set(incoming.map(request => request.url)).size, incoming.length);
  assert.equal(f.api.stats().reservedCount, incoming.length);
  unique(f);
  incoming.forEach(request => f.load(request));
  unique(f); f.end(); unique(f);
  assert.equal(f.timers5000().length, 1);
  return incoming;
}

function growRow(f, row = 0) {
  while (f.counts()[row] < 6) complete(f, f.row(row).children('.single').first());
}

test('API defaults preserve eight initial requests, disabled legacy rows and a single 5000ms timer', () => {
  const f = fixture(443, {dynamicRows: {enabled: false}});
  assert.equal(f.requests.length, 8);
  assert.equal(f.api.stats().dynamicRowsEnabled, false);
  assert.deepEqual(f.counts(), [4, 4]);
  assert.equal(f.api.stats().structureChanges, 0);
  f.ready(); unique(f);
  for (let i = 0; i < 10; i++) complete(f, f.row(0).children('.single').first());
  assert.deepEqual(f.counts(), [4, 4]);
  assert.equal(f.api.stats().structureChanges, 0);
  f.close();
});

test('split preloads ALL slots, preserves position, outer width properties and removes container photo metadata', () => {
  const f = fixture(); f.ready();
  const row = f.row(0), outgoing = row.children().first();
  const siblings = row.children().toArray();
  outgoing[0].style.setProperty('--st-box-width', '25%');
  outgoing[0].style.setProperty('--st-start-width', '24.5%');
  const old = unique(f);
  assert.equal(f.choose(outgoing), true);
  assert.equal(f.requests.length, 10);
  assert.deepEqual(f.counts(), [4, 4]);
  assert.equal(f.api.stats().seenCount, 8);
  assert.equal(f.api.stats().reservedCount, 2);
  assert.ok(f.requests.slice(8).every(request => !old.includes(request.url)));
  f.load(f.requests[8], 2000, 1000);
  assert.equal(f.gallery.find('.disappear').length, 0);
  assert.equal(f.api.stats().seenCount, 8);
  f.load(f.requests[9], 1000, 1000);
  const incoming = outgoing.next();
  assert.equal(incoming.hasClass('dual'), true);
  assert.equal(incoming.children().length, 2);
  assert.equal(incoming.data('st-photo-url'), undefined);
  assert.equal(incoming.css('background-image'), 'none');
  assert.equal(incoming[0].style.getPropertyValue('--st-box-width'), '25%');
  assert.equal(incoming[0].style.getPropertyValue('--st-start-width'), '24.5%');
  assert.deepEqual(f.counts(), [5, 4], 'outgoing is excluded from stable row counts');
  assert.equal(f.api.stats().visibleURLs.length, 10, 'outgoing is still excluded from queue eligibility');
  assert.equal(f.api.stats().structureChanges, 0, 'count only finished changes');
  const heights = incoming.children().toArray().map(node => parseFloat(node.style.height) / 100 * 410);
  assert.ok(Math.abs(heights[0] - 400 / 3) < 1e-8);
  assert.ok(Math.abs(heights[1] - (800 / 3 + 10)) < 1e-8);
  assert.ok(Math.abs(heights[0] + heights[1] - 410) < 1e-8);
  assert.equal(f.api.frame(), false);
  f.end(); unique(f);
  assert.equal(row.children()[0], incoming[0]);
  assert.equal(row.children()[1], siblings[1]);
  assert.equal(row.children()[2], siblings[2]);
  assert.equal(f.api.stats().structureChanges, 1);
  f.close();
});

test('deterministic 4→5→6 and 6→5→4 never crosses row limits or rearranges unrelated boxes', () => {
  const f = fixture(80); f.ready();
  growRow(f, 0); assert.deepEqual(f.counts(), [6, 4]);
  growRow(f, 1); assert.deepEqual(f.counts(), [6, 6]);
  assert.equal(f.api.stats().structureChanges, 4);
  complete(f, f.row(0).children('.dual').first());
  assert.deepEqual(f.counts(), [5, 6]);
  complete(f, f.row(0).children('.dual').last());
  assert.deepEqual(f.counts(), [4, 6]);
  const changes = f.api.stats().structureChanges;
  complete(f, f.row(0).children('.dual').first());
  assert.deepEqual(f.counts(), [4, 6]);
  assert.equal(f.api.stats().structureChanges, changes);
  complete(f, f.row(1).children('.dual').first());
  complete(f, f.row(1).children('.dual').first());
  assert.deepEqual(f.counts(), [4, 4]);
  assert.equal(f.api.stats().structureChanges, 8);
  f.close();
});

test('a six-photo four-box row cannot split its remaining Singles; growth retains two offscreen URLs', () => {
  const f = fixture(80); f.ready();
  const duo = f.row(0).children('.dual');
  duo.children().each(function () {
    f.$(this).clone(true).addClass('single').css('height', '').insertBefore(duo);
  });
  duo.remove();
  assert.deepEqual(f.counts(), [4, 4]);
  growRow(f, 0);
  assert.equal(f.row(0).children('.single').length, 2);
  const before = f.api.stats().structureChanges;
  complete(f, f.row(0).children('.single').first());
  assert.deepEqual(f.counts(), [6, 4]);
  assert.equal(f.api.stats().structureChanges, before); f.close();
  const small = fixture(11); small.ready();
  complete(small, small.row(0).children('.single').first());
  assert.deepEqual(small.counts(), [5, 4]);
  complete(small, small.row(0).children('.single').first());
  assert.deepEqual(small.counts(), [5, 4], 'two spare photos must remain after a split');
  assert.equal(small.api.stats().structureChanges, 1); small.close();
});

test('minimum measured dimensions block split; new slot ratios can roll back after preload', () => {
  for (const [width, height] of [[169, 420], [500, 219], [0, 0]]) {
    const f = fixture(); f.ready(); f.measure(width, height);
    complete(f, f.row(0).children('.single').first());
    assert.deepEqual(f.counts(), [4, 4]);
    assert.equal(f.api.stats().structureChanges, 0); f.close();
  }
  const f = fixture(); f.ready();
  const before = unique(f), outgoing = f.row(0).children('.single').first();
  f.choose(outgoing);
  f.load(f.requests[8], 10000, 100);
  f.load(f.requests[9], 100, 10000);
  assert.equal(f.api.stats().loading, false);
  assert.equal(f.api.stats().animating, false);
  assert.equal(f.api.stats().seenCount, 8);
  assert.equal(f.api.stats().reservedCount, 0);
  assert.deepEqual(unique(f), before);
  assert.equal(outgoing.hasClass('single'), true);
  assert.deepEqual(f.counts(), [4, 4]); f.close();
});

test('structural load failure rolls back both reservations with no topology/cooldown change or foreign fallback', () => {
  const f = fixture(40, {dynamicRows: {minTransitionsBetweenChanges: 3}}); f.ready();
  const before = unique(f), outgoing = f.row(0).children('.single').first();
  f.choose(outgoing); f.load(f.requests[8]);
  const stale = f.requests[9].onload;
  f.requests[9].onerror(); stale();
  assert.equal(f.requests.length, 10);
  assert.equal(f.api.stats().seenCount, 8);
  assert.equal(f.api.stats().reservedCount, 0);
  assert.equal(f.api.stats().structureChanges, 0);
  assert.deepEqual(unique(f), before);
  complete(f, outgoing);
  assert.deepEqual(f.counts(), [5, 4], 'failed attempts do not consume cooling eligibility');
  assert.equal(f.api.stats().structureChanges, 1);
  for (let i = 0; i < 3; i++) {
    complete(f, f.row(0).children('.single').first());
    assert.deepEqual(f.counts(), [5, 4]);
  }
  complete(f, f.row(0).children('.single').first());
  assert.deepEqual(f.counts(), [6, 4]);
  assert.equal(f.api.stats().structureChanges, 2); f.close();
});

test('outgoing exclusion, pause, resize during preload, animation hooks and destruction retain one frame timer', () => {
  const f = fixture(); f.ready();
  const outgoing = f.row(0).children('.single').first(), oldURL = outgoing.data('st-photo-url');
  f.choose(outgoing); f.hide(true);
  assert.equal(f.timers5000().length, 0);
  f.load(f.requests[8]); f.load(f.requests[9]);
  assert.deepEqual(f.counts(), [4, 4]);
  assert.equal(f.api.stats().seenCount, 8);
  assert.equal(f.api.frame(), false);
  f.hide(false);
  assert.deepEqual(f.counts(), [5, 4]);
  assert.ok(Array.from(f.api.stats().visibleURLs).includes(oldURL));
  assert.equal(f.timers5000().length, 1);
  const requests = f.requests.length;
  for (let i = 0; i < 4; i++) { f.tick(); assert.equal(f.api.frame(), false); }
  assert.equal(f.requests.length, requests);
  assert.equal(f.timers5000().length, 1);
  f.gallery.trigger('st-layout-updated');
  assert.deepEqual(f.counts(), [5, 4]);
  f.hide(true);
  assert.equal(f.api.stats().animating, false);
  assert.equal(f.api.stats().structureChanges, 1);
  assert.ok(!Array.from(f.api.stats().visibleURLs).includes(oldURL));
  f.hide(false);
  assert.equal(f.events.filter(event => event === 'st-animate-before').length, 1);
  assert.equal(f.events.filter(event => event === 'st-animate').length, 1);
  assert.equal(f.events.filter(event => event === 'st-animate-after').length, 1);
  f.choose(f.row(0).children('.single').first());
  f.measure(500, 200); f.ready();
  assert.deepEqual(f.counts(), [5, 4], 'resize revalidates split at activation');
  assert.equal(f.api.stats().loading, false);
  assert.equal(f.api.stats().reservedCount, 0);
  f.measure(500, 420);
  f.choose(f.row(0).children('.single').first());
  const stale = f.requests.at(-1).onload;
  f.api.destroy(); stale();
  assert.equal(f.timers.size, 0);
  assert.equal(f.api.stats().reservedCount, 0);
  f.dom.window.close();
});

for (const size of [8, 9, 10]) test(size + '-photo albums stay at eight unique slots and do not spend URLs on splits', () => {
  const f = fixture(size); f.ready();
  let cycle = 1, requested = new Set(f.api.stats().visibleURLs);
  let displayed = new Set(requested), completed = 0;
  for (let step = 0; step < 40; step++) {
    const before = f.requests.length, old = unique(f);
    const selected = f.row(0).children(step % 2 ? '.single' : '.dual').first();
    const started = f.choose(selected);
    if (size === 8) {
      assert.equal(started, false); assert.equal(f.requests.length, 8);
    } else {
      assert.equal(started, true);
      if (f.api.stats().cycle !== cycle) {
        assert.equal(displayed.size, size, 'whole turn is displayed before reuse, including continuously held photos');
        cycle = f.api.stats().cycle; completed++;
        requested = new Set(); displayed = new Set(old);
      }
      assert.ok(f.requests.slice(before).every(request => !old.includes(request.url)));
      f.requests.slice(before).forEach(request => {
        assert.equal(requested.has(request.url), false, 'no incoming photo repeats within a turn');
        requested.add(request.url); displayed.add(request.url);
      });
      f.ready(); unique(f); f.end();
    }
    assert.deepEqual(f.counts(), [4, 4]);
    assert.equal(f.api.stats().structureChanges, 0);
    assert.equal(f.timers5000().length, 1);
  }
  if (size > 8) assert.ok(completed >= 3);
  f.close();
});

test('odd final pending URL forces Duo→Single when growth has removed every Single', () => {
  const f = fixture(17); f.ready(); growRow(f, 0); growRow(f, 1);
  assert.deepEqual(f.counts(), [6, 6]);
  assert.equal(f.gallery.find('.single').length, 0);
  assert.equal(f.api.stats().seenCount, 16);
  const request = complete(f, f.row(0).children('.dual').first(), false);
  assert.equal(request.length, 1);
  assert.deepEqual(f.counts(), [5, 6]);
  assert.equal(f.api.stats().seenCount, 17);
  assert.equal(f.api.stats().cycle, 1);
  complete(f, f.row(0).children('.single').first(), false);
  assert.equal(f.api.stats().cycle, 2); f.close();
});

test('443-photo dynamic playback completes full odd cycles before repeating, with 8..12 unique stable photos', () => {
  const f = fixture(443, {dynamicRows: {probability: 0.25, minTransitionsBetweenChanges: 3}}); f.ready();
  let seed = 78125;
  f.w.Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let cycle = 1, seen = new Set(f.api.stats().visibleURLs), completed = 0;
  for (let step = 0; step < 2000 && completed < 2; step++) {
    const before = f.requests.length, old = unique(f);
    assert.equal(f.api.frame(), true, JSON.stringify(f.api.stats()));
    if (f.api.stats().cycle !== cycle) {
      assert.equal(seen.size, 443, 'all photos displayed before repeating');
      cycle = f.api.stats().cycle; completed++; seen = new Set();
    }
    const incoming = f.requests.slice(before);
    assert.ok(incoming.every(request => !old.includes(request.url)));
    for (const request of incoming) {
      assert.equal(seen.has(request.url), false, 'no repetition inside a cycle');
      seen.add(request.url); f.load(request);
    }
    unique(f); f.end(); unique(f);
    assert.equal(f.timers5000().length, 1);
  }
  assert.equal(completed, 2);
  assert.ok(f.api.stats().structureChanges > 5); f.close();
});

test('source reductions reset unsafe topologies without duplicates or photos from another library', () => {
  for (const size of [7, 8, 9, 10, 12]) {
    const f = fixture(40); f.ready(); growRow(f, 0); growRow(f, 1);
    const current = Array.from(f.api.stats().visibleURLs);
    const next = size <= 12 ? current.slice(0, size) : f.source.slice(0, size);
    f.gallery.trigger('st-photos-update', [next]);
    assert.equal(f.api.stats().albumSize, next.length);
    f.ready();
    if (next.length < 8) {
      assert.equal(f.api.stats().visibleURLs.length, 0);
      assert.equal(f.timers5000().length, 0);
    } else {
      assert.deepEqual(f.counts(), [4, 4]);
      unique(f);
      assert.ok(Array.from(f.api.stats().visibleURLs).every(url => next.includes(url)));
      assert.equal(f.timers5000().length, 1);
      if (next.length > 8) complete(f, f.row(0).children('.single').first(), false);
    }
    f.close();
  }
});

test('source replacement cancels pending structure and stale callbacks; same-source refresh retains history', () => {
  const f = fixture(); f.ready();
  f.choose(f.row(0).children('.single').first());
  const stale = f.requests.slice(8).map(request => request.onload);
  f.gallery.trigger('st-photos-update', [f.source.concat('photos/album/added.jpg')]);
  assert.equal(f.api.stats().reservedCount, 2);
  assert.equal(f.requests.length, 10);
  assert.equal(f.api.stats().seenCount, 8);
  const replacement = photos(11).map(url => url.replace('album', 'replacement'));
  f.gallery.trigger('st-photos-update', [replacement]);
  stale.forEach(callback => callback());
  assert.equal(f.requests.length, 18);
  assert.equal(f.api.stats().seenCount, 0);
  f.ready();
  const urls = Array.from(f.api.stats().visibleURLs);
  assert.equal(urls.length, 8);
  assert.equal(new Set(urls).size, 8);
  assert.ok(urls.every(url => replacement.includes(url)));
  assert.deepEqual(f.counts(), [4, 4]);
  assert.equal(f.api.stats().reservedCount, 0);
  assert.equal(f.timers5000().length, 1); f.close();
});
