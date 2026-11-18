/* Origami: edit the version here, then tag the corresponding release commit. */
(function (root, factory) {
  var app = factory();
  if (typeof module === 'object' && module.exports) module.exports = app;
  if (root && root.document) {
    root.OrigamiVersion = app;
    var meta = root.document.querySelector('meta[name="application-version"]');
    if (!meta) {
      meta = root.document.createElement('meta');
      meta.name = 'application-version';
      root.document.head.appendChild(meta);
    }
    meta.content = app.version;
  }
}(typeof window !== 'undefined' ? window : null, function () {
  return Object.freeze({ name: 'Origami', version: '0.9.0' });
}));
