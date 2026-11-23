# Historial de versiones

## 0.9.3 — 2026-11-24

Corrige la desalineación provocada por el ajuste independiente de las filas en 0.9.2. La ruta alineada usa dos filas de igual altura y tres columnas compartidas; las subdivisiones Duo también comparten su posición horizontal dentro de cada fila. Las celdas conservan los bordes durante las animaciones y sus anchuras se ajustan simultáneamente arriba y abajo, sin permutar las fotografías. Se mantienen ocho fotos iniciales y los cambios ocasionales de cuatro a seis fotos por fila.

Los separadores negros pasan a 4px en total, incluidos Duo y perímetro. Se elimina por completo la capa borrosa y la copia `cover`: las fotos principales usan `contain`, sin recortes ni deformación. El encaje conjunto busca reducir el espacio negro residual, sin prometer llenar cualquier celda con cualquier proporción.

Se conservan la cola del álbum, la precarga atómica y el ritmo nominal de cinco segundos. Se añade el módulo público de reproducción alineada y se actualizan caché, `/acercade`, documentación y regresiones. Sin cambios de backend, sincronización OneDrive, bibliotecas, horarios, recursos Azure ni workflow de despliegue. Las etiquetas anteriores permanecen intactas.

## 0.9.2 — 2026-11-23

Separadores negros uniformes de 2px en total, entre bloques, entre filas, en el interior de Duo y en el perímetro. Las fotos principales conservan `contain`, sin recortes ni deformación; el fondo desenfocado sigue disponible cuando las proporciones no permiten llenar cada celda.

El ajuste local usa las proporciones naturales de las fotos precargadas para reducir el relleno. Solo redistribuye anchuras del bloque entrante y sus vecinos inmediatos, manteniendo el orden, la otra fila y las curvas actuales de animación. Las alternativas Single/Duo elegibles se comparan por encaje, no solo por azar; una reserva adicional que no se utiliza se libera sin marcarla como vista. Se conserva la precarga atómica, el recorrido completo y la exclusión de fotos visibles y salientes.

La adaptación se habilita explícitamente en producción mediante `adaptiveLayout`; el uso directo del plugin conserva su opción deshabilitada por defecto. Se renuevan las referencias de caché, `/acercade`, la documentación y las regresiones de geometría y reproducción. Sin cambios de backend, OneDrive, horarios, bibliotecas ni recursos Azure; las etiquetas previas permanecen intactas.

## 0.9.1 — 2026-11-23

Los bloques Single/Duo pueden dividirse y compactarse ocasionalmente durante la sustitución normal: cuatro, cinco o seis fotos por fila, con ocho a doce en reposo. La probabilidad y el intervalo mínimo entre cambios estructurales se configuran en el arranque. Las divisiones respetan el espacio útil y la disponibilidad de fotos únicas; los álbumes pequeños conservan el comportamiento anterior.

Se mantiene la precarga atómica y el recorrido completo del álbum, excluyendo las fotos visibles y salientes. La anchura exterior de cada bloque se conserva durante el cambio; el redimensionado admite filas variables sin ampliar la búsqueda combinatoria del layout. Se actualizan la descripción de `/acercade`, las referencias de caché y las pruebas.

Sin cambios en sombras, bordes, fotos completas (`contain`), backend, OneDrive ni configuración Azure. Se conserva la etiqueta `v0.9.0` y el historial previo. La transición al despliegue de Origami mediante GitHub `main` quedó completada en esta fecha.

## 0.9.0 — 2026-11-18

Primera versión identificada como Origami, con `main` basada en el beta funcional de https://github.com/soyroberto/shiftingtiles. El historial remoto se conserva en ramas `legacy/*`.

Se incorpora la definición única `version.js` y la página española `/acercade`, sin liga desde la galería. El despliegue del sitio se adapta al repositorio https://github.com/soyroberto/origami y permanece bloqueado hasta que el propietario configure GitHub y Azure.

Se conservan, sin modificaciones funcionales, el mosaico de ocho fotos, el recorrido del álbum sin duplicados por vuelta, las bibliotecas independientes, la publicación incremental y el soporte global HEIC/HEIF→JPEG. No se añade todavía la ficha de metadatos al hacer clic o tocar una foto.
