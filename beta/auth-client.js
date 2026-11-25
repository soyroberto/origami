/* Isolated local beta. No provider secrets or public-photo fallbacks. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.OrigamiAuthBeta = api;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { api.boot(root); });
    else api.boot(root);
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function createFlow(options) {
    var client = options.client, generation = 0, timer = null, stopped = false;
    var schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
    function clearTimer() { if (timer !== null) { cancel(timer); timer = null; } }
    function emit(state) { if (!stopped) options.onState(state); }
    async function sync() {
      if (stopped) return;
      clearTimer();
      var turn = ++generation;
      try {
        var response = await client.auth.getSession();
        if (turn !== generation || stopped) return;
        if (response.error) throw response.error;
        var session = response.data && response.data.session;
        if (!session || typeof session.access_token !== 'string' || !session.access_token) {
          emit({phase: 'signed-out'});
          await options.request('/api/logout', {method: 'POST', body: '{}'});
          return;
        }
        var result = await options.request('/api/session', {
          method: 'POST', headers: {Authorization: 'Bearer ' + session.access_token}, body: '{}'
        });
        if (turn !== generation || stopped) return;
        if (result.authenticated !== true || !result.user || typeof result.user.id !== 'string') {
          throw new Error('Invalid server session');
        }
        emit({phase: result.authorized === true ? 'authorized' : 'pending', user: result.user});
        timer = schedule(function () { timer = null; sync(); }, 30000);
      } catch (error) {
        if (turn === generation && !stopped) emit({phase: 'error', message: 'No se pudo verificar tu sesión o permiso. Reintenta sin abrir la galería.'});
      }
    }
    async function signIn(provider) {
      if (provider !== 'google' && provider !== 'azure') throw new Error('Unsupported provider');
      clearTimer(); ++generation;
      emit({phase: 'redirecting'});
      try {
        var params = {provider: provider, options: {redirectTo: options.callbackUrl, queryParams: {prompt: 'select_account'}}};
        if (provider === 'azure') params.options.scopes = 'email';
        var response = await client.auth.signInWithOAuth(params);
        if (response.error) throw response.error;
      } catch (error) {
        emit({phase: 'error', message: 'No se pudo iniciar el acceso. Comprueba que el proveedor OAuth y su callback estén configurados en Supabase.'});
      }
    }
    async function signOut() {
      clearTimer(); ++generation;
      emit({phase: 'signing-out'});
      var results = await Promise.allSettled([
        options.request('/api/logout', {method: 'POST', body: '{}'}),
        client.auth.signOut({scope: 'local'}).then(function (result) { if (result.error) throw result.error; })
      ]);
      if (results.some(function (result) { return result.status === 'rejected'; })) {
        emit({phase: 'error', message: 'La galería se ha ocultado, pero no se pudo confirmar el cierre completo. Reintenta cerrar sesión.'});
      } else emit({phase: 'signed-out'});
    }
    return {sync: sync, signIn: signIn, signOut: signOut, stop: function () { stopped = true; ++generation; clearTimer(); }};
  }

  async function boot(win) {
    var doc = win.document, status = doc.getElementById('auth-status');
    var panel = doc.getElementById('access-panel'), galleryElement = doc.getElementById('private-gallery');
    var controls = doc.getElementById('gallery-controls'), identity = doc.getElementById('auth-identity');
    var google = doc.getElementById('sign-in-google'), microsoft = doc.getElementById('sign-in-microsoft');
    var retry = doc.getElementById('check-access'), logout = doc.getElementById('sign-out');
    if (!status || !galleryElement) return;
    var mounted = false;
    function lockGallery() {
      galleryElement.hidden = true;
      controls.hidden = true;
      panel.hidden = false;
      if (!mounted) return;
      var gallery = win.jQuery(galleryElement);
      var source = gallery.data('shiftingtiles-source');
      var player = gallery.data('shiftingtiles-playback');
      var layout = gallery.data('shiftingtiles-layout');
      if (source) source.stop();
      if (player) player.destroy();
      if (layout) layout.destroy();
      gallery.empty().removeData('shiftingtiles-source').removeData('shiftingtiles-layout');
      mounted = false;
    }
    function render(state) {
      var authenticated = state.phase === 'authorized' || state.phase === 'pending';
      google.hidden = microsoft.hidden = authenticated;
      google.disabled = microsoft.disabled = state.phase === 'redirecting' || state.phase === 'signing-out';
      retry.hidden = !(authenticated || state.phase === 'error');
      logout.hidden = !(authenticated || state.phase === 'error');
      identity.hidden = !state.user;
      identity.textContent = state.user ? 'Cuenta: ' + state.user.email + ' · UUID: ' + state.user.id : '';
      if (state.phase !== 'authorized') lockGallery();
      if (state.phase === 'signed-out') status.textContent = 'Elige Google o Microsoft para identificarte.';
      else if (state.phase === 'redirecting') status.textContent = 'Abriendo el proveedor de identidad…';
      else if (state.phase === 'signing-out') status.textContent = 'Cerrando sesión…';
      else if (state.phase === 'pending') status.textContent = 'Tu identidad está verificada, pero aún no tiene permiso. El propietario debe autorizar este UUID y después puedes comprobar el acceso.';
      else if (state.phase === 'error') status.textContent = state.message;
      else if (state.phase === 'authorized') {
        panel.hidden = true;
        galleryElement.hidden = false;
        controls.hidden = false;
        if (!mounted) {
          var gallery = win.jQuery(galleryElement);
          win.ShiftingTilesPlayer.attach(gallery);
          win.ShiftingTilesPhotos.mount(gallery, [], {
            libraryId: 'spotify', refreshMs: 60000, aspectSelection: true,
            dynamicRows: {enabled: true, probability: 0.25, minTransitionsBetweenChanges: 3, minTileWidth: 160, minTileHeight: 100}
          });
          mounted = true;
        }
      }
    }
    async function request(url, init) {
      init = init || {};
      var headers = Object.assign({'Content-Type': 'application/json'}, init.headers || {});
      var response = await win.fetch(url, Object.assign({}, init, {headers: headers, credentials: 'same-origin', cache: 'no-store'}));
      if (!response.ok) throw new Error('Local API unavailable: ' + response.status);
      return response.json();
    }
    try {
      var config = await request('/api/client-config');
      if (!config.configured || !win.supabase || typeof win.supabase.createClient !== 'function') throw new Error('Configuration unavailable');
      var client = win.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: {flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true}
      });
      var flow = createFlow({client: client, request: request, callbackUrl: win.location.origin + '/auth/callback', onState: render});
      google.addEventListener('click', function () { flow.signIn('google'); });
      microsoft.addEventListener('click', function () { flow.signIn('azure'); });
      retry.addEventListener('click', function () { flow.sync(); });
      logout.addEventListener('click', function () { flow.signOut(); });
      doc.getElementById('gallery-sign-out').addEventListener('click', function () { flow.signOut(); });
      var subscription = client.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT') lockGallery();
        if (event !== 'INITIAL_SESSION') win.setTimeout(function () { flow.sync(); }, 0);
      }).data.subscription;
      await flow.sync();
      // PKCE has already consumed its callback. Never leave codes in the visible URL.
      if (win.location.pathname === '/auth/callback') win.history.replaceState(null, '', '/');
      win.addEventListener('pagehide', function () { flow.stop(); subscription.unsubscribe(); lockGallery(); }, {once: true});
      win.OrigamiAuthBeta.flow = flow;
    } catch (error) {
      lockGallery();
      status.textContent = 'La prueba aún no está configurada. Comprueba beta/config.local.json y ejecuta npm run beta:build. No se cargarán fotos.';
    }
  }
  return {createFlow: createFlow, boot: boot};
}));
