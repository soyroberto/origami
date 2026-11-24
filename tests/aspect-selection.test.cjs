'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const BASE = ROOT;
const {create} = require(path.join(ROOT, 'album-queue.js'));
const photos = n => Array.from({length:n}, (_, i) => 'photos/album/p' + i + '.jpg');

function fixture(n = 30, options = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="gallery"></div></body>', {
    url:'https://example.test/', runScripts:'outside-only', pretendToBeVisual:true
  });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(BASE, 'jquery-1.8.3.js'), 'utf8'));
  const $ = w.jQuery, gallery = $('.gallery'), requests = [], timers = new Map(), displayed = [];
  let id = 0, hidden = false;
  Object.defineProperty(w.document, 'hidden', {get:()=>hidden});
  w.setTimeout = (fn, ms) => {timers.set(++id, {fn, ms}); return id;};
  w.clearTimeout = id => timers.delete(id);
  w.HTMLElement.prototype.getBoundingClientRect = function() {
    const leaf = this.parentElement && this.parentElement.classList.contains('dual');
    return {width:this.classList.contains('row') ? 2000 : leaf ? 400 : 410,
      height:leaf ? (this === this.parentElement.firstElementChild ? 200 : 210) : 420};
  };
  w.Image = class {
    constructor() {this.naturalWidth = 400; this.naturalHeight = 410;}
    set src(url) {this.url = url; requests.push(this);}
  };
  w.Math.random = () => 0.999999;
  if(options.modular !== false) gallery.addClass('gallery-modular');
  for(const file of ['album-queue.js', 'shiftingtiles.js']) w.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  gallery.on('st-image-ready', (_, tile, url) => displayed.push(url));
  const source = photos(n);
  gallery.shiftingtiles(source, {aspectSelection:options.enabled !== false, dynamicRows:{enabled:!!options.dynamic, probability:options.split ? 1 : 0,
    minTransitionsBetweenChanges:0, minTileWidth:160, minTileHeight:100}});
  const api = gallery.data('shiftingtiles-playback');
  return {w, $, dom, gallery, requests, timers, source, api, displayed,
    ready(dimensions = () => [400, 410]) {
      let steps = 0;
      while(requests.some(r => typeof r.onload === 'function')) {
        assert.ok(++steps < 1000, 'bounded preload pumping');
        const r = requests.find(r => typeof r.onload === 'function');
        [r.naturalWidth, r.naturalHeight] = dimensions(r.url);
        r.onload();
      }
    },
    load(r, width = 400, height = 410) {
      assert.equal(typeof r.onload, 'function'); r.naturalWidth=width; r.naturalHeight=height; r.onload();
    },
    frame(kind = 'single') {
      if(!options.dynamic && kind === 'duo') {
        const row=gallery.children('.row').first(); row.prepend(row.children('.dual').first());
      }
      const boxes=options.dynamic ? gallery.children('.row').children('.single,.dual').not('.disappear') :
        gallery.find('.single:not(:last-child),.dual:not(:last-child)');
      const node=boxes.filter(kind === 'duo' ? '.dual' : '.single').first();
      const index=boxes.toArray().indexOf(node[0]);
      const seq=[(Math.max(index, 0)+0.01)/boxes.length, options.split ? 0 : 0.999999];
      w.Math.random=()=>seq.length ? seq.shift() : 0.999999;
      return api.frame();
    },
    end() {gallery.find('.disappear').trigger('animationend');},
    hide(value) {hidden=value; $(w.document).trigger('visibilitychange');},
    close() {api.destroy(); dom.window.close();}
  };
}
function unique(f) {
  const urls=Array.from(f.api.stats().visibleURLs);
  assert.equal(new Set(urls).size, urls.length, 'exclude visible AND outgoing');
  assert.ok(urls.every(url=>f.source.includes(url)));
}

