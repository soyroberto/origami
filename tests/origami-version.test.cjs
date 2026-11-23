const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'version.js'), 'utf8');

test('version is defined once and available to Node', () => {
  const app = require('../version.js');
  assert.deepEqual(app, { name: 'Origami', version: '0.9.2' });
  assert.ok(Object.isFrozen(app));
  assert.equal((source.match(/0\.9\.2/g) || []).length, 1);
});

test('browser receives only hidden metadata, never links or visible controls', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://saauxfotos.z26.web.core.windows.net/' });
  const before = dom.window.document.body.innerHTML;
  dom.window.eval(source);
  dom.window.eval(source);
  assert.equal(dom.window.OrigamiVersion.version, '0.9.2');
  assert.equal(dom.window.document.querySelectorAll('meta[name="application-version"]').length, 1);
  assert.equal(dom.window.document.querySelector('meta[name="application-version"]').content, '0.9.2');
  assert.equal(dom.window.document.body.innerHTML, before);
  assert.equal(dom.window.document.querySelectorAll('a, button').length, 0);
  assert.ok(!/acercade/i.test(html));
  assert.ok(/<script src="version\.js\?v=fit-20261123"><\/script>/.test(html));
  dom.window.close();
});

test('new main has one correct workflow, explicitly disabled until owner configures it', () => {
  const dir = path.join(ROOT, '.github/workflows');
  assert.deepEqual(fs.readdirSync(dir).filter(n => /\.ya?ml$/.test(n)), ['origami-storage.yml']);
  const text = fs.readFileSync(path.join(dir, 'origami-storage.yml'), 'utf8');
  assert.ok(text.includes('branches: [main]'));
  assert.ok(text.includes("github.repository == 'soyroberto/origami'"));
  assert.ok(text.includes("github.ref == 'refs/heads/main'"));
  assert.ok(text.includes("vars.ORIGAMI_DEPLOY_ENABLED == 'true'"));
  assert.ok(text.includes('--name acercade'));
  assert.ok(text.includes("--content-type 'text/html; charset=utf-8'"));
  assert.ok(!/az storage blob delete/.test(text));
  assert.ok(!/func azure|functionapp deployment/.test(text));
});
