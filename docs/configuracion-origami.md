# Configurar el despliegue de Origami 0.9

El código está en https://github.com/soyroberto/origami, rama `main`, con etiqueta `v0.9.0`. El despliegue está preparado, pero **bloqueado por defecto**: el job solo corre si la variable de repositorio `ORIGAMI_DEPLOY_ENABLED` vale exactamente `true`.

Estos pasos son para que tú los realices. No se han configurado secretos, entornos, credenciales federadas ni permisos Azure para Origami; tampoco se ha deshabilitado el workflow antiguo ni desplegado el sitio nuevo. La Function y la sincronización actual siguen independientes de esta preparación.

## 1. Preparar el entorno de GitHub

Abre https://github.com/soyroberto/origami/settings/environments y crea un entorno llamado **`beta`**. El nombre sigue siendo beta porque reutilizamos los recursos Azure actuales; la rama de desarrollo y despliegue del nuevo repositorio es **`main`**.

En **Deployment branches and tags**, selecciona ramas/etiquetas específicas y autoriza únicamente la rama `main`. No uses un comodín ni añadas las ramas `legacy/*`. Puedes añadir un revisor si quieres aprobar cada despliegue manualmente. [1]

Dentro del entorno `beta`, crea estos tres **Environment secrets**, usando los identificadores de la identidad que ya despliega el sitio antiguo:

```text
BETA_AZURE_CLIENT_ID
BETA_AZURE_TENANT_ID
BETA_AZURE_SUBSCRIPTION_ID
```

El primero es el **Application/client ID de la identidad de despliegue GitHub→Azure**, no `ONEDRIVE_CLIENT_ID` ni la identidad de la Function. El segundo es el Directory/tenant ID de esa aplicación; el tercero es la suscripción que contiene `saauxfotos`. Consíguelos en Azure: GitHub no permite recuperar el valor guardado de un secreto existente. Estos tres valores son identificadores, no contraseñas. No crees client secrets, claves de Storage, SAS ni publish profiles para este workflow. [2] [3]

En las **Environment variables** del entorno `beta`, añade:

```text
BETA_WEBSITE_URL=https://saauxfotos.z26.web.core.windows.net/
```

Todavía no actives `ORIGAMI_DEPLOY_ENABLED`. Si quieres dejar su valor explícito, créala como variable de **repositorio**, no del entorno, con valor `false`, desde https://github.com/soyroberto/origami/settings/variables/actions.

## 2. Autorizar el repositorio nuevo en Azure

Abre https://portal.azure.com/ y entra a **Microsoft Entra ID → App registrations**. Localiza la misma aplicación que usa `BETA_AZURE_CLIENT_ID` para desplegar el sitio antiguo; el nombre previsto era `shiftingtiles-beta-storage-deployer`, pero comprueba el client ID antes de modificarla. **No selecciones la aplicación personal de OneDrive.**

En **Certificates & secrets → Federated credentials → Add credential**, añade una nueva confianza, sin reemplazar inicialmente la antigua. Para poder escribir el subject correcto, usa el escenario **Other issuer**. Configura:

```text
Name: github-origami-beta
Issuer: https://token.actions.githubusercontent.com
Audience: api://AzureADTokenExchange
Subject: repo:soyroberto@1945856/origami@1462362726:environment:beta
```

Este subject corresponde al formato predeterminado inmutable de los repositorios creados después del 15 de julio de 2026: incluye los IDs públicos del propietario y del repositorio. Los IDs de Origami se consultaron al crearlo. **No uses simplemente `repo:soyroberto/origami:environment:beta`, ni un subject de rama**, porque el job usa el entorno `beta`. Si modificas la plantilla OIDC de GitHub, el subject tendrá que coincidir con esa plantilla, no con este valor predeterminado. [3] [4]

Guarda la credencial. Reutilizando la misma identidad, deberían conservarse sus permisos actuales de **Storage Blob Data Contributor** sobre el contenedor `$web` de `saauxfotos`. No necesitas ampliar permisos a toda la cuenta/suscripción ni otorgar acceso al estado privado de OneDrive. Si el despliegue falla con 403, verifica esos permisos y la red, en vez de añadir claves o permisos amplios. [3]

