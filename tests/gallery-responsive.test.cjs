const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

async function compiledRules() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {runScripts: 'outside-only'});
  const {window} = dom;
  const compilerScript = window.document.createElement('script');
  Object.defineProperty(window.document, 'currentScript', {configurable: true, get: () => compilerScript});
  window.eval(read('less-2.5.1.min.js'));
  const css = await new Promise((resolve, reject) => {
    window.less.render(read('shiftingtiles.less'), {filename: 'shiftingtiles.less'}, (error, output) => {
      if (error) reject(error);
      else resolve(output.css);
    });
  });
  const style = window.document.createElement('style');
  style.textContent = css;
  window.document.head.appendChild(style);
  const rules = [...style.sheet.cssRules];
  dom.window.close();
  rules.compiledCSS = css;
  return rules;
}

function matchingRules(rules, selector) {
  const matches = [];
  for (const rule of rules) {
    if (rule.selectorText) {
      const normalized = rule.selectorText.replace(/\s+/g, ' ').trim();
      if (normalized === selector || normalized.split(',').map(s => s.trim()).includes(selector)) matches.push(rule);
    }
    if (rule.cssRules) matches.push(...matchingRules([...rule.cssRules], selector));
  }
  return matches;
}

function declaration(rules, selector, property) {
  const values = matchingRules(rules, selector).map(rule => rule.style.getPropertyValue(property).trim()).filter(Boolean);
  assert.ok(values.length, `Missing CSS declaration: ${selector} ${property}`);
  return values.at(-1);
}

test('document declares the mobile viewport', () => {
  const dom = new JSDOM(read('index.html'));
  const meta = dom.window.document.querySelector('meta[name="viewport"]');
  assert.ok(meta, 'viewport meta tag is required');
  assert.match(meta.content, /(?:^|,\s*)width=device-width(?:\s*,|$)/);
  assert.match(meta.content, /(?:^|,\s*)initial-scale=1(?:\s*,|$)/);
  dom.window.close();
});

test('compiled LESS sizes the gallery to the viewport and removes page scroll', async () => {
  const rules = await compiledRules();
  assert.equal(declaration(rules, 'html', 'margin'), '0');
  assert.equal(declaration(rules, 'body', 'margin'), '0');
  assert.equal(declaration(rules, 'html, body', 'overflow'), 'hidden');
  assert.equal(declaration(rules, '.shiftingtiles', 'width'), '100%');
  assert.equal(declaration(rules, '.shiftingtiles', 'height'), '100dvh');
  assert.match(rules.compiledCSS, /height:\s*100vh;\s*height:\s*100dvh;/, '100vh fallback precedes the dynamic viewport override');
});

test('compiled LESS shows one contained full photo on black, without a blurred or cover layer', async () => {
  const rules = await compiledRules();
  for (const selector of ['.shiftingtiles > .row .single', '.shiftingtiles > .row .dual > div']) {
    assert.equal(declaration(rules, selector, 'background-size'), '0 0');
    assert.equal(declaration(rules, selector, 'position'), 'relative');
    assert.equal(declaration(rules, selector, 'isolation'), 'isolate');
    assert.equal(declaration(rules, selector, 'overflow'), 'hidden');
    assert.equal(declaration(rules, selector, 'background-color'), 'black');
  }
  for (const selector of ['.shiftingtiles > .row .single::before', '.shiftingtiles > .row .dual > div::before']) {
    assert.equal(matchingRules(rules, selector).length, 0);
  }
  assert.doesNotMatch(rules.compiledCSS, /\b(?:filter|background-size):\s*(?:blur|cover)/);
  for (const selector of ['.shiftingtiles > .row .single::after', '.shiftingtiles > .row .dual > div::after']) {
    assert.equal(declaration(rules, selector, 'background-image'), 'inherit');
    assert.equal(declaration(rules, selector, 'background-size'), 'contain');
    assert.equal(declaration(rules, selector, 'background-position'), 'center');
    assert.equal(declaration(rules, selector, 'background-repeat'), 'no-repeat');
  }
});

