'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'acercade.html'), 'utf8');
const origin = 'https://saauxfotos.z26.web.core.windows.net';
const contentLinks = [
  'https://github.com/soyroberto/origami',
  'https://github.com/soyroberto/origami/releases',
  'https://hermanbanken.github.io/shiftingtiles/',
  `${origin}/`,
];

function loadPage({ pathname = '/acercade', release = require('../version.js') } = {}) {
  const requests = [];
  class OfflineResources extends ResourceLoader {
    fetch(url) {
      requests.push(url);
      return null;
    }
  }
  const dom = new JSDOM(html, {
    url: origin + pathname,
    runScripts: 'outside-only',
    resources: new OfflineResources(),
  });
  const { window } = dom;
  window.OrigamiVersion = release;
  function forbidNetwork(kind) {
    return function (url) {
      requests.push(`${kind}: ${url}`);
      throw new Error(`Petición no permitida en Acerca de: ${kind}`);
    };
  }
  window.fetch = forbidNetwork('fetch');
  window.XMLHttpRequest = forbidNetwork('XMLHttpRequest');
  window.WebSocket = forbidNetwork('WebSocket');
  window.EventSource = forbidNetwork('EventSource');
  window.navigator.sendBeacon = forbidNetwork('sendBeacon');
  const playbackCalls = [];
  window.requestAnimationFrame = function () { playbackCalls.push('requestAnimationFrame'); };
  window.setInterval = function () { playbackCalls.push('setInterval'); };
  for (const script of window.document.querySelectorAll('script:not([src])')) {
    window.eval(script.textContent);
  }
  return { dom, document: window.document, requests, playbackCalls };
}

for (const pathname of ['/acercade', '/acercade.html']) {
  test(`muestra nombre, versión derivada y título en ${pathname}`, (t) => {
    const { dom, document } = loadPage({ pathname });
    t.after(() => dom.window.close());
    assert.equal(document.querySelector('h1').textContent.trim(), 'Origami 0.9');
    assert.equal(document.getElementById('full-version').textContent, require('../version.js').version);
    assert.equal(document.title, 'Origami 0.9 — Acerca de');
    const scripts = [...document.querySelectorAll('script[src]')];
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].getAttribute('src'), '/version.js?v=fit-20261123');
    assert.equal(scripts[0].src, `${origin}/version.js?v=fit-20261123`);
    const allScripts = [...document.scripts];
    assert.equal(allScripts[0], scripts[0], 'version.js debe preceder al script de presentación');
    assert.equal(scripts[0].hasAttribute('async'), false);
    assert.equal(scripts[0].hasAttribute('defer'), false);
  });
}

test('la presentación se deriva de la API compartida, sin duplicar la versión', (t) => {
  const { dom, document } = loadPage({ release: { name: 'Origami', version: '1.12.7' } });
  t.after(() => dom.window.close());
  assert.equal(document.querySelector('h1').textContent.trim(), 'Origami 1.12');
  assert.equal(document.getElementById('full-version').textContent, '1.12.7');
  assert.equal(document.title, 'Origami 1.12 — Acerca de');
  assert.doesNotMatch(html, /0\.9(?:\.0)?/);
});

test('conserva contenido legible si la API de versión no está disponible', (t) => {
  const { dom, document } = loadPage({ release: null });
  t.after(() => dom.window.close());
  assert.equal(document.querySelector('h1').textContent.trim(), 'Origami');
  assert.equal(document.getElementById('full-version').textContent, 'No disponible');
  assert.equal(document.title, 'Acerca de Origami');
  assert.ok(document.querySelector('main'));
  assert.ok(document.querySelector('noscript'));
  assert.doesNotMatch(document.querySelector('main').textContent, /undefined|NaN/);
});