test('candidate queue is capped, preserves minimum atomicity and odd-tail fallback', () => {
  const q=create(photos(9), ()=>0.999999);
  q.reserve(8).forEach(url=>q.commit(url));
  const before=q.stats();
  assert.deepEqual(q.reserveCandidates(2,6,photos(8)), []);
  assert.deepEqual(q.stats(), before);
  assert.deepEqual(q.reserveCandidates(1,3,photos(8)), [photos(9)[8]]);
  assert.equal(q.stats().seenCount, 8);
  q.release(photos(9)[8]);
  assert.deepEqual(q.reserveCandidates(1,7), []);
  assert.equal(q.stats().reservedCount, 0);
});

test('initial eight match base seed; strict flag is the only opt-in', () => {
  const a=fixture(443), b=fixture(443,{enabled:false});
  try {
    assert.deepEqual(a.requests.map(r=>r.url), b.requests.map(r=>r.url));
    assert.equal(a.requests.length,8); assert.equal(a.api.stats().seenCount,0);
    a.ready(); b.ready();
    assert.deepEqual(a.displayed,b.displayed);
    assert.equal(b.api.stats().aspectSelectionEnabled,undefined);
    a.frame(); b.frame();
    assert.equal(a.api.stats().aspectCandidates.length,3);
    assert.equal(b.requests.length,9);
    assert.equal(a.requests.length,10,'only two concurrent Image jobs');
  } finally {a.close(); b.close();}
});

test('Single favors natural ratio; rejected candidates release and do not commit', () => {
  const f=fixture();
  try {
    f.ready(); const old=Array.from(f.api.stats().visibleURLs);
    assert.equal(f.frame(),true);
    const candidates=Array.from(f.api.stats().aspectCandidates);
    assert.equal(candidates.length,3);
    assert.equal(f.api.stats().reservedCount,3);
    assert.equal(f.api.stats().seenCount,8);
    f.load(f.requests[8],100,1200);
    assert.equal(f.requests.length,11);
    assert.equal(f.api.stats().seenCount,8);
    f.load(f.requests[9],400,410);
    assert.equal(f.api.stats().seenCount,8,'wait even for the last candidate');
    f.load(f.requests[10],1200,100);
    assert.equal(f.displayed.at(-1),candidates[1]);
    assert.equal(f.api.stats().seenCount,9);
    assert.equal(f.api.stats().reservedCount,0);
    assert.equal(f.api.stats().aspectDeferrals[candidates[0]],1);
    unique(f);
    assert.ok(candidates.every(url=>!old.includes(url)));
    const incoming=f.gallery.find('.single').filter(function(){return f.$(this).data('st-photo-url')===candidates[1];});
    assert.equal(incoming.data('st-image-request'),incoming.data('st-image-loaded-request'));
  } finally {f.close();}
});

test('metadata cache never substitutes for a fresh winning preload or loaded marker', () => {
  const f=fixture(30);
  try {
    f.ready(); f.frame();
    f.load(f.requests[8],300,410); f.load(f.requests[9],400,410); f.load(f.requests[10],1000,100);
    f.end(); const seen=f.api.stats().seenCount, n=f.requests.length;
    f.frame();
    assert.equal(f.requests.length,n+1,'cached metadata avoids reloading rejected candidates');
    const discovery=f.requests.at(-1); f.load(discovery,1000,100);
    const winner=f.requests.at(-1);
    assert.notEqual(winner,discovery); assert.equal(winner.url,f.source[8]);
    assert.equal(f.api.stats().seenCount,seen,'cached dimensions cannot commit');
    assert.equal(f.api.stats().animating,false);
    f.load(winner,300,410);
    assert.equal(f.api.stats().seenCount,seen+1);
    const incoming=f.gallery.find('.single').filter(function(){return f.$(this).data('st-photo-url')===winner.url;});
    assert.equal(incoming.data('st-image-request'),incoming.data('st-image-loaded-request'));
    unique(f);
  } finally {f.close();}
});

test('opt-in deadlines invalidate stale callbacks without exceeding the six-candidate budget', () => {
  const f=fixture(30);
  try {
    f.ready(); f.frame('duo'); const stale=f.requests[8].onload;
    const item=[...f.timers.entries()].find(([,timer])=>timer.ms===20000);
    assert.ok(item); f.timers.delete(item[0]); item[1].fn(); stale();
    assert.equal(f.api.stats().failedCount,1); assert.equal(f.api.stats().seenCount,8);
    f.ready();
    assert.ok(f.requests.length<=14); assert.equal(f.api.stats().seenCount,10);
    assert.equal(f.api.stats().reservedCount,0); unique(f);
  } finally {f.close();}
});