test('compiled LESS keeps percentage row geometry and existing animation keyframes', async () => {
  const rules = await compiledRules();
  assert.equal(declaration(rules, '.shiftingtiles > .row', 'height'), '50%');
  assert.equal(declaration(rules, '.shiftingtiles > .row', 'width'), '200%');
  const names = rules.filter(rule => rule.type === 7).map(rule => rule.name);
  for (const name of ['leave-l', 'leave-r', 'bounce', 'bounce-small', 'disappear-single', 'disappear-dual']) {
    assert.ok(names.includes(name), `Missing existing keyframes: ${name}`);
  }
});

test('four-block rows animate the incoming fifth block with the existing small bounce', async () => {
  const rules = await compiledRules();
  for (const selector of ['.dual.disappear + * + * + * + *', '.single.disappear + * + * + * + *']) {
    assert.match(declaration(rules, selector, 'animation'), /^bounce-small 1s 0 linear$/);
    assert.equal(declaration(rules, selector, 'animation-fill-mode'), 'forwards');
    assert.equal(declaration(rules, selector, 'animation-iteration-count'), '1');
  }
});

test('compiled LESS has 4px total separators between tiles, rows, Duo children and perimeter', async () => {
  const rules = await compiledRules();
  const gallery = parseFloat(declaration(rules, '.shiftingtiles', 'border'));
  assert.equal(gallery, 2);
  assert.equal(declaration(rules, '.shiftingtiles', 'box-sizing'), 'border-box');
  for (const selector of ['.shiftingtiles > .row .single', '.shiftingtiles > .row .dual']) {
    const edge = parseFloat(declaration(rules, selector, 'border'));
    assert.equal(edge, 2);
    assert.equal(declaration(rules, selector, 'box-sizing'), 'border-box');
    assert.equal(edge + edge, 4, 'neighbouring tiles and rows share one 4px separator');
    assert.equal(gallery + edge, 4, 'perimeter equals the interior separator, not just one tile edge');
  }
  assert.equal(declaration(rules, '.shiftingtiles > .row .dual > div', 'border-width'), '4px 0 0 0');
  assert.equal(declaration(rules, '.shiftingtiles > .row .dual > div:first-child', 'border-top'), '0');
});

test('local fitting smoothly transitions stable widths and Duo heights, never outgoing blocks', async () => {
  const rules = await compiledRules();
  for (const selector of ['.shiftingtiles.gallery-fitting > .row .single:not(.disappear)', '.shiftingtiles.gallery-fitting > .row .dual:not(.disappear)']) {
    assert.equal(declaration(rules, selector, 'transition'), 'width 1s ease');
  }
  assert.equal(declaration(rules, '.shiftingtiles.gallery-fitting > .row .dual:not(.disappear) > div', 'transition'), 'height 1s ease');
  const fitting = rules.filter(rule => rule.selectorText?.includes('gallery-fitting') && !rule.selectorText.includes('gallery-aligned'));
  assert.equal(fitting.length, 2);
  assert.ok(fitting.every(rule => rule.selectorText.includes(':not(.disappear)')));
  for (const selector of ['.single.disappear', '.dual.disappear']) {
    assert.match(declaration(rules, selector, 'animation'), /^disappear-(single|dual) 1s 0 linear$/);
  }
});

// CSSOM checks prove the style contract, not real browser animation playback.
test('aligned rows use the same physical columns without reversed floats or independent widths', async () => {
  const rules = await compiledRules();
  const row = '.shiftingtiles.gallery-aligned > .row';
  assert.equal(declaration(rules, row, 'width'), '100%');
  assert.equal(declaration(rules, row, 'height'), '50%');
  assert.equal(declaration(rules, row, 'margin-left'), '0');
  assert.equal(declaration(rules, row, 'float'), 'none');
  for (let column = 0; column < 3; column++) {
    const slot = row + ' .st-slot[data-st-column="' + column + '"]';
    assert.match(declaration(rules, slot, 'left'), new RegExp('^var\\(--st-left-' + column + ','));
    assert.match(declaration(rules, slot, 'width'), new RegExp('^var\\(--st-col-' + column + ','));
    assert.ok(matchingRules(rules, slot).every(rule => !/first-child|last-child|data-st-row/.test(rule.selectorText)), 'one shared rule applies to both rows');
  }
  assert.equal(declaration(rules, row + ' .st-slot', 'position'), 'absolute');
  assert.equal(declaration(rules, row + ' .st-slot', 'height'), '100%');
  assert.equal(declaration(rules, row + ' .st-slot', 'overflow'), 'hidden');
});