test('incluye solo los enlaces de contenido completos solicitados', (t) => {
  const { dom, document } = loadPage();
  t.after(() => dom.window.close());
  const anchors = [...document.querySelectorAll('a')];
  assert.deepEqual(anchors.map((anchor) => anchor.getAttribute('href')), contentLinks);
  for (const anchor of anchors) {
    assert.equal(new URL(anchor.getAttribute('href')).protocol, 'https:');
    assert.ok(anchor.textContent.trim(), 'cada enlace necesita un nombre accesible');
  }
  assert.equal(document.querySelector('footer a').textContent.trim(), 'Volver a la galería');
});

test('describe la galería y atribuye inspiración sin inventar licencia o afiliación', (t) => {
  const { dom, document } = loadPage();
  t.after(() => dom.window.close());
  const description = document.querySelector('[aria-labelledby="descripcion"]').textContent;
  assert.match(description, /galería animada.*OneDrive/);
  assert.match(description, /ocho fotos/);
  assert.match(description, /entre cuatro y seis fotos por fila/);
  assert.match(description, /bibliotecas separadas/);
  assert.match(description, /convierte.*HEIC.*navegador/);
  assert.match(description, /completas, sin recortes ni deformación/);
  assert.match(description, /2 píxeles.*perímetro/);
  assert.match(description, /ajusta suavemente.*sin cambiar su orden/);
  const credits = document.querySelector('[aria-labelledby="creditos"]').textContent;
  assert.match(credits, /implementación original de Shifting Tiles/);
  assert.match(credits, /protector de pantalla Shifting Tiles de macOS/);
  assert.match(credits, /no está afiliado con Apple/);
  assert.doesNotMatch(document.querySelector('main').textContent, /licencia MIT|copyright|©/i);
});

test('no solicita OneDrive, no inicia reproducción y no carga bibliotecas ni analíticas', (t) => {
  const { dom, document, requests, playbackCalls } = loadPage();
  t.after(() => dom.window.close());
  assert.deepEqual(requests, []);
  assert.deepEqual(playbackCalls, []);
  assert.equal(document.scripts.length, 2);
  assert.deepEqual([...document.querySelectorAll('script[src]')].map((script) => script.getAttribute('src')), ['/version.js?v=fit-20261123']);
  assert.equal(document.querySelectorAll('img, picture, video, audio, iframe, canvas, object, embed, link').length, 0);
  const inline = document.querySelector('script:not([src])').textContent;
  assert.doesNotMatch(inline, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|setInterval|requestAnimationFrame|graph\.microsoft|api\.onedrive|gallery|playback|analytics/i);
  assert.doesNotMatch(document.querySelector('style').textContent, /@import|url\s*\(/i);
});

test('declara idioma, viewport y una estructura accesible con foco visible', (t) => {
  const { dom, document } = loadPage();
  t.after(() => dom.window.close());
  assert.equal(document.documentElement.lang, 'es');
  assert.equal(document.characterSet, 'UTF-8');
  assert.equal(document.querySelector('meta[name="viewport"]').content, 'width=device-width, initial-scale=1');
  assert.equal(document.querySelector('meta[name="color-scheme"]').content, 'dark');
  assert.equal(document.querySelectorAll('main').length, 1);
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.deepEqual([...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) => heading.tagName), ['H1', 'H2', 'H2', 'H2']);
  assert.ok(document.querySelector('header'));
  assert.ok(document.querySelector('footer'));
  assert.equal(document.querySelector('nav').getAttribute('aria-label'), 'Enlaces del proyecto');
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length, 'los identificadores deben ser únicos');
  for (const element of document.querySelectorAll('main, section')) {
    const labelId = element.getAttribute('aria-labelledby');
    assert.ok(labelId, 'las regiones de contenido deben estar etiquetadas');
    assert.ok(document.getElementById(labelId)?.textContent.trim());
  }
  assert.match(document.querySelector('style').textContent, /system-ui/);
  assert.match(document.querySelector('style').textContent, /:focus-visible\s*\{[^}]*outline:/);
});