test('opt-in structural error releases the whole pool, successful siblings and unscheduled jobs', () => {
  const f=fixture(30,{dynamic:true,split:true});
  try {
    f.ready(); const old=new Set(f.api.stats().visibleURLs);
    f.frame(); assert.equal(f.api.stats().reservedCount,6);
    const stale=f.requests[9].onload;
    f.load(f.requests[8]); f.requests[9].onerror(); stale();
    assert.equal(f.api.stats().seenCount,8); assert.equal(f.api.stats().failedCount,1);
    assert.equal(f.api.stats().reservedCount,0); assert.equal(f.api.stats().loading,false);
    assert.equal(f.requests.length,11,'only the one next job started before failure');
    assert.deepEqual(new Set(f.api.stats().visibleURLs),old);
    assert.deepEqual(Array.from(f.api.stats().rowPhotoCounts),[4,4]);
  } finally {f.close();}
});

for(const modular of [true,false]) test((modular?'A fixed':'B natural')+' Duo scores joint geometry and stays atomic (<=6 requests, <=2 concurrent)', () => {
  const f=fixture(30,{modular,dynamic:true});
  try {
    f.ready(); assert.equal(f.frame('duo'),true);
    const candidates=Array.from(f.api.stats().aspectCandidates);
    assert.equal(candidates.length,6);
    assert.equal(f.requests.length,10);
    let peak=0;
    while(f.requests.some(r=>r.onload)) {
      peak=Math.max(peak,f.requests.filter(r=>r.onload).length);
      assert.equal(f.api.stats().seenCount,8);
      const r=f.requests.find(r=>r.onload), i=candidates.indexOf(r.url);
      // B: landscape+portrait (4 and 4/3) has inverse-aspect sum 1,
      // matching a 400-wide, 400-high group, though neither leaf is 2:1.
      const dimensions=modular ? (i===2||i===3 ? [400,200] : [100,1000]) :
        i===0 ? [800,200] : i===1 ? [400,300] : [100,1000];
      f.load(r,...dimensions);
    }
    assert.ok(peak<=2); assert.equal(f.requests.length,14);
    assert.equal(f.api.stats().seenCount,10); assert.equal(f.api.stats().reservedCount,0);
    const expected=modular ? candidates.slice(2,4) : candidates.slice(0,2);
    assert.deepEqual(new Set(f.displayed.slice(-2)),new Set(expected));
    unique(f);
  } finally {f.close();}
});

test('EDF fairness forces difficult ratios after at most three eligible deferrals, including changing Single/Duo capacity', () => {
  const f=fixture(60);
  try {
    f.ready(); const difficult=f.source[8]; let eligibleDeferrals=0;
    for(let step=0;step<45 && !f.displayed.includes(difficult);step++) {
      const before=f.displayed.length;
      assert.equal(f.frame(step%3===1?'duo':'single'),true);
      const candidates=Array.from(f.api.stats().aspectCandidates);
      f.ready(url=>url===difficult ? [1,10000] : [400,410]);
      if(candidates.includes(difficult) && !f.displayed.slice(before).includes(difficult)) eligibleDeferrals++;
      assert.ok(eligibleDeferrals<=3);
      assert.ok(Object.values(f.api.stats().aspectDeferrals).every(age=>age<=3));
      f.end();
    }
    assert.ok(f.displayed.includes(difficult),'no permanent rejection of a very tall photo');
  } finally {f.close();}
});