test('slot borders stay 4px total while faces shrink and bounce inside the cell', async () => {
  const rules = await compiledRules();
  const slot = '.shiftingtiles.gallery-aligned > .row .st-slot';
  const edge = parseFloat(declaration(rules, slot, 'border'));
  assert.equal(edge, 2);
  assert.equal(edge + edge, 4, 'both column and row neighbours share 4px');
  assert.equal(edge + parseFloat(declaration(rules, '.shiftingtiles', 'border')), 4, 'perimeter shares the same 4px');
  assert.ok(matchingRules(rules, slot).every(rule => !rule.style.getPropertyValue('animation')), 'no disappear/bounce keyframe targets the separator-owning cell');
  for (const type of ['single', 'dual']) {
    const face = slot + ' > .' + type;
    assert.equal(declaration(rules, face, 'position'), 'absolute');
    assert.equal(declaration(rules, face, 'width'), '100%');
    assert.equal(declaration(rules, face, 'height'), '100%');
    assert.equal(declaration(rules, face, 'float'), 'none');
    assert.equal(declaration(rules, face, 'border'), '0');
    assert.equal(declaration(rules, face, '--st-start-width'), '100%');
    assert.match(declaration(rules, '.' + type + '.disappear', 'animation'), /^disappear-(single|dual) 1s 0 linear$/);
    assert.match(declaration(rules, '.' + type + '.disappear + *', 'animation'), /^bounce 1s 0 linear$/);
  }
  const divider = slot + ':has(> .dual)::after';
  assert.equal(declaration(rules, divider, 'top'), 'calc(50% - 2px)');
  assert.equal(declaration(rules, divider, 'height'), '4px');
  assert.equal(declaration(rules, divider, 'background'), 'black');
  assert.equal(declaration(rules, divider, 'pointer-events'), 'none');
  assert.equal(declaration(rules, divider, 'z-index'), '5');
});

test('shared column edges transition with the same duration and easing in both rows', async () => {
  const rules = await compiledRules();
  const shared = '.shiftingtiles.gallery-aligned.gallery-fitting > .row .st-slot';
  assert.equal(declaration(rules, shared, 'transition'), 'left 1s ease, width 1s ease');
  assert.ok(matchingRules(rules, shared).every(rule => !/first-child|last-child|data-st-row|disappear/.test(rule.selectorText)), 'the stable paired cells share the exact same easing rule');
  const disappear = rules.filter(rule => rule.type === 7 && /^disappear-/.test(rule.name));
  for (const rule of disappear) {
    assert.match(rule.cssRules[0].cssText, /width:\s*var\(--st-start-width,/);
    assert.match(rule.cssRules[rule.cssRules.length - 1].cssText, /width:\s*0%/);
  }
});

test('aligned Duo heights use live CSS calc with no height interpolation during pending or active resize', async () => {
  const rules = await compiledRules();
  const children = '.shiftingtiles.gallery-aligned > .row .st-slot > .dual > div';
  assert.equal(declaration(rules, children, 'height'), 'calc(50% + 2px)');
  assert.equal(declaration(rules, children + ':first-child', 'height'), 'calc(50% - 2px)');
  assert.equal(declaration(rules, children, 'transition'), 'none');
  const liveIndex = rules.findIndex(rule => rule.selectorText === children);
  const legacyIndex = rules.findIndex(rule => rule.selectorText === '.shiftingtiles.gallery-fitting > .row .dual:not(.disappear) > div');
  assert.ok(liveIndex > legacyIndex, 'live rule follows the equally specific legacy height transition');
});
