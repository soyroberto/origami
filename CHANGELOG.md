# Historial de versiones

## 0.9.5 — 2026-11-24

Se publica la opción A, elegida y aprobada visualmente por el propietario tras comparar dos variantes locales. Se elimina la copia ampliada y desenfocada de cada foto: una única capa `cover` llena la casilla sin deformación ni relleno añadido, admitiendo los recortes necesarios. Se conserva la cuadrícula modular de 0.9.4, sus separadores de 5px por borde y 10px interiores, y las transiciones y el ritmo originales.

La selección por proporciones examina hasta tres candidatas Single o seis Duo, con dos cargas simultáneas durante las transiciones y hasta 64 entradas de dimensiones. La prioridad por antigüedad limita las postergaciones elegibles y mantiene el recorrido completo de la biblioteca. Se conservan la precarga atómica, la exclusión de fotos visibles y salientes, las cuatro a seis fotos por fila y las bibliotecas separadas.

Se actualizan la versión central, la caché pública, `/acercade`, la documentación y las pruebas. No se publican la opción B, la comparación ni su semilla de prueba. Backend, sincronización OneDrive, workflow, configuración Azure y repositorio legado sin cambios. El administrador de bibliotecas queda para una etapa posterior; las etiquetas históricas permanecen intactas.

## 0.9.4 — 2026-11-24

Se recupera un patrón modular común entre las filas, basado en la referencia original: los bloques ocupan múltiplos de una misma medida de ancho y cada fila puede combinarlos de distinta manera o tener distinta cantidad de grupos. No se imponen tres columnas idénticas. Los bloques Duo comparten un eje horizontal y las dos filas ocupan mitades de la altura disponible.

El ajuste puede agrupar fotos contiguas al arranque; después conserva identidades, bloques y módulos al redimensionar. Se mantienen las transiciones flotantes, el intervalo de cinco segundos, la precarga atómica, las cuatro a seis fotos por fila, el recorrido completo del álbum y las bibliotecas separadas. La prueba local fue revisada y aprobada visualmente por el propietario antes de autorizar producción.

Esta versión parte de la recuperación exacta de 0.9.1. Las etiquetas y commits de 0.9.2 y 0.9.3 se conservan en el historial, sin reutilizarlos. Las fotos completas (`contain`), sombras y relleno borroso, separadores, backend, OneDrive, workflow y recursos Azure permanecen sin cambios; la eliminación de sombras se reserva para la siguiente versión.

## 0.9.1 — 2026-11-23

Los bloques Single/Duo pueden dividirse y compactarse ocasionalmente durante la sustitución normal: cuatro, cinco o seis fotos por fila, con ocho a doce en reposo. La probabilidad y el intervalo mínimo entre cambios estructurales se configuran en el arranque. Las divisiones respetan el espacio útil y la disponibilidad de fotos únicas; los álbumes pequeños conservan el comportamiento anterior.

Se mantiene la precarga atómica y el recorrido completo del álbum, excluyendo las fotos visibles y salientes. La anchura exterior de cada bloque se conserva durante el cambio; el redimensionado admite filas variables sin ampliar la búsqueda combinatoria del layout. Se actualizan la descripción de `/acercade`, las referencias de caché y las pruebas.

Sin cambios en sombras, bordes, fotos completas (`contain`), backend, OneDrive ni configuración Azure. Se conserva la etiqueta `v0.9.0` y el historial previo. La transición al despliegue de Origami mediante GitHub `main` quedó completada en esta fecha.

## 0.9.0 — 2026-11-18

Primera versión identificada como Origami, con `main` basada en el beta funcional de https://github.com/soyroberto/shiftingtiles. El historial remoto se conserva en ramas `legacy/*`.

Se incorpora la definición única `version.js` y la página española `/acercade`, sin liga desde la galería. El despliegue del sitio se adapta al repositorio https://github.com/soyroberto/origami y permanece bloqueado hasta que el propietario configure GitHub y Azure.

Se conservan, sin modificaciones funcionales, el mosaico de ocho fotos, el recorrido del álbum sin duplicados por vuelta, las bibliotecas independientes, la publicación incremental y el soporte global HEIC/HEIF→JPEG. No se añade todavía la ficha de metadatos al hacer clic o tocar una foto.
