# HEIC/HEIF en las bibliotecas de OneDrive

El publicador admite `.heic` y `.heif` en todas las bibliotecas configuradas, sin un flag adicional. Mantiene los originales en OneDrive y publica únicamente una copia JPEG de la imagen principal en `$web/photos/onedrive/<id>/`. La copia conserva resolución y orientación, sin recortes, con calidad JPEG 95 y sin submuestreo de color. Conserva el perfil ICC cuando existe; elimina EXIF/GPS/XMP y no incluye vídeos, profundidad ni imágenes auxiliares. JPEG convencional no conserva necesariamente HDR y usa compresión con pérdida.

La descarga sigue comprobando pertenencia a la carpeta, tamaño original y versión. El journal registra tamaño y SHA-256 del JPEG publicado. Los archivos sin cambios se reutilizan sin descargar ni convertir nuevamente; una recuperación tras un crash ambiguo puede necesitar una descarga de verificación. Si un archivo cambia, se genera una nueva ruta opaca. Los formatos existentes siguen copiándose byte a byte.

Los límites son 50 MiB de entrada/salida y 60 millones de píxeles por HEIC, suficientes para una foto estándar de 48 MP del iPhone 16. Cuando `ONEDRIVE_SKIP_INVALID=true`, archivos corruptos o que superan esos límites se omiten con códigos seguros. No se recortan ni reducen para hacerlos caber.

## Activar MX2026

El usuario agrega la biblioteca una vez desplegado el soporte, conservando las otras entradas y la coma entre Bing y MX2026:

```json
[
  {"id":"spotify","path":"Musica/Spotify","recursive":true,"enabled":true},
  {"id":"instagram","path":"Instagram","recursive":true,"enabled":true},
  {"id":"bing","path":"Fotos(Oficial)/Bing","recursive":true,"enabled":true},
  {"id":"mx2026","path":"Carrusel/MX2026","recursive":true,"enabled":true}
]
```

El timer horario inicia la reconciliación y el de continuación mantiene los lotes pendientes. Las copias aparecen progresivamente en la galería `?library=mx2026`, separadas de las otras bibliotecas. La página requiere al menos ocho fotos publicadas para mostrar ocho distintas.

Dependencias: Pillow 13.0.0 y pillow-heif 1.8.1, con wheels Linux x86_64 disponibles para el runtime Python 3.12. La conversión no ocurre en el navegador y no usa IA ni permisos adicionales de OneDrive.
