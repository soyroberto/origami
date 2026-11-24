'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {plan} = require('../gallery-layout.js');
const s = r => ({type:'single', ratios:[r]});
const d = (a,b) => ({type:'dual', ratios:[a,b]});
const options = {modularLayout:true, requireSingle:true};
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-8*Math.max(1,Math.abs(a),Math.abs(b)), `${a} != ${b}`);
const shape = p => p.rows.map(row=>row.groups.map(g=>({type:g.type, photoIndices:g.photoIndices})));
function verify(p, input, W, H) {
  assert.ok([4,5,6].includes(p.modularUnits));
  const ids=[];
  p.rows.forEach(row=>{
    near(row.height,H/2);
    near(row.groups.reduce((sum,g)=>sum+g.width,0),W);
    assert.equal(row.groups.reduce((sum,g)=>sum+g.span,0),p.modularUnits);
    let boundary=0;
    row.groups.forEach(g=>{
      assert.ok(Number.isInteger(g.span)&&g.span>0);
      near(g.width/W,g.span/p.modularUnits);
      boundary+=g.width; near(boundary/W*p.modularUnits,Math.round(boundary/W*p.modularUnits));
      assert.ok(g.width>10);
      near(g.childHeights.reduce((a,b)=>a+b,0),row.height-10);
      if(g.type==='dual') near(g.childHeights[0],g.childHeights[1]-10);
      ids.push(...g.photoIndices);
    });
  });
  const count=input.flatMap(row=>row.flatMap(g=>g.ratios)).length;
  assert.deepEqual(ids.slice().sort((a,b)=>a-b),Array.from({length:count},(_,i)=>i));
  assert.equal(new Set(ids).size,count);
  assert.equal(p.diagnostics.alignment,'shared-modules');
}
function currentOf(p) {
  return {modularUnits:p.modularUnits,rows:p.rows.map(row=>({height:row.height,groups:row.groups.map(g=>({...g,modularSpan:g.span}))}))};
}
test('reference landscapes retain 40/40/20 widths, not three equal columns',()=>{
  const input=[[s(1.6),s(1.6),d(1.6,1.6)],[s(1.6),s(1.6),d(1.6,1.6)]];
  const p=plan(input,1600,900,null,options); verify(p,input,1600,900);
  assert.equal(p.modularUnits,5);
  assert.deepEqual(p.rows.map(row=>row.groups.map(g=>g.span)),[[2,2,1],[2,2,1]]);
  assert.equal(p.diagnostics.reordered,false);
});
test('different row group counts share one module and keep photo order within their rows',()=>{
  const input=[[s(1),s(1),d(1,1)],[s(1.6),s(1.6),d(1.6,1.6)]];
  const p=plan(input,1600,900,null,options); verify(p,input,1600,900);
  assert.deepEqual(p.rows.map(row=>row.groups.length),[4,3]);
  assert.deepEqual(p.rows.map(row=>row.groups.flatMap(g=>g.photoIndices)),[[0,1,2,3],[4,5,6,7]]);
});
test('all 4..6 photo counts and 2..4 group shapes use shared modules without forced regrouping',()=>{
  const parts=[[[1,2,1],[1,1,1,1]],[[1,2,2],[1,1,2,1]],[[2,2,2],[1,2,2,1]]];
  for(let a=0;a<3;a++) for(let b=0;b<3;b++) for(let variant=0;variant<2;variant++) {
    let n=0;
    const input=[parts[a][variant],parts[b][1-variant]].map(row=>row.map(count=>({
      type:count===1?'single':'dual',ratios:Array.from({length:count},()=>[0.6,1.8,1.1,2.3,0.8][n++%5])
    })));
    const p=plan(input,1600,900,null,{...options,preserveTopology:true}); verify(p,input,1600,900);
    assert.deepEqual(p.rowPhotoCounts,[a+4,b+4]);
    assert.deepEqual(p.rows.map(row=>row.groups.length),input.map(row=>row.length));
    const before=JSON.stringify(p),current=currentOf(p);
    for(const [W,H] of [[1237,777],[390,844]]) {
      const resized=plan(input,W,H,current,{...options,preserveTopology:true}); verify(resized,input,W,H);
      assert.deepEqual(shape(resized),shape(p));
      assert.deepEqual(resized.rows.map(row=>row.groups.map(g=>g.span)),p.rows.map(row=>row.groups.map(g=>g.span)));
      assert.equal(resized.modularUnits,p.modularUnits);
      assert.equal(resized.diagnostics.evaluatedLayouts,1);
    }
    assert.equal(JSON.stringify(p),before);
  }
});
test('unaligned current geometry is corrected even when topology must be preserved',()=>{
  const input=[[s(0.8),d(0.4,2.4),s(1.7)],[s(1.9),s(0.9),d(1.3,0.7)]];
  let n=0;
  const current={rows:input.map((row,r)=>({height:r?567:333,groups:row.map((g,j)=>({
    type:g.type,photoIndices:g.ratios.map(()=>n++),width:1600*[0.35,0.16,0.49][j],
    childHeights:g.type==='single'?[r?557:323]:[r?150:100,r?407:223]
  }))}))};
  const before=JSON.stringify(current);
  const p=plan(input,1600,900,current,{...options,preserveTopology:true}); verify(p,input,1600,900);
  assert.deepEqual(shape(p),current.rows.map(row=>row.groups.map(g=>({type:g.type,photoIndices:g.photoIndices}))));
  assert.equal(JSON.stringify(current),before);
});
function heightOf(style, inner) {
  const calc=/^calc\(50% ([+-]) 5px\)$/.exec(style);
  return calc ? inner/2+(calc[1]==='+'?5:-5) : parseFloat(style||'50')/100*inner;
}
function fixture(count=40) {
  const dom=new JSDOM('<!doctype html><body><div class="gallery"></div></body>',{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window, ROOT=path.resolve(__dirname,'..');
  w.eval(fs.readFileSync(path.join(ROOT,'jquery-1.8.3.js'),'utf8'));
  const $=w.jQuery,gallery=$('.gallery'),requests=[],rafs=new Map(),timers=new Map();
  let id=0,W=1600,H=900,observer;
  Object.defineProperty(w.document,'hidden',{get:()=>false});
  Object.defineProperties(gallery[0],{clientWidth:{get:()=>W},clientHeight:{get:()=>H}});
  w.requestAnimationFrame=fn=>{rafs.set(++id,fn);return id;};w.cancelAnimationFrame=n=>rafs.delete(n);
  w.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id;};w.clearTimeout=n=>timers.delete(n);
  w.ResizeObserver=class {constructor(fn){observer=fn;}observe(){}disconnect(){}};
  w.Image=class {constructor(){this.naturalWidth=1600;this.naturalHeight=1000;}set src(url){this.url=url;requests.push(this);}};
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    if(this===gallery[0])return {width:W,height:H};
    const row=this.classList.contains('row')?this:this.closest('.row');
    const height=row?H*parseFloat(row.style.height||'50')/100:H;
    if(this===row)return {width:2*W,height};
    const group=this.parentElement?.classList.contains('dual')?this.parentElement:this;
    const width=2*W*parseFloat(group.style.getPropertyValue('--st-box-width')||(group.classList.contains('dual')?'10':'20'))/100;
    return {width:group===this?width:width-10,height:group===this?height:heightOf(this.style.height,height-10)};
  };
  w.Math.random=()=>0.99999;
  for(const file of ['album-queue.js','shiftingtiles.js','gallery-layout.js','gallery-player.js'])w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));
  const controller=w.ShiftingTilesPlayer.attach(gallery);
  gallery.shiftingtiles(Array.from({length:count},(_,i)=>'photos/album/p'+i+'.jpg'),{dynamicRows:{enabled:true,probability:1,minTransitionsBetweenChanges:0}});
  const playback=gallery.data('shiftingtiles-playback');
  return {w,$,gallery,requests,controller,playback,timers,
    load(r,x=1600,y=1000){r.naturalWidth=x;r.naturalHeight=y;r.onload();},
    ready(){requests.slice().forEach(r=>{if(r.onload)r.onload();});},
    flush(){const c=[...rafs.values()];rafs.clear();c.forEach(fn=>fn());},
    resize(x,y){W=x;H=y;observer();},
    choose(node){const boxes=gallery.children('.row').children('.single,.dual').not('.disappear').toArray(),i=boxes.indexOf(node[0]);let sequence=[(i+0.01)/boxes.length,0];w.Math.random=()=>sequence.length?sequence.shift():0;return playback.frame();},
    end(){gallery.find('.disappear').trigger('animationend');},
    close(){playback.destroy();controller.destroy();dom.window.close();}
  };
}
function duoAxes(f) {
  f.gallery.children('.row').each(function(){
    const height=this.getBoundingClientRect().height;
    f.$(this).children('.dual').not('.disappear').each(function(){
      const a=this.children[0].getBoundingClientRect().height,b=this.children[1].getBoundingClientRect().height;
      near(a,b-10);near(a+b,height-10);
      near(5+a+5,height/2); // center of the unchanged ten-pixel separator
      assert.equal(this.children[0].style.height,'calc(50% - 5px)');
      assert.equal(this.children[1].style.height,'calc(50% + 5px)');
    });
  });
}
test('actual split with unlike photos keeps module widths, horizontal axes and atomic precache through resize',()=>{
  const f=fixture();try {
    f.ready();f.flush();duoAxes(f);
    const outgoing=f.gallery.children('.row').first().children('.single').first();
    const oldWidth=outgoing[0].style.getPropertyValue('--st-box-width'),oldSpan=outgoing[0].style.getPropertyValue('--st-grid-span');
    const before=f.requests.length;
    assert.equal(f.choose(outgoing),true);assert.equal(f.requests.length,before+2);
    f.load(f.requests[before],10000,100);assert.equal(f.gallery.find('.disappear').length,0);
    f.load(f.requests[before+1],100,10000);
    const incoming=outgoing.next();assert.ok(incoming.hasClass('dual'));
    assert.equal(incoming[0].style.getPropertyValue('--st-box-width'),oldWidth);
    assert.equal(incoming[0].style.getPropertyValue('--st-grid-span'),oldSpan);
    assert.deepEqual(Array.from(f.playback.stats().rowPhotoCounts),[5,4]);
    const siblings=incoming.siblings().not('.disappear').toArray();
    f.resize(1237,777);f.flush();duoAxes(f);assert.equal(f.controller.metrics().fits,1);
    f.end();f.flush();duoAxes(f);assert.equal(f.controller.metrics().fits,2);
    assert.equal(f.requests.length,before+2,'geometry requests no additional photos');
    assert.deepEqual(incoming.siblings().toArray(),siblings);
    const state=f.playback.stats();assert.equal(new Set(Array.from(state.visibleURLs)).size,state.visibleURLs.length);
    assert.equal(state.reservedCount,0);assert.equal(state.animating,false);
    assert.equal([...f.timers.values()].filter(t=>t.ms===5000).length,1);
  }finally{f.close();}
});
test('nine-photo album keeps original Single boxes and live Duo axes during resize',()=>{
  const f=fixture(9);try {
    f.ready();f.flush();duoAxes(f);assert.ok(f.controller.metrics().smallAlbum);
    assert.equal(f.gallery.find('.single').length,4);
    f.resize(1237,777);duoAxes(f);f.flush();duoAxes(f);
    assert.deepEqual(Array.from(f.playback.stats().rowPhotoCounts),[4,4]);
  }finally{f.close();}
});

test('resize before any structural transition retains initial nodes, spans and modules',()=>{
  const f=fixture();try {
    f.resize(1200,800);
    f.requests.slice().forEach(r=>f.load(r,1000,1000));
    f.flush();
    const initial=f.controller.metrics(),nodes=f.gallery.children('.row').children().toArray();
    const spans=nodes.map(n=>n.style.getPropertyValue('--st-grid-span'));
    const urls=Array.from(f.playback.stats().visibleURLs),requests=f.requests.length;
    assert.equal(f.playback.stats().structureChanges,0);
    f.resize(800,1200);f.flush();
    const resized=f.controller.metrics();
    assert.deepEqual(f.gallery.children('.row').children().toArray(),nodes);
    assert.deepEqual(nodes.map(n=>n.style.getPropertyValue('--st-grid-span')),spans);
    assert.equal(resized.modularUnits,initial.modularUnits);
    assert.equal(resized.diagnostics.preserveTopology,true);
    assert.equal(resized.diagnostics.evaluatedLayouts,1);
    assert.equal(resized.rearranged,false);
    assert.deepEqual(Array.from(f.playback.stats().visibleURLs),urls);
    assert.equal(f.requests.length,requests);
    duoAxes(f);
  }finally{f.close();}
});
