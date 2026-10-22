# Chat de trabajo y navegación

La PWA concentra el trabajo en una conversación: mensajes propios a la derecha, respuestas legibles y compositor persistente con adjunto opcional, dictado y envío. Enter envía; Shift+Enter agrega una línea. Una composición de teclado en curso no se envía por error. Escribir el próximo mensaje mientras llega la respuesta no borra ese borrador.

Nueva conversación e historial están en el menú lateral. Herramientas reúne las funciones disponibles de atención, investigaciones y reportes; Ajustes conserva tema, estado de IA y aprendizaje. Cuenta mantiene identidad, instalación y salida. ERP, proyectos/calidad y administración conservan sus vistas y permisos.

Las fuentes y el detalle técnico quedan plegados. Dashboards, documentos pedidos y resúmenes de confirmación siguen visibles cuando corresponden. No se oculta información necesaria para confirmar una escritura ni se ejecutan operaciones desde el menú de diseño. Los valores históricos siguen identificados como históricos.

En móvil, Escape o el fondo cierran el menú y restauran el foco. El fondo queda inactivo mientras se usa el menú. Se respetan movimiento reducido, teclado y zonas seguras. Encabezado y compositor permanecen accesibles al leer respuestas largas.

Se conservaron los identificadores originales para mantener adjuntos, voz, accesos, memoria, investigaciones y confirmaciones. Los módulos están en la lista estática y el shell PWA v50; no se cachean sesiones ni datos comerciales.

Comprobaciones: cinco pruebas del menú/foco y estado de conversación; entrega HTTP de módulos; revisión visual de escritorio y 390 × 844; precio real con fuentes plegadas/desplegables y cero errores JavaScript. Usuarios/SQLite aislados y ERP de sólo lectura, sin confirmaciones ni escrituras. No acredita micrófono físico ni instalación en un teléfono.

El instalador nativo Windows es `Instalar-servicio.bat`. Su alcance y migración desde la tarea anterior están en [inicio automático](inicio-automatico.md). Compilar y probar el BAT no significa instalar SCM ni reiniciar esta PC.
