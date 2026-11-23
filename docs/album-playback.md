# Reproducción de álbumes en Origami

La galería usa el manifiesto completo de la biblioteca seleccionada por URL: por ejemplo `?library=instagram`, `?library=spotify`, `?library=bing` o `?library=mx2026`. No mezcla bibliotecas ni requiere modificar las variables de la Azure Function para cambiar la reproducción del navegador.

Comienza con ocho fotos, cuatro por fila. Algunos bloques Single se sustituyen ocasionalmente por Duo y otros Duo se compactan a Single, por lo que cada fila puede tener cuatro, cinco o seis fotos: ocho a doce en reposo. La composición tiene en cuenta las proporciones naturales de las fotos precargadas para reducir el relleno. El bloque entrante y, como máximo, un vecino a cada lado pueden redistribuir sus anchuras suavemente; no se cambia su orden, la altura de la fila ni la otra fila. Durante el segundo de animación siguen existiendo las fotos salientes hasta terminar el efecto; no se utilizan de nuevo mientras sigan presentes.

Cada transición conserva las curvas anteriores y el intervalo nominal de cinco segundos. Las imágenes siguientes se cargan antes de insertar el bloque; una carga lenta puede retrasar el cambio, sin sustituir las fotos por imágenes en blanco o duplicadas. Solo se cargan ocho imágenes iniciales y una o dos para el próximo bloque, nunca todas las del álbum de una vez. Los Duo entrantes se precargan juntos antes de cambiar el tipo o el recuento de fotos. Un fallo de precarga o una cancelación conserva la composición anterior y libera las reservas.

## Divisiones y encaje local

`index.html` habilita ambas opciones en `ShiftingTilesPhotos.mount`, que las pasa al plugin en el arranque:

```js
dynamicRows: {
  enabled: true,
  probability: 0.25,
  minTransitionsBetweenChanges: 3,
  minTileWidth: 160,
  minTileHeight: 100
},
adaptiveLayout: {
  enabled: true,
  minGain: 0.02,
  maxNeighbors: 1
}
```

`probability` es la probabilidad de considerar un cambio de estructura en una transición elegible, no una división garantizada cada cierto tiempo. El enfriamiento cuenta transiciones completadas. El mínimo de cuatro y máximo de seis fotos por fila son límites del comportamiento, no opciones para ampliar indefinidamente la composición. Si las medidas útiles del bloque resultan demasiado pequeñas, como puede pasar en teléfonos, no se divide. Tampoco se divide si faltan fotos únicas disponibles para precargar sin reutilizar las presentes.

Con `adaptiveLayout.enabled`, una alternativa estructural elegible solo se utiliza si mejora materialmente el encaje respecto al reemplazo normal. El cálculo usa el área ocupada por las fotos completas con `contain`, no el fondo desenfocado ni una recompensa por añadir casillas. `minGain` define la mejora mínima de cobertura de la fila; en producción es 0.02. El reajuste local de anchuras también exige una mejora material y nunca sustituye al optimizador global en cada transición. Si se precargan dos fotos pero se conserva un Single, la segunda reserva se libera sin marcarla como vista: permanece pendiente para el recorrido del álbum.

Las opciones están deshabilitadas por defecto al utilizar directamente el plugin. Sin `adaptiveLayout.enabled` los reemplazos conservan la anchura exterior anterior; sin `dynamicRows.enabled` no se realizan divisiones ocasionales.

El álbum necesita al menos ocho URLs distintas: con ocho exactas las mantiene fijas; con menos de ocho espera en vez de duplicar imágenes. Las bibliotecas pequeñas conservan ocho fotos. Al actualizar un manifiesto, se cancelan cargas obsoletas y se respeta la fuente nueva; si el álbum deja de tener capacidad para la composición ampliada, se recupera una composición inicial segura.

## Recorrido y geometría

La cola recorre una mezcla aleatoria sin reutilizar URLs hasta completar la vuelta; al empezar otra excluye las fotos aún visibles y las reservadas. Elegir una composición no permite saltarse fotos por sus proporciones. Los fallos se distinguen de las fotos vistas y se reintentan de forma acotada dentro de la misma biblioteca. Los archivos no disponibles pueden omitirse durante una vuelta. La exclusión se basa en URLs: dos archivos distintos con contenido idéntico no se comparan visualmente ni se deduplican por contenido. Una vuelta con una única foto pendiente conserva una vía de entrada Single o de compactación para no detener el álbum.

El manifiesto se consulta cada minuto usando ETag/304. Un cambio conserva el historial de las URLs que siguen presentes y agrega las nuevas; no reinicia constantemente la reproducción. El historial vive en memoria durante esa sesión de página. Recargar manualmente la página inicia otra mezcla. El cache de manifiestos sigue separado por biblioteca.

La distribución inicial se calcula con las proporciones de las ocho fotos cargadas. Al redimensionar una composición que ya cambió de estructura o se ajustó localmente, se mantienen su topología y orden y se reescalan los bloques: no se busca una permutación global de doce fotos. Las medidas del encaje local se calculan de nuevo al activar el cambio tras la precarga, para no aplicar medidas anteriores a un resize. Las reservas y cargas obsoletas se cancelan al cambiar de fuente o destruir el reproductor. Al ocultar la página se detiene el reloj y se termina la animación activa; una precarga pendiente solo se activa al volver, tras revalidar la geometría actual.

Los separadores negros tienen **2px en total** entre bloques, filas, fotos de un Duo y en el perímetro. Cada bloque tiene un borde de 1px por lado; los bordes vecinos suman 2px. El borde exterior adicional de la galería es de 1px, por lo que el perímetro también suma 2px. El separador interno de Duo es de 2px. La planificación usa el lienzo interior de la galería y descuenta 2px por caja y 2px por separador Duo.

Se conserva `contain` para ver las fotos completas, sin deformación ni recorte. El fondo desenfocado actual sigue cubriendo el espacio residual. La composición reduce el relleno cuando el encaje mejora, pero no garantiza eliminarlo para cualquier combinación de fotos y viewport.

`?debug=1` agrega un registro JSON no visible en `#gallery-status` con estado de la cola y del layout, sin panel de comparación ni nuevas solicitudes de imágenes. Las estadísticas de reproducción incluyen `rowPhotoCounts`, `structureChanges`, `dynamicRowsEnabled`, `adaptiveLayoutEnabled` y `localFits`. Los módulos públicos son `album-queue.js`, `gallery-layout.js` y `gallery-player.js`, incluidos en el empaquetado estático. El backend, sus horarios y `ONEDRIVE_LIBRARIES` no cambian con esta actualización.
