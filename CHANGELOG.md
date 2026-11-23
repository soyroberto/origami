# Historial de versiones

## 0.9.1 — 2026-11-23

Los bloques Single/Duo pueden dividirse y compactarse ocasionalmente durante la sustitución normal: cuatro, cinco o seis fotos por fila, con ocho a doce en reposo. La probabilidad y el intervalo mínimo entre cambios estructurales se configuran en el arranque. Las divisiones respetan el espacio útil y la disponibilidad de fotos únicas; los álbumes pequeños conservan el comportamiento anterior.

Se mantiene la precarga atómica y el recorrido completo del álbum, excluyendo las fotos visibles y salientes. La anchura exterior de cada bloque se conserva durante el cambio; el redimensionado admite filas variables sin ampliar la búsqueda combinatoria del layout. Se actualizan la descripción de `/acercade`, las referencias de caché y las pruebas.

Sin cambios en sombras, bordes, fotos completas (`contain`), backend, OneDrive ni configuración Azure. Se conserva la etiqueta `v0.9.0` y el historial previo. La transición al despliegue de Origami mediante GitHub `main` quedó completada en esta fecha.

## 0.9.0 — 2026-11-18

Primera versión identificada como Origami, con `main` basada en el beta funcional de https://github.com/soyroberto/shiftingtiles. El historial remoto se conserva en ramas `legacy/*`.

Se incorpora la definición única `version.js` y la página española `/acercade`, sin liga desde la galería. El despliegue del sitio se adapta al repositorio https://github.com/soyroberto/origami y permanece bloqueado hasta que el propietario configure GitHub y Azure.

Se conservan, sin modificaciones funcionales, el mosaico de ocho fotos, el recorrido del álbum sin duplicados por vuelta, las bibliotecas independientes, la publicación incremental y el soporte global HEIC/HEIF→JPEG. No se añade todavía la ficha de metadatos al hacer clic o tocar una foto.
