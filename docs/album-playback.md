# Reproducción de álbumes en Origami

La galería usa el manifiesto completo de la biblioteca seleccionada por URL: por ejemplo `?library=instagram`, `?library=spotify`, `?library=bing` o `?library=mx2026`. No mezcla bibliotecas ni requiere modificar las variables de la Azure Function para cambiar la reproducción del navegador.

Comienza con ocho fotos, cuatro por fila. La ruta alineada habilitada en producción mantiene **dos filas y tres columnas compartidas**. Cada celda contiene un Single o un Duo; pueden mostrar cuatro, cinco o seis fotos por fila, ocho a doce en reposo. Las dos filas tienen igual altura y todas las subdivisiones Duo de una misma fila comparten su altura útil. Las divisiones horizontales y verticales coinciden; un Single ocupa la celda completa sin obligarlo a mostrar una subdivisión inexistente.

Los separadores pertenecen a las celdas estables, no a las caras animadas de las fotos. Al sustituir una imagen, las caras saliente y entrante coexisten dentro de la misma celda durante el segundo de animación. Las curvas de encogimiento y rebote se aplican dentro de ella, sin insertar bloques que desplacen las otras columnas. Las anchuras y posiciones de las celdas se ajustan simultáneamente en ambas filas con la misma duración y curva. No se permutan fotos durante cada transición ni se reordena toda la pantalla para mejorar el encaje.

El intervalo nominal sigue siendo de cinco segundos. Las imágenes siguientes se cargan antes de insertar la cara entrante; una carga lenta puede retrasar el cambio sin dejar fotos en blanco ni introducir duplicados. Sólo se cargan ocho imágenes iniciales y una o dos para el próximo bloque, nunca todas las del álbum de una vez. Un Duo se precarga completo antes de cambiar el tipo o recuento. Un fallo o cancelación conserva la composición anterior y libera las reservas.

## Divisiones y encaje conjunto

`index.html` habilita estas opciones en `ShiftingTilesPhotos.mount`, que las pasa al reproductor una sola vez en el arranque:

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
},
alignedLayout: {
  enabled: true,
  minGain: 0.02,
  maxNeighbors: 1
}
```

`alignedLayout.enabled` selecciona la ruta de celdas compartidas y tiene prioridad sobre el ajuste independiente de una fila de versiones anteriores. `gallery-layout.js` calcula la cobertura ocupada por las fotos completas de **ambas filas**, descontando bordes y separación Duo. El reajuste afecta a la columna entrante y, como máximo, una columna vecina a cada lado; las columnas fuera de esa ventana conservan su anchura. La columna correspondiente de la otra fila siempre comparte exactamente el mismo ancho y posición. No se optimizan de forma independiente las alturas de los hijos de cada Duo, pues eso desalinearía sus divisiones horizontales.

`minGain`, 0.02 en producción, define la mejora mínima de cobertura del lienzo completo para aceptar un reajuste o una alternativa estructural elegible. La cobertura mide el área real ocupada por imágenes con `contain`, no una recompensa por añadir casillas. Si se precargan dos fotos pero se conserva un Single, la segunda reserva se libera sin marcarla vista y permanece pendiente para el recorrido del álbum. Una última foto pendiente conserva una vía de entrada Single o de compactación para no detener la vuelta.

`dynamicRows.probability` indica la probabilidad de considerar un cambio de tipo en una transición elegible, no una división garantizada cada cierto tiempo. El enfriamiento cuenta transiciones completadas. Cuatro y seis fotos por fila son límites, no opciones para ampliar indefinidamente el mosaico. Las divisiones requieren suficientes fotos únicas, espacio útil mínimo y reservas sin reutilizar las presentes. En teléfonos estrechos puede no haber espacio para dividir. Los álbumes pequeños conservan ocho fotos; un álbum necesita al menos ocho URLs distintas y con ocho exactas permanece fijo, en vez de duplicar imágenes.

Las opciones se mantienen deshabilitadas por defecto para el uso directo del plugin. La galería pública las habilita explícitamente. La ruta anterior permanece para compatibilidad, pero sus ajustes independientes no son la ruta alineada de producción.

## Recorrido, cambios de fuente y dimensiones

La cola recorre una mezcla aleatoria sin reutilizar URLs hasta completar la vuelta; al empezar otra excluye las fotos todavía visibles, salientes y reservadas. Ninguna foto se salta por sus proporciones. Los fallos se distinguen de las fotos vistas y se reintentan de forma acotada dentro de la misma biblioteca; archivos no disponibles pueden omitirse durante una vuelta. La exclusión se basa en URLs: archivos distintos con contenido idéntico no se comparan visualmente ni se deduplican por contenido.

El manifiesto se consulta cada minuto usando ETag/304. Un cambio conserva el historial de las URLs que siguen presentes y agrega las nuevas, sin reiniciar constantemente la reproducción. El historial vive en memoria durante esa sesión; recargar manualmente la página inicia otra mezcla. El caché de manifiestos sigue separado por biblioteca. Un cambio de fuente cancela cargas obsoletas; si la fuente se reduce y no sostiene la composición actual, se recupera una composición inicial segura sin conservar URLs ajenas.

El encaje inicial usa las proporciones naturales de las ocho fotos cargadas. Un resize conserva las celdas, tipos y orden y adapta sus medidas comunes al lienzo disponible, sin buscar permutaciones globales. Las anchuras se guardan como medidas lógicas compartidas y se normalizan al ancho interior actual; no se suman por separado anchuras DOM redondeadas de una sola fila. Al activar una transición tras la precarga se revalidan las dimensiones, para no aplicar un cálculo anterior a un resize. Un reajuste pendiente también se recupera si falla la precarga.

Al ocultar la página se detiene el reloj y se termina la animación activa. Una precarga pendiente sólo se activa al volver después de revalidar la geometría actual. Destruir el reproductor cancela reservas, cargas, plazos, observadores y eventos, sin dejar timers duplicados.

## Separadores y fotos completas

Los separadores negros tienen **4px en total** entre columnas, filas, fotos de un Duo y en el perímetro. Cada celda tiene un borde de 2px por lado; bordes vecinos suman 4px. La galería añade 2px externos, por lo que el perímetro suma los mismos 4px. Las caras dentro de la celda no añaden un segundo borde. Un Duo tiene un único espacio central de 4px; su línea permanece fija mientras se animan las caras. La planificación usa el lienzo interior de la galería y descuenta 4px por celda y 4px por división Duo.

Se conserva `contain` para ver las fotos completas sin deformación ni recorte. Se elimina por completo el fondo borroso y la copia `cover`; el espacio sobrante es negro. El encaje conjunto busca reducir ese margen, pero no garantiza eliminarlo con cualquier combinación de proporciones y resolución. La imagen no se recorta ni estira para ocultarlo.

`?debug=1` agrega un registro JSON no visible en `#gallery-status` con estado de la cola y del layout, sin controles ni solicitudes de imágenes adicionales. Las estadísticas incluyen los recuentos por fila, cambios estructurales, ajustes locales y estado de alineación. Los módulos públicos incluyen `album-queue.js`, `gallery-layout.js`, `gallery-aligned-playback.js` y `gallery-player.js`, incluidos en el paquete estático. El backend, sus horarios y `ONEDRIVE_LIBRARIES` no cambian con esta actualización.
