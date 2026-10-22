# Chat de trabajo y navegación

La PWA concentra el trabajo en una conversación: mensajes propios a la derecha, respuestas legibles y compositor persistente con adjunto opcional, dictado y envío. Enter envía; Shift+Enter agrega una línea. Una composición de teclado en curso no se envía por error. Escribir el próximo mensaje mientras llega la respuesta no borra ese borrador.

El micrófono admite gestos: mantener presionado para grabar, soltar para transcribir, deslizar a la izquierda para cancelar y hacia arriba para manos libres. En manos libres se muestran **Terminar** y **Cancelar**. Un toque o el teclado permiten iniciar/terminar sin arrastrar. El audio nunca envía la consulta automáticamente: se agrega al borrador para revisarlo. Cancelar descarta el audio; cambiar de conversación/sucursal, cerrar sesión u ocultar la página detiene el micrófono. El límite sigue siendo 45 segundos. Para usuarios de otra PC se requiere HTTPS confiable y permiso personal de micrófono; el navegador no graba por arrancar el servicio.

Los gestos tienen indicaciones visuales y el contador no anuncia cada segundo al lector de pantalla. Soltar antes de aceptar el permiso descarta ese intento y libera el micrófono si el permiso llega tarde. Una pulsación táctil final que cae sobre un control recién aparecido no se interpreta como otra orden. El dictado se agrega al borrador existente y conserva las ediciones hechas mientras se transcribe.

Validación de estos gestos: 14 pruebas de conducta y 15 comprobaciones en Edge con dispositivo de audio sintético, en escritorio y pantalla táctil de 390 px. Cubren cancelación lateral, bloqueo superior, liberación, teclado, permiso demorado y ausencia de envío automático al chat. No se solicitó acceso al micrófono físico del usuario para esas pruebas.

Nueva conversación e historial están en el menú lateral. Herramientas reúne las funciones disponibles de atención, investigaciones y reportes; Ajustes conserva tema, estado de IA y aprendizaje. Cuenta mantiene identidad, instalación y salida. ERP, proyectos/calidad y administración conservan sus vistas y permisos.

Las fuentes y el detalle técnico quedan plegados. Dashboards, documentos pedidos y resúmenes de confirmación siguen visibles cuando corresponden. No se oculta información necesaria para confirmar una escritura ni se ejecutan operaciones desde el menú de diseño. Los valores históricos siguen identificados como históricos.

En móvil, Escape o el fondo cierran el menú y restauran el foco. El fondo queda inactivo mientras se usa el menú. Se respetan movimiento reducido, teclado y zonas seguras. Encabezado y compositor permanecen accesibles al leer respuestas largas.

Se conservaron los identificadores originales para mantener adjuntos, voz, accesos, memoria, investigaciones y confirmaciones. Los módulos están en la lista estática y el shell PWA v50; no se cachean sesiones ni datos comerciales.

Comprobaciones: cinco pruebas del menú/foco y estado de conversación; entrega HTTP de módulos; revisión visual de escritorio y 390 × 844; precio real con fuentes plegadas/desplegables y cero errores JavaScript. Usuarios/SQLite aislados y ERP de sólo lectura, sin confirmaciones ni escrituras. No acredita micrófono físico ni instalación en un teléfono.

El instalador nativo Windows es `Instalar-servicio.bat`. Su alcance y migración desde la tarea anterior están en [inicio automático](inicio-automatico.md). Compilar y probar el BAT no significa instalar SCM ni reiniciar esta PC.