for(const size of [8,9,10,17,443]) test(size+' opt-in album completes whole turns with no repeated displayed URLs and bounded metadata', () => {
  const f=fixture(size,{dynamic:true});
  try {
    f.ready(); let cycle=1, seen=new Set(f.displayed), coverage=new Set(f.displayed), completed=0;
    for(let step=0;step<(size===443?1000:35) && completed<2;step++) {
      const old=Array.from(f.api.stats().visibleURLs), n=f.requests.length, displayed=f.displayed.length;
      const started=f.frame(step%2?'single':'duo');
      if(size===8) {assert.equal(started,false); assert.equal(f.requests.length,8); continue;}
      assert.equal(started,true,JSON.stringify(f.api.stats()));
      if(f.api.stats().cycle!==cycle) {
        assert.equal(coverage.size,size,'full traversal before next cycle');
        cycle=f.api.stats().cycle; completed++; seen=new Set(); coverage=new Set(old);
      }
      f.ready(url=>Number(url.match(/p(\d+)/)[1])%7===0 ? [80,1200] : [400,410]);
      assert.ok(f.requests.length-n<=6,'at most six actual Image requests per transaction');
      for(const url of f.displayed.slice(displayed)) {
        assert.equal(seen.has(url),false,'no repeated activation within a cycle'); seen.add(url); coverage.add(url);
      }
      assert.ok(f.api.stats().aspectMetadataEntries<=64);
      assert.ok(Object.values(f.api.stats().aspectDeferrals).every(age=>age<=3));
      assert.equal(f.api.stats().reservedCount,0); unique(f); f.end();
    }
    if(size>8) assert.equal(completed,2);
  } finally {f.close();}
});

test('443 opt-in photos traverse full odd cycles through dynamic split/merge with 8..12 stable photos', () => {
  const f=fixture(443,{dynamic:true,split:true,modular:false});
  try {
    f.ready(); let seed=987654, cycle=1, seen=new Set(f.displayed), coverage=new Set(f.displayed), completed=0;
    f.w.Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let step=0;step<1400 && completed<2;step++) {
      const n=f.requests.length, displayed=f.displayed.length, old=Array.from(f.api.stats().visibleURLs);
      assert.equal(f.api.frame(),true,JSON.stringify(f.api.stats()));
      if(f.api.stats().cycle!==cycle) {
        assert.equal(coverage.size,443);
        cycle=f.api.stats().cycle; completed++; seen=new Set(); coverage=new Set(old);
      }
      f.ready(url=>Number(url.match(/p(\d+)/)[1])%9===0 ? [1,10000] : [400,410]);
      assert.ok(f.requests.length-n<=6);
      for(const url of f.displayed.slice(displayed)) {
        assert.equal(seen.has(url),false); seen.add(url); coverage.add(url);
      }
      assert.ok(Object.values(f.api.stats().aspectDeferrals).every(age=>age<=3));
      assert.ok(f.api.stats().aspectMetadataEntries<=64);
      assert.equal(f.api.stats().reservedCount,0); unique(f); f.end();
      assert.ok(f.api.stats().visibleURLs.length>=8 && f.api.stats().visibleURLs.length<=12);
      assert.ok(Array.from(f.api.stats().rowPhotoCounts).every(n=>n>=4 && n<=6));
      assert.equal([...f.timers.values()].filter(t=>t.ms===5000).length,1);
    }
    assert.equal(completed,2); assert.ok(f.api.stats().structureChanges>5);
  } finally {f.close();}
});

test('opt-in failures use only reserved candidate pool; exhausted Duo releases successful sibling', () => {
  const f=fixture(10);
  try {
    f.ready(); const old=Array.from(f.api.stats().visibleURLs);
    f.frame('duo'); f.load(f.requests[8]); f.requests[9].onerror();
    assert.equal(f.requests.length,10); assert.equal(f.api.stats().seenCount,8);
    assert.equal(f.api.stats().failedCount,1); assert.equal(f.api.stats().reservedCount,0);
    assert.equal(f.api.stats().loading,false);
    assert.deepEqual(new Set(f.api.stats().visibleURLs),new Set(old));
    assert.equal(f.frame('duo'),true);
    f.ready(); assert.equal(f.api.stats().seenCount,9); unique(f);
  } finally {f.close();}
});