**No cambies** `ONEDRIVE_LIBRARIES`, `ONEDRIVE_SYNC_ENABLED`, la sesión de OneDrive, los contenedores, la identidad de la Function ni su almacenamiento host. Este cambio de repositorio no requiere reconectar OneDrive ni volver a publicar el backend.

## 3. Hacer la transición sin dos despliegues competidores

Cuando lo anterior esté listo, abre https://github.com/soyroberto/shiftingtiles/actions. Selecciona **Deploy beta gallery to Azure Storage** y, en su menú, **Disable workflow**. Deshabilita únicamente ese workflow; no los de producción.

Espera a que no haya ejecuciones pendientes o en curso del deployment beta antiguo. Tener el mismo nombre de concurrency en dos repositorios no los coordina. No archives todavía el repositorio entero ni borres la identidad o la credencial antigua: conservarlas inicialmente facilita volver atrás. [5]

Luego abre https://github.com/soyroberto/origami/settings/variables/actions y establece la variable de **repositorio**:

```text
ORIGAMI_DEPLOY_ENABLED=true
```

Debe ser el texto `true` en minúsculas. En https://github.com/soyroberto/origami/actions selecciona **Deploy Origami to Azure Storage → Run workflow**, elige `main` y ejecútalo. A partir de entonces, los pushes a `main` también podrán desplegar; las etiquetas y `legacy/*` no son la rama de despliegue.

## 4. Comprobar el primer despliegue

El workflow empaqueta únicamente los assets públicos, autentica por OIDC, sube los assets y el documento `acercade` con MIME HTML, y publica `index.html` al final. No borra blobs ajenos ni modifica fotografías/manifiestos de OneDrive.

Cuando termine correctamente, abre:

- Galería: https://saauxfotos.z26.web.core.windows.net/
- Acerca de: https://saauxfotos.z26.web.core.windows.net/acercade
- Versión del código: https://saauxfotos.z26.web.core.windows.net/version.js

`/acercade` debe mostrar **Origami 0.9** y la versión completa **0.9.0**. **No habrá ninguna liga a esa página desde la raíz**, conforme a lo solicitado. Usa su URL directa. La versión de código tiene una sola definición en `version.js`; también agrega un meta `application-version` no visible en la galería.

La galería debe conservar sus ocho fotos, bibliotecas independientes y animación. Usa una recarga forzada si tu navegador conserva archivos anteriores. Las rutas anteriores son las de destino: no se afirma que `/acercade` ya esté disponible antes de realizar este primer despliegue.

## Si algo falla

Un workflow con job **skipped** normalmente significa que `ORIGAMI_DEPLOY_ENABLED` no es `true`, o que se eligió una rama distinta de `main`. Un error **Missing deployment environment setting** indica que falta uno de los tres secrets o `BETA_WEBSITE_URL` en el entorno `beta`.

Un error de OIDC de tipo **no matching federated identity record** requiere comparar issuer, subject y audience con la credencial Azure; no compartas ni imprimas el JWT completo. Los errores de almacenamiento 403 pueden ser permisos, propagación o red.

Para volver atrás, pon `ORIGAMI_DEPLOY_ENABLED=false`, espera a que termine cualquier despliegue de Origami y vuelve a habilitar únicamente el deployment beta antiguo. Ejecutarlo desde su rama `beta` restaura sus archivos empaquetados. La página adicional puede permanecer almacenada, porque ninguno de los dos workflows borra blobs; retirar esa página sería otra acción, no una consecuencia automática del rollback.

## Referencias

[1]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments "Entornos y restricciones de despliegue GitHub"
[2]: https://docs.github.com/en/rest/actions/secrets "Secretos GitHub: consulta de metadatos sin valor"
[3]: https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect "Autenticación Azure mediante GitHub OIDC"
[4]: https://docs.github.com/en/actions/reference/security/oidc "Claims OIDC y formato inmutable con IDs"
[5]: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency "Concurrencia de workflows por repositorio"
