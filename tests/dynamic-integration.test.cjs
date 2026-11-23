'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');

function fixture() {
  const dom = new JSDOM('<!doctype html><body><div class="gallery"></div></body>', {url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(ROOT,'jquery-1.8.3.js'),'utf8'));
  const $ = w.jQuery, gallery = $('.gallery'), requests = [], rafs = new Map(), timers = new Map();
  let id = 0, W = 1600, H = 900, observer, planCalls = 0;
  Object.defineProperty(w.document,'hidden',{get:()=>false});
  Object.defineProperties(gallery[0],{clientWidth:{get:()=>W},clientHeight:{get:()=>H}});
  w.requestAnimationFrame = fn => {rafs.set(++id,fn);return id;};
  w.cancelAnimationFrame = n => rafs.delete(n);
  w.setTimeout = (fn,ms) => {timers.set(++id,{fn,ms});return id;};
  w.clearTimeout = n => timers.delete(n);
  w.ResizeObserver = class {constructor(fn){observer=fn;}observe(){}disconnect(){}};
  w.Image = class {constructor(){this.naturalWidth=1600;this.naturalHeight=900;} set src(url){this.url=url;requests.push(this);}};
  w.HTMLElement.prototype.getBoundingClientRect = function() {
    if(this === gallery[0]) return {width:W,height:H};
    const row = this.classList.contains('row') ? this : this.closest('.row');
    const height = row ? H * (parseFloat(row.style.height || '50') / 100) : H;
    if(this === row) return {width:2*W,height};
    const group = this.parentElement && this.parentElement.classList.contains('dual') ? this.parentElement : this;
    const width = 2*W*parseFloat(group.style.getPropertyValue('--st-box-width') || (group.classList.contains('dual')?'10':'20'))/100;
    if(group !== this) return {width:width-10,height:(height-10)*parseFloat(this.style.height || '50')/100};
    return {width,height};
  };
  w.Math.random = () => 0.999999;
  for(const file of ['album-queue.js','shiftingtiles.js','gallery-layout.js','gallery-player.js']) w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));
  const plan = w.ShiftingTilesLayout.plan;
  w.ShiftingTilesLayout.plan = function(...args){planCalls++;return plan(...args);};
  const controller = w.ShiftingTilesPlayer.attach(gallery);
  const source = Array.from({length:40},(_,i)=>'photos/album/p'+i+'.jpg');
  gallery.shiftingtiles(source,{dynamicRows:{enabled:true,probability:1,minTransitionsBetweenChanges:0}});
  const playback = gallery.data('shiftingtiles-playback');
  return {dom,w,$,gallery,requests,rafs,timers,controller,playback,source,plans:()=>planCalls,
    ready(){requests.slice().forEach(r=>{if(r.onload)r.onload();});},
    flush(){const callbacks=[...rafs.values()];rafs.clear();callbacks.forEach(fn=>fn());},
    resize(width,height){W=width;H=height;observer();},
    split(){const boxes=gallery.children('.row').children('.single,.dual'),single=boxes.filter('.single').first();assert.ok(single.length);const index=boxes.toArray().indexOf(single[0]),sequence=[(index+0.01)/boxes.length,0];w.Math.random=()=>sequence.length?sequence.shift():0;assert.equal(playback.frame(),true);return single;},
    close(){playback.destroy();controller.destroy();dom.window.close();}
  };
}

test('actual source replacement refits newly created rows after fallback had already fitted', () => {
  const f = fixture();
  try {
    f.ready();f.flush();assert.equal(f.plans(),1);
    const next=f.source.map(url=>url.replace('album','replacement'));
    f.gallery.trigger('st-photos-update',[next]);
    f.flush();assert.equal(f.plans(),1,'wait for the new source to load');
    f.ready();f.flush();assert.equal(f.plans(),2);
    assert.equal(f.controller.metrics().fits,2);
    assert.ok(Array.from(f.playback.stats().visibleURLs).every(url=>next.includes(url)));
    f.gallery.children('.row').children('.single,.dual').each(function(){assert.ok(this.style.getPropertyValue('--st-box-width'));});
    const requests=f.requests.length;
    f.gallery.trigger('st-animate-after');f.flush();
    assert.equal(f.plans(),2);assert.equal(f.requests.length,requests);
  } finally {f.close();}
});

test('actual structural preload failure resumes a pending resize without a successful next photo', () => {
  const f=fixture();
  try {
    f.ready();f.flush();assert.equal(f.plans(),1);
    const before=Array.from(f.playback.stats().visibleURLs),n=f.requests.length;
    f.split();assert.equal(f.requests.length,n+2);
    f.resize(1200,900);f.flush();assert.equal(f.plans(),1);
    f.requests[n].onload();f.flush();assert.equal(f.plans(),1);
    f.requests[n+1].onerror();
    assert.equal(f.playback.stats().loading,false);assert.equal(f.playback.stats().reservedCount,0);
    assert.ok(f.rafs.size > 0);
    f.flush();assert.equal(f.plans(),2);assert.equal(f.controller.metrics().width,1200);
    assert.deepEqual(new Set(f.playback.stats().visibleURLs),new Set(before));
    assert.deepEqual(Array.from(f.playback.stats().rowPhotoCounts),[4,4]);
    assert.equal(f.requests.length,n+2,'resize must not request more images');
    assert.equal([...f.timers.values()].filter(t=>t.ms===5000).length,1);
  } finally {f.close();}
});
