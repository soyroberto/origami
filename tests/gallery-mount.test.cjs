'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');

function fixture() {
  const dom = new JSDOM('<!doctype html><div class="gallery"></div>', {url:'https://example.test/?library=instagram', runScripts:'outside-only'});
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(ROOT, 'jquery-1.8.3.js'), 'utf8'));
  const $ = w.jQuery, requests = [], starts = [], updates = [], timers = new Map();
  let id = 0;
  w.setTimeout = (fn, ms) => { timers.set(++id, {fn, ms}); return id; };
  w.clearTimeout = key => timers.delete(key);
  $.ajax = options => {
    const request = {options}; requests.push(request);
    return {done(fn) { request.success = fn; return this; }, fail(fn) {request.failure = fn; return this;}};
  };
  $.fn.shiftingtiles = function(images, options) { starts.push({images:Array.from(images), options}); return this; };
  w.eval(fs.readFileSync(path.join(ROOT, 'gallery-source.js'), 'utf8'));
  const gallery = $('.gallery');
  gallery.on('st-photos-update', (event, images) => updates.push(Array.from(images)));
  const images = Array.from({length:16}, (_, i) => 'photos/onedrive/instagram/p' + i + '.jpg');
  return {dom,w,$,gallery,requests,starts,updates,timers,images};
}

test('mount forwards dynamicRows only on initial playback, preserving isolated source and one poll timer', () => {
  const f = fixture();
  try {
    const dynamicRows = {enabled:true, probability:0.25, minTransitionsBetweenChanges:3, minTileWidth:160, minTileHeight:100};
    const config = {libraryId:'instagram', dynamicRows};
    const controller = f.w.ShiftingTilesPhotos.mount(f.gallery, ['foreign/spotify.jpg'], config);
    assert.equal(f.starts.length, 0);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].options.url, 'photos/onedrive/instagram/gallery.json');
    f.requests[0].success({version:1,images:f.images}, 'success');
    assert.equal(f.starts.length, 1);
    assert.equal(f.starts[0].options.dynamicRows, dynamicRows);
    assert.deepEqual(Array.from(f.starts[0].options.fallbackPhotos), []);
    assert.deepEqual(f.starts[0].images, f.images);
    assert.equal(f.w.ShiftingTilesPhotos.mount(f.gallery, [], config), controller);
    assert.equal(f.starts.length, 1);
    controller.refresh();
    f.requests[1].success({version:1,images:f.images.slice(0,14)}, 'success');
    assert.equal(f.starts.length, 1);
    assert.deepEqual(f.updates, [f.images.slice(0,14)]);
    assert.equal(f.timers.size, 1);
    assert.equal([...f.timers.values()][0].ms, 60000);
    controller.stop(); assert.equal(f.timers.size, 0);
  } finally { f.dom.window.close(); }
});

test('mount without explicit dynamicRows keeps its original plugin options', () => {
  const f = fixture();
  try {
    const controller = f.w.ShiftingTilesPhotos.mount(f.gallery, [], {libraryId:'instagram'});
    f.requests[0].success({version:1,images:f.images}, 'success');
    assert.equal(f.starts.length, 1);
    assert.deepEqual(Object.keys(f.starts[0].options), ['fallbackPhotos']);
    assert.equal(f.starts[0].options.dynamicRows, undefined);
    controller.stop();
  } finally { f.dom.window.close(); }
});

test('root enables a moderate configurable split cadence without extra controls', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {url:'https://example.test/',runScripts:'outside-only'});
  try {
    const w = dom.window, mounts = [];
    w.eval(fs.readFileSync(path.join(ROOT, 'jquery-1.8.3.js'), 'utf8'));
    w.ShiftingTilesPlayer = {attach() {}};
    w.ShiftingTilesPhotos = {uniqueStrings:x=>x, libraryFromSearch:()=> 'spotify', mount:(g,images,options)=>mounts.push(options)};
    w.eval(w.document.querySelector('script:not([src])').textContent);
    assert.equal(mounts.length, 1);
    assert.equal(mounts[0].dynamicRows.enabled, true);
    assert.equal(mounts[0].dynamicRows.probability, 0.25);
    assert.equal(mounts[0].dynamicRows.minTransitionsBetweenChanges, 3);
    assert.equal(mounts[0].dynamicRows.minTileWidth, 160);
    assert.equal(mounts[0].dynamicRows.minTileHeight, 100);
    assert.equal(mounts[0].refreshMs, 60000);
    assert.equal(w.document.querySelectorAll('a,button,input').length, 0);
  } finally { dom.window.close(); }
});