test('one failed candidate can be replaced by already bounded pool, not another request wave', () => {
  const f=fixture(30);
  try {
    f.ready(); f.frame(); f.requests[8].onerror(); f.ready();
    assert.equal(f.requests.length,11); assert.equal(f.api.stats().failedCount,1);
    assert.equal(f.api.stats().seenCount,9); assert.equal(f.api.stats().reservedCount,0);
    assert.notEqual(f.displayed.at(-1),f.source[8]); unique(f);
  } finally {f.close();}
});

for(const action of ['remove','empty','destroy']) test(action+' invalidates all candidate callbacks and releases every reservation', () => {
  const f=fixture(30);
  try {
    f.ready(); f.frame('duo');
    const stale=f.requests.slice(8).map(r=>[r.onload,r.onerror]);
    if(action==='destroy') f.api.destroy();
    else f.gallery.trigger('st-photos-update',[action==='empty'?[]:f.source.filter(url=>url!==f.requests[8].url)]);
    stale.forEach(([load,error])=>{load();error();});
    assert.equal(f.api.stats().reservedCount,0); assert.equal(f.api.stats().loading,false);
    assert.equal(f.requests.length,10);
    assert.equal(f.api.stats().seenCount,action==='empty'?0:8);
    if(action==='empty'||action==='destroy') assert.equal(f.timers.size,0);
  } finally {f.close();}
});

test('nonempty library replacement invalidates the candidate pool, resets debt and loads only the new library', () => {
  const f=fixture(30);
  try {
    f.ready(); f.frame();
    const stale=f.requests.slice(8).map(r=>[r.onload,r.onerror]);
    const count=f.requests.length;
    const next=f.source.map(url=>url.replace('/album/','/replacement/'));
    f.gallery.trigger('st-photos-update',[next]);
    stale.forEach(([load,error])=>{load();error();});
    assert.equal(f.requests.length,count+8);
    assert.equal(f.api.stats().seenCount,0); assert.equal(f.api.stats().failedCount,0);
    assert.deepEqual(Object.keys(f.api.stats().aspectDeferrals),[]);
    assert.equal(f.api.stats().aspectMetadataEntries,0);
    f.ready();
    assert.equal(f.api.stats().seenCount,8); assert.equal(f.api.stats().reservedCount,0);
    assert.ok(Array.from(f.api.stats().visibleURLs).every(url=>next.includes(url)));
    assert.equal(new Set(f.api.stats().visibleURLs).size,8);
  } finally {f.close();}
});

test('refresh preserves live reservations and metadata, visibility delays commit then resumes once', () => {
  const f=fixture(30);
  try {
    f.ready(); f.frame('duo'); const reservations=f.api.stats().reservedCount;
    f.gallery.trigger('st-photos-update',[f.source.concat('photos/album/new.jpg').reverse()]);
    assert.equal(f.api.stats().reservedCount,reservations); assert.equal(f.requests.length,10);
    f.hide(true); f.ready();
    assert.equal(f.api.stats().seenCount,8); assert.equal(f.api.stats().animating,false);
    assert.equal(f.api.stats().reservedCount,2); assert.equal(f.frame(),false);
    f.hide(false); assert.equal(f.api.stats().seenCount,10); unique(f);
    assert.equal([...f.timers.values()].filter(t=>t.ms===5000).length,1);
    f.end(); assert.equal(f.api.stats().reservedCount,0);
  } finally {f.close();}
});

test('impossible natural split falls back to one forced photo without trapping extreme formats', () => {
  const f=fixture(30,{dynamic:true,split:true,modular:false});
  try {
    f.ready(); const difficult=f.source[8]; let forced=false;
    for(let step=0;step<4 && !forced;step++) {
      const before=f.api.stats().seenCount;
      assert.equal(f.frame(),true);
      f.ready(url=>url===difficult ? [10000,1] : [1,10000]);
      assert.equal(f.api.stats().loading,false); assert.equal(f.api.stats().reservedCount,0);
      if(f.displayed.includes(difficult)) {
        forced=true;
        assert.equal(f.api.stats().seenCount,before+1,'retain Single when forced Duo heights are impossible');
      }
      unique(f); f.end();
    }
    assert.equal(forced,true);
  } finally {f.close();}
});
