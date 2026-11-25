# Resultados de la prueba beta de autenticación

- [x] Proyecto Supabase origami-auth Free en soyroberto/Sydney, cotización de coste cero y estado ACTIVE_HEALTHY; esx y esx-alfa no modificados.
- [x] Implementación de acceso Google y Microsoft (Entra/personal mediante OAuth) con SDK oficial, PKCE, mensajes de configuración/permiso pendientes y sin bypass en el servidor real.
- [x] Autorización por UUID local: el correo roberto@rober.to no concede acceso por sí solo. La lista comienza vacía; todos los usuarios autorizados compartirán la galería.
- [x] Fotos/manifiestos bloqueados por sesión verificada y UUID autorizado. Rutas de Git, configuración privada, backend y fotos de raíz no se publican. Cookies HttpOnly, host/origin comprobados y retorno OAuth público sin permiso implícito.
- [x] Cerrar sesión cancela validaciones pendientes del navegador: regresión del servidor y guardia de respuesta tardía del cliente verificadas.
- [x] Reutilización de módulos visuales 0.9.5 sin modificarlos, ni root index.html, workflow o sincronización. Prueba DOM confirma montaje único y limpieza al revocar/cerrar sesión; no sustituye una revisión visual real en navegador.
- [x] Guía de callbacks exactos, Google Cloud, Entra, secretos exclusivamente en Supabase y URL configuration, sin Files.Read ni cambios al SSO es.ixe.au.
- [x] Suite completa JavaScript: 218/218 aprobadas; después, suite de cliente ampliada: 14/14, incluida una nueva prueba DOM (219 pruebas JavaScript distintas en total). Packaging: 2/2. Sintaxis verificada.
- [x] Servidor real iniciado en 127.0.0.1:8683. Comprobaciones HTTP: salud y todos los recursos públicos 200; fotos/manifiesto sin sesión 401; configuración privada, Git y foto de raíz 404. Solo ocho muestras locales históricas.
- [ ] Usuario configura los proveedores y URLs en Supabase; secretos nunca en chat ni Git.
- [ ] Probar Google y Microsoft reales, confirmar qué cuenta Microsoft se eligió, aprobar UUID del propietario y verificar acceso permitido/denegado antes de declarar completa la autenticación end-to-end.

No hacer merge a main ni migrar las fotos públicas de Azure en esta fase. Las copias públicas existentes siguen públicas hasta una migración independiente aprobada.
