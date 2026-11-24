# Origami 0.9

Galería animada de fotos de OneDrive, basada en la implementación web de Shifting Tiles. Comienza con ocho fotos —cuatro por fila— y divide o compacta ocasionalmente algunos bloques para mostrar entre cuatro y seis fotos por fila, si el espacio y el álbum lo permiten. Conserva las transiciones Single/Duo y las bibliotecas separadas. El publicador incremental convierte HEIC/HEIF a JPEG para los navegadores, sin modificar los originales OneDrive.

La versión tiene una única definición en `version.js`: **0.9.5**. Su etiqueta es `v0.9.5`; la presentación abreviada es **Origami 0.9**. Las etiquetas históricas `v0.9.0` a `v0.9.4` permanecen intactas.

Las filas usan una medida de ancho común y pueden tener distintas combinaciones y cantidades de bloques, sin imponer tres columnas idénticas. El arranque evalúa particiones modulares pequeñas; después conserva grupos y módulos al redimensionar. Los bloques Duo comparten el eje de sus dos fotos. Las líneas se desplazan durante la animación y recuperan la cuadrícula al terminar; las casillas se llenan con una sola foto sin relleno desenfocado, usando `cover`: puede recortar sus bordes, pero no deforma la imagen. Los separadores permanecen sin cambios.

## Código y configuración

Repositorio independiente: https://github.com/soyroberto/origami

`main` parte del commit `647b875` de la rama `beta` anterior. Las ramas remotas históricas se conservan como `legacy/*`, con sus commits y autores intactos. No se hizo merge al `main` o `master` del repositorio legado: https://github.com/soyroberto/shiftingtiles

Guía para que el propietario configure GitHub y Azure: https://github.com/soyroberto/origami/blob/main/docs/configuracion-origami.md

El workflow del sitio está **bloqueado por defecto** mediante `ORIGAMI_DEPLOY_ENABLED`; su activación y la transición desde el repositorio legado se completaron el 23 de noviembre de 2026. Los cambios de `main` se publican mediante el entorno GitHub `beta` y OIDC, sin eliminar las fotos existentes. El publicador permanece en `backend/onedrive-publisher` y se despliega separadamente; este workflow solo publica el frontend.

## Sitio

Se reutilizan los recursos existentes. Direcciones del sitio:

- Galería: https://saauxfotos.z26.web.core.windows.net/
- Acerca de: https://saauxfotos.z26.web.core.windows.net/acercade

No se añade ninguna liga desde la raíz a `/acercade`, ni texto permanente sobre las fotografías. Las divisiones se configuran en `index.html` mediante `dynamicRows`; consulta [reproducción de álbumes](docs/album-playback.md). La opción A fue aprobada visualmente: se elimina el relleno desenfocado y se permiten recortes para llenar las casillas. Se favorecen fotos de proporción cercana entre un conjunto acotado de candidatas, sin relegar indefinidamente otros formatos. No se incorpora todavía un administrador de bibliotecas.

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
