# Prueba local de Supabase Auth en Origami

Se implementará una entrada de prueba separada en la rama beta. El sitio main 0.9.5, su workflow, packager, frontend y el backend de sincronización OneDrive permanecerán sin cambios. Las fotografías públicas existentes de Azure seguirán públicas: esta prueba no se presentará como migración de privacidad de producción.

## Componentes

- beta/index.html, beta/auth-client.js y beta/auth.css: pantalla de acceso con Google y Azure (Microsoft), estados de sesión y permiso. Usar el SDK oficial Supabase fijado; flujo PKCE. Al aprobarse la sesión se iniciará la galería con los módulos y estilos originales 0.9.5, sin duplicar timers ni alterar recortes, separadores o animación.
- beta/server.cjs: HTTP local sobre 127.0.0.1:8683, abierto en navegador como http://localhost:8683. Assets públicos por lista explícita; no publicar el árbol del repositorio, root photos, .env, Git ni backend OneDrive. API valida el token con el servicio Supabase Auth, crea una cookie HttpOnly opaca y aplica autorización a manifiesto y cada foto. No CORS abierto, no tokens en URLs; comprobación Origin para crear/cerrar sesiones y validación Host contra DNS rebinding. No fallbacks públicos.
- beta/access.cjs: gestión de archivo privado de UUID autorizados; vacío por defecto. El email roberto@rober.to sirve para reconocer la prueba, no para conceder acceso automáticamente. Después del primer login el propietario verificará y autorizará el UUID real; Google/Microsoft con email igual pueden vincularse en Supabase. No presumir identidades independientes por el mismo correo.
- beta/config.example.json: URL/clave publicable Supabase y parámetros de desarrollo; valores reales en archivo ignorado beta/config.local.json, autorización en beta/authorized-users.local.json. No secrets Google/Microsoft ni service-role en navegador/repo.
- tests/auth-beta*.test.cjs: comportamiento de sesión y denegación, rutas y arranque condicionado sin fake auth en el servidor real.
- docs/supabase-auth-beta.md: registro manual de aplicaciones OAuth y URLs exactas una vez creado el proyecto.

## Datos de la prueba

Usar solo ocho muestras locales ya incluidas en el repositorio: f1.jpeg, f2.jpeg, f3.jpeg, f5.jpeg, f6.jpeg, f7.jpeg, f8.jpeg, f10.jpeg. Servirlas únicamente por rutas privadas de una biblioteca de prueba. No cargar ni copiar bibliotecas de OneDrive/Azure y no añadir almacenamiento Supabase para fotos. Las muestras tienen copias públicas históricas: se valida el control del endpoint local, no que esas imágenes sean secretas globalmente.

## Configuración externa

Proyecto nuevo origami-auth en organización soyroberto, Sydney, exclusivamente Free/coste mensual cero. esx y esx-alfa intocados. Google OAuth nuevo para Origami. Microsoft proveedor Azure OAuth admitiendo cuentas Entra ID y Microsoft personales (tenant common), scopes mínimos de identidad; nunca Files.Read ni sesión OneDrive. Microsoft optional claims de email verificado según guía oficial. Client secrets de ambos proveedores se guardan manualmente en el panel Supabase por el usuario; URL configuration permite solo origen/callback local de prueba. Se utilizará acceso mediante OAuth social, no SAML empresarial de pago.

## Diseño

Conservar la identidad visual sobria de Origami: fondo oscuro, texto legible, dos botones claros de proveedor y estado de acceso pendiente. No añadir sombras a las fotos ni modificar la galería. El login y el cierre de sesión no deberán superponerse permanentemente al mosaico; acceso a controles discretos fuera de la animación.

No publicar en Azure, no merge a main, no activar automatismos ni cambiar configuración de producción durante esta fase. Las pruebas reales Google/Microsoft quedan pendientes del registro OAuth y de la intervención del usuario en su navegador.
