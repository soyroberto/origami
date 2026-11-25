# Supabase Auth: preparación de la prueba local de Origami

**Entra ID sí está soportado**, al igual que las cuentas personales de Microsoft, incluidas las antiguas cuentas Hotmail. Usaremos el proveedor Azure (Microsoft) mediante OAuth. No necesitamos el SSO empresarial SAML, que es otra función y no forma parte de esta prueba gratuita. [Guía oficial Microsoft](https://supabase.com/docs/guides/auth/social-sign-in/auth-azure).

Se ha creado `origami-auth` en la organización `soyroberto`, región Sydney, con coste cotizado de **$0 al mes**. Tu proyecto `esx` y su SSO de `es.ixe.au` no se han modificado; `esx-alfa` permanece pausado. La implementación se prepara exclusivamente en la rama `beta`. La prueba local no cambia el sitio público ni la sincronización de OneDrive.

## 1. Configurar el retorno de Supabase

Abre el [proyecto origami-auth](https://supabase.com/dashboard/project/xkileycaqahtrurnzfaz). En **Authentication → URL Configuration**, establece:

- **Site URL:** `http://localhost:8683`
- **Redirect URLs:** `http://localhost:8683/auth/callback`

Guarda los cambios. Para esta prueba no añadas comodines ni el dominio de `es.ixe.au`. Utiliza siempre `localhost`, no alternes con `127.0.0.1`, porque los navegadores separan sus sesiones y el código usa una ruta de retorno fija. [Guía oficial de redirecciones](https://supabase.com/docs/guides/auth/redirect-urls).

La URL que registrarás en Google y Microsoft es **otra**, el callback de Supabase:

```text
https://xkileycaqahtrurnzfaz.supabase.co/auth/v1/callback
```

No registres el callback local de Origami en lugar de este callback del proveedor.

## 2. Registrar Google para Origami

Abre [Google Auth Platform](https://console.cloud.google.com/auth/overview) y utiliza un proyecto apropiado para Origami; crea uno nuevo si quieres mantenerlo separado. No modifiques el cliente OAuth que utiliza `es.ixe.au`.

1. En **Branding**, configura el nombre **Origami beta** y tu correo de soporte.
2. En **Audience**, selecciona acceso externo si necesitas cuentas Google personales. Para una primera prueba en modo Testing, añade `roberto@rober.to` a Test users si la consola lo requiere. El consentimiento OAuth y la autorización de Origami son controles diferentes.
3. En **Data Access**, utiliza solo los permisos básicos: `openid`, `userinfo.email` y `userinfo.profile`. No añadas Drive, Photos ni permisos sensibles de archivos.
4. En **Clients**, crea un cliente OAuth de tipo **Web application**, nombre **Origami beta local**.
5. En **Authorized JavaScript origins**, añade `http://localhost:8683`.
6. En **Authorized redirect URIs**, añade `https://xkileycaqahtrurnzfaz.supabase.co/auth/v1/callback`.
7. Crea el cliente y guarda su **Client ID** y **Client Secret** en el proveedor **Google** de **Authentication → Sign In / Providers** del proyecto Supabase `origami-auth`. Activa el proveedor y guarda.

Los nombres de secciones pueden variar ligeramente en la consola. La configuración está basada en la [guía oficial Google de Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google). La personalización completa de marca puede exigir verificaciones adicionales; no es necesario contratar un dominio personalizado Supabase para esta prueba.

## 3. Registrar Microsoft: Entra y cuentas personales

Abre [Microsoft Entra](https://entra.microsoft.com/) o el [portal Azure](https://portal.azure.com/). Usa un registro nuevo para Origami; **no cambies el registro que utiliza la sincronización de OneDrive**.

1. Ve a **Microsoft Entra ID → App registrations → New registration**.
2. Nombre: **Origami beta auth**.
3. En **Supported account types**, selecciona **Accounts in any organizational directory and personal Microsoft accounts**. Esto admite tanto la cuenta Entra ID como la personal. No selecciones únicamente “My organization” ni únicamente cuentas personales para este diseño.
4. En **Redirect URI**, selecciona plataforma **Web** y añade `https://xkileycaqahtrurnzfaz.supabase.co/auth/v1/callback`. Registra la aplicación.
5. Copia **Application (client) ID**.
6. En **Certificates & secrets**, crea un **Client secret**. Copia su **Value**, no el Secret ID, y anota su caducidad para renovarlo antes de que deje de funcionar.
7. En el proveedor **Azure (Microsoft)** del panel Supabase, guarda Client ID y Client Secret. En **Azure Tenant URL**, configura `https://login.microsoftonline.com/common`. Activa el proveedor y guarda.

El endpoint `common` acepta los tipos de cuenta permitidos en el registro. Microsoft puede preguntarte si quieres usar **Trabajo o escuela** —Entra— o **Cuenta personal** —Hotmail/Microsoft— cuando el mismo correo exista en ambas. Son identidades Microsoft diferentes, aunque compartan dirección. [Guía oficial Microsoft](https://supabase.com/docs/guides/auth/social-sign-in/auth-azure).

### Verificación del correo Microsoft

La guía oficial recomienda las claims opcionales `email` y `xms_edov` para no confiar en correos no verificados. En **App registrations → tu aplicación → Manifest**, conserva una copia y agrega o combina lo siguiente en `optionalClaims`, **sin reemplazar todo el manifiesto ni eliminar otras claims existentes**:

```json
{
  "idToken": [
    {"name": "xms_edov", "source": null, "essential": false, "additionalProperties": []},
    {"name": "email", "source": null, "essential": false, "additionalProperties": []}
  ],
  "accessToken": [
    {"name": "xms_edov", "source": null, "essential": false, "additionalProperties": []}
  ],
  "saml2Token": []
}
```

El objeto anterior es el **valor de `optionalClaims`**, no un manifiesto completo. Si tu consola usa un formato diferente o la política de Entra impide registrar la aplicación, avísame antes de cambiar permisos o políticas del tenant. El cliente Origami solicita `email`; no requiere `Files.Read` ni acceso a OneDrive.

## 4. Probar tus cuentas y autorizar el UUID

Cuando ambos proveedores y las URLs estén guardados, avísame: **“Google y Microsoft configurados”**. No pegues los secretos en el chat.

La beta local está iniciada en este Mac: abre **http://localhost:8683**. Todavía no puede completar el acceso OAuth hasta que configures los proveedores. Si el servidor se detiene, reinícialo desde Terminal y deja esa ventana abierta:

```bash
cd /Users/xfolders/origami
npm run beta
```

La prueba se comprobó con Node 24.4.1; el SDK usado por el servidor requiere Node 22 o posterior. No necesitas cambiar la instalación actual. El servidor escucha únicamente en loopback, no está publicado en Internet.

La galería está bloqueada por defecto. Después de entrar con `roberto@rober.to`, verás **identidad verificada, permiso pendiente** y tu UUID de Supabase. Es intencional: conocer el correo no concede acceso automático. Podemos aprobar ese UUID después de comprobar tu cuenta; no se necesitan contraseñas ni tokens.

Si prefieres hacerlo tú desde Terminal:

```bash
cd /Users/xfolders/origami
node beta/access.cjs add UUID-MOSTRADO-EN-LA-PANTALLA
```

Sustituye el texto por el UUID real completo, sin comillas adicionales. Después pulsa **Comprobar permiso** en la prueba. La lista de UUID se guarda solamente en un archivo local excluido de Git; esta es una autorización de prueba, no todavía el futuro administrador de bibliotecas.

Supabase puede vincular Google y Microsoft a un mismo usuario cuando el email coincide y está verificado. Por eso puedes ver el mismo UUID. Si aparece otro UUID, revisaremos cuál cuenta Microsoft elegiste antes de autorizarlo. No asumiremos que “mismo correo” implica automáticamente la misma persona autorizada. [Vinculación de identidades](https://supabase.com/docs/guides/auth/auth-identity-linking).

Prueba primero Google, cierra sesión y después prueba Microsoft. Antes de aprobar un UUID, el endpoint local debe denegar las fotos; después de aprobarlo, debe mostrarlas. La comprobación real de los proveedores requiere que tú completes el acceso en tu navegador.

## Qué está aislado y qué queda para después

La prueba usa ocho muestras locales existentes y conserva los módulos visuales 0.9.5. El servidor no publica el árbol del repositorio ni fotos directas sin permiso. Las muestras tienen copias públicas históricas: no se afirma que esas imágenes sean privadas globalmente. Las fotos actuales de Azure siguen públicas hasta una migración posterior expresamente aprobada.

No se ha realizado merge a `main`, cambiado el workflow, configurado un hosting beta en Internet ni alterado la Function de sincronización. La preparación local y las pruebas automáticas no equivalen a haber completado el login real con Google/Microsoft.

Supabase Free puede pausarse por inactividad y tiene cuotas. La cotización de $0 del proyecto no cubre eventuales costes futuros de Azure, dominios o una infraestructura de producción. [Plan y cuotas](https://supabase.com/pricing).
