# Reproducción de álbumes en Origami

La galería usa el manifiesto completo de la biblioteca seleccionada por URL: por ejemplo `?library=instagram`, `?library=spotify`, `?library=bing` o `?library=mx2026`. No mezcla bibliotecas ni requiere modificar las variables de la Azure Function para cambiar la reproducción del navegador.

Comienza con ocho fotos, cuatro por fila. Algunos bloques Single se sustituyen ocasionalmente por Duo y otros Duo se compactan a Single, por lo que cada fila puede tener cuatro, cinco o seis fotos: ocho a doce en reposo. El bloque entrante conserva la anchura exterior del saliente y los demás bloques no se reorganizan globalmente. Durante el segundo de animación siguen existiendo las fotos salientes hasta terminar el efecto; no se utilizan de nuevo mientras sigan presentes.

Cada transición conserva las curvas anteriores y el intervalo nominal de cinco segundos. Las imágenes siguientes se cargan antes de insertar el bloque; una carga lenta puede retrasar el cambio, sin sustituir las fotos por imágenes en blanco o duplicadas. Solo se cargan ocho imágenes iniciales y una o dos para el próximo bloque, nunca todas las del álbum de una vez. Los Duo entrantes se precargan juntos antes de cambiar el tipo o el recuento de fotos.

## Divisiones ocasionales

`index.html` habilita las filas variables en las opciones de `ShiftingTilesPhotos.mount`, que las pasa al plugin:

```js
dynamicRows: {
  enabled: true,
  probability: 0.25,
  minTransitionsBetweenChanges: 3,
  minTileWidth: 160,
  minTileHeight: 100
}
```

`probability` es la probabilidad de intentar un cambio de estructura en una transición elegible, no una división garantizada cada cierto tiempo. El enfriamiento cuenta transiciones completadas. El mínimo de cuatro y máximo de seis fotos por fila son límites del comportamiento, no opciones para ampliar indefinidamente la composición. Si las medidas útiles del bloque resultan demasiado pequeñas, como puede pasar en teléfonos, no se divide. Tampoco se divide si faltan fotos únicas disponibles para precargar sin reutilizar las presentes. El plugin, utilizado directamente sin `dynamicRows.enabled`, conserva el comportamiento anterior.

El álbum necesita al menos ocho URLs distintas: con ocho exactas las mantiene fijas; con menos de ocho espera en vez de duplicar imágenes. Las bibliotecas pequeñas conservan ocho fotos. Al actualizar un manifiesto, se cancelan cargas obsoletas y se respeta la fuente nueva; si el álbum deja de tener capacidad para la composición ampliada, se recupera una composición inicial segura.

## Recorrido y composición

La cola recorre una mezcla aleatoria sin reutilizar URLs hasta completar la vuelta; al empezar otra excluye las fotos aún visibles y las reservadas. Los fallos se distinguen de las fotos vistas y se reintentan de forma acotada dentro de la misma biblioteca. Los archivos no disponibles pueden omitirse durante una vuelta. La exclusión se basa en URLs: dos archivos distintos con contenido idéntico no se comparan visualmente ni se deduplican por contenido. Una vuelta con una única foto pendiente conserva una vía de entrada Single o de compactación para no detener el álbum.

El manifiesto se consulta cada minuto usando ETag/304. Un cambio conserva el historial de las URLs que siguen presentes y agrega las nuevas; no reinicia constantemente la reproducción. El historial vive en memoria durante esa sesión de página. Recargar manualmente la página inicia otra mezcla. El cache de manifiestos sigue separado por biblioteca.

La distribución inicial se calcula con las proporciones de las ocho fotos cargadas. Al redimensionar una composición que ya cambió de estructura, se mantienen su topología y orden y se reescalan los bloques: no se busca una permutación global de doce fotos. Durante los reemplazos no se realiza un reajuste global. Se conserva `contain` para ver las fotos completas, los bordes de 5px, el separador Duo de 10px y el fondo desenfocado actual. Nuevas proporciones pueden dejar más relleno: el refinamiento de sombras y relleno sigue pendiente, separado de esta función.

`?debug=1` agrega un registro JSON no visible en `#gallery-status` con estado de la cola y del layout, sin panel de comparación ni nuevas solicitudes de imágenes. Las estadísticas de reproducción incluyen `rowPhotoCounts`, `structureChanges` y `dynamicRowsEnabled`. Los módulos públicos son `album-queue.js`, `gallery-layout.js` y `gallery-player.js`, incluidos en el empaquetado estático. El backend, sus horarios y `ONEDRIVE_LIBRARIES` no cambian con esta actualización.
