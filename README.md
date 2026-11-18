# Origami 0.9

Galería animada de fotos de OneDrive, basada en la implementación web de Shifting Tiles. Conserva ocho fotos —cuatro por fila—, las transiciones Single/Duo y las bibliotecas separadas. El publicador incremental convierte HEIC/HEIF a JPEG para los navegadores, sin modificar los originales OneDrive.

La versión tiene una única definición en `version.js`: **0.9.0**. Su etiqueta es `v0.9.0`; la presentación abreviada es **Origami 0.9**.

## Código y configuración

Repositorio independiente: https://github.com/soyroberto/origami

`main` parte del commit `647b875` de la rama `beta` anterior. Las ramas remotas históricas se conservan como `legacy/*`, con sus commits y autores intactos. No se hizo merge al `main` o `master` del repositorio legado: https://github.com/soyroberto/shiftingtiles

Guía para que el propietario configure GitHub y Azure: https://github.com/soyroberto/origami/blob/main/docs/configuracion-origami.md

El workflow del sitio está **bloqueado por defecto** mediante `ORIGAMI_DEPLOY_ENABLED`. Los secretos, el entorno y la credencial federada no se transfieren automáticamente. El publicador permanece en `backend/onedrive-publisher` y se despliega separadamente; este workflow solo publica el frontend.

## Sitio

Se reutilizan los recursos existentes. Direcciones de destino después de completar la configuración y ejecutar el despliegue:

- Galería: https://saauxfotos.z26.web.core.windows.net/
- Acerca de: https://saauxfotos.z26.web.core.windows.net/acercade

No se añade ninguna liga desde la raíz a `/acercade`, ni texto permanente sobre las fotografías. No se ha desplegado esta nueva versión al preparar el repositorio.

## Desarrollo

Se usa JavaScript, jQuery y LESS del proyecto existente. Con Node compatible y Python 3.11 o posterior:

```bash
npm ci --ignore-scripts
npm test
npm run test:package
python3 .github/scripts/prepare_static_site.py --repo "$PWD" --output "$PWD/.work/site"
```

`package-lock.json` fija las herramientas DOM de desarrollo; no son dependencias de producción. El paquete debe generarse en una carpeta nueva/vacía. Excluye backend, tokens y estado privado. El workflow publica además el blob `acercade` con MIME HTML para que la URL exacta no dependa de una barra final o un router.

## Créditos y origen

Implementación original de Shifting Tiles: https://hermanbanken.github.io/shiftingtiles/

El protector Shifting Tiles de macOS es la inspiración visual; Origami no está afiliado con Apple. El historial original y los archivos de terceros conservan sus atribuciones. No se asignó una licencia nueva.
