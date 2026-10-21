# Atención y seguimiento operativo

Desde la navegación o el chat: «Mostrame qué necesita mi atención» y «Mostrame mis seguimientos». Cada tarjeta identifica documento/tercero o proyecto/productos relacionados, fecha, antigüedad, cantidades UN/millares, importes por moneda y última consulta. Se puede abrir el recorrido, seguir, posponer, descartar, volver a mostrar o pedir que reaparezca si cambia. No envía correos, mensajes ni notificaciones del navegador. No ejecuta operaciones comerciales.

## Fuentes e interpretación

- **Venta**: C6_QTDVEN − C6_QTDENT positivo, C6_ENTREG válida anterior al día de Buenos Aires y sin residuo R. Cabecera SC5 única para pedido/cliente/tienda y moneda guardada. No usa emisión como vencimiento.
- **Compra**: C7_QUANT − C7_QUJE positivo y C7_DATPRF válida vencida, sin residuo ni cierre. Unidad y moneda de SC7. No usa C7_EMISSAO como entrega.
- **Remito**: SD2 RFN/50/N con D2_QTDAFAT positivo y SF2 única por documento/serie/cliente/tienda/especie/tipo. Cantidades facturadas y devueltas se conservan separadas. La fecha es emisión del remito, explícitamente identificada como tal. El importe pendiente es cantidad pendiente × precio, sin impuestos/fletes; no se suma con facturas como una venta adicional.
- **KAIQEN**: referencia de proyecto o pieza a `erp_producto`, y relectura de código/sucursal en SB1. No usa semejanzas de nombres ni elimina dígitos de sucursal. Detecta fases con fin previsto vencido sin cierre real, NC abiertas (incluido EN_PROCESO del contrato) y problemas con estado abierto reconocido por catálogo. No recalcula semáforos ni supone que esos problemas causaron la demora. Si el contrato no permite comprobar un estado, no lo inventa.

Los cálculos y condiciones son estructurados; el modelo no genera SQL. Todos los campos y tipos se contrastan con el catálogo físico. Las cantidades en millares se calculan sólo para UN. Los precios históricos del pedido se distinguen de listas actuales. Una cantidad atendida o documentada no acredita recepción física.

Un aviso agrupa el documento completo, con su sucursal, serie y tercero/tienda; no duplica tarjetas por ítem o revisión. La clave es estable por usuario. La relectura exacta incluye todas sus filas dentro del límite, aunque ya no cumplan la condición de alerta. No se deduce resolución por desaparecer de una página o del escaneo. Un documento ausente, identidad inconsistente, fuente caída o lectura incompleta queda **sin verificar**, conservando la última lectura como histórica. Si desaparece un ítem original, no se acredita entrega completa de ese ítem.

## Seguimientos personales

- «Seguí este pedido hasta que se entregue»: verifica el documento del contexto y sigue hasta que el ERP registre toda la cantidad atendida. No promete confirmar recepción física.
- «Avisame cuando se facture el remito NÚMERO»: identifica también serie y tercero, preguntando sólo si hay más de una combinación. Sigue hasta la facturación completa registrada. Un cierre por devolución o cancelación queda **para revisar**, distinto de objetivo cumplido.
- «¿Qué cambió desde que lo empezamos a seguir?»: relee el documento y muestra eventos posteriores al inicio, hasta cincuenta recientes. No reutiliza un importe anterior como valor actual.
- «Posponelo hasta mañana», «No me avises de nuevo hasta el lunes», «Esto no me interesa», «Volvé a mostrarlo si cambia», «Volvé a mostrarlo», «Dejá de seguir este pedido».

Las posposiciones por día terminan a las 08:00 de Buenos Aires. Posponer sólo oculta el aviso; no detiene la revisión. Descartar y dejar de seguir son decisiones diferentes. Los objetivos cumplidos generan una novedad dentro de la bandeja hasta marcarla como vista; no desaparecen silenciosamente. La recuperación de una fuente sin cambios de negocio no reactiva por sí sola un aviso descartado «hasta que cambie».

## Investigación y cambios propuestos

«Ver recorrido», «¿Qué pasó?» o «¿Por qué está atrasado?» separan hechos comprobados, posibles causas e información no disponible, con detalle desplegable. Reutiliza los recorridos de venta y proveedor; los datos generales del proveedor pueden abarcar otros pedidos y se aclara expresamente. Entradas SD1 sólo se relacionan por pedido, ítem y producto. El remito puede abrir el recorrido de venta cuando SD2/SC6 verifican el vínculo completo, sin afirmar que toda factura del pedido corresponde a ese remito.

«Prepará el cambio» exige el permiso de preparación y continúa con el circuito existente; pregunta qué ítem, valor y base falta. No agrega operaciones ni acepta SQL libre. La ejecución mantiene confirmación explícita, revisión de permisos y huellas transaccionales. Para propuestas SC6/SC7 originadas en un aviso, si cambian los valores antes de confirmar se prepara un nuevo resumen, se invalida el anterior y se exige otra confirmación. Conserva el valor absoluto solicitado y la identidad/moneda; para recalcular porcentajes debe pedirse el ajuste nuevamente. Resultados ejecutados, en ejecución o inciertos nunca se renuevan ni reenvían automáticamente.

## Servicio, carga y recuperación

`ATTENTION_ENABLED=true` y `ATTENTION_POLL_MS=300000` por defecto; intervalo permitido de 30 segundos a un día. El servidor Windows inicia y detiene el revisor junto a la app, sin depender del navegador. Revisa hasta cinco usuarios por ciclo, rotando de forma persistente; por usuario/sucursal lee una tanda de cien candidatos por fuente y hasta cinco documentos nuevos, además de hasta cinco seguimientos prioritarios y cinco avisos existentes. Si hay más, rota según la última revisión. Un objetivo vuelve a quedar pendiente si una relectura comprueba que se reabrió el documento. El cursor avanza por RECNO: no deja permanentemente afuera los documentos posteriores. KAIQEN avanza de a cinco proyectos, con hasta veinte vínculos de producto por proyecto. El documento exacto tiene un límite de quinientos ítems; excederlo nunca permite declararlo resuelto. Los recorridos existentes conservan sus propios límites.

La bandeja se completa **por tandas**: no promete ser un censo instantáneo. «Revisar ahora» encola una revisión y vuelve enseguida. La consulta de tarjetas es local y rápida; abrir/investigar relee las fuentes. El estado muestra última revisión y disponibilidad por área. Fallos de documentos/fuentes usan esperas crecientes de 30 segundos a una hora. La revisión periódica respeta esas esperas; una consulta explícita puede volver a intentar.

SQLite/WAL conserva avisos, preferencias, objetivos, eventos, cursores y novedades vistas en tablas `op_*` dentro de `DATA_DIR/agent.sqlite`, excluido de Git. Una promesa por proceso y un préstamo durable de cinco minutos evitan revisiones simultáneas entre procesos; se renueva durante la ejecución. Tras una caída, un préstamo abandonado vence antes de retomar. Las claves únicas evitan tarjetas duplicadas y no se generan eventos de cambio si los datos siguen iguales. En un reinicio puede haber espera por el supervisor de Windows y por un préstamo anterior aún vigente.

## Autorización y límites

Las rutas `/api/attention` requieren usuario personal; las claves globales de servicio no tienen bandejas personales. Se usa el ID estable de usuario, separado de su revisión de rol, para persistir preferencias entre conversaciones y cambios de permisos. Cada consulta, tarjeta, evento, acción e investigación vuelve a comprobar permisos actuales y sucursal. Revocar un área oculta los avisos y eventos correspondientes; no otorga permisos nuevos. El proceso de fondo ejecuta cada lectura en el contexto del usuario actual, no como un administrador global. La PWA revisa permisos en sus consultas periódicas y al recuperar foco; ante cambio de revisión limpia los datos y recarga el ingreso vigente. Los datos comerciales no se guardan en el caché offline.

`atencionVentas` y `atencionRemitos` requieren ventas/clientes/preciosVenta/catalogo; `atencionCompras` requiere compras/proveedores/preciosCompra/catalogo. KAIQEN requiere proyectos/calidad/catalogo. La investigación agrega únicamente secciones accesibles. No reproduce permisos individuales de KAIQEN distintos del contrato del conector configurado; conserva la planta y la autorización local existentes. No reconstruye estados históricos del ERP ni confirma logística física sin un conector de recepción.

## Comprobaciones

Las pruebas controladas cubren detección de compras vencidas, cambios de cantidades, facturación completa frente a devolución, posposición/cancelación, preferencias, reapertura, lecturas incompletas, ausencia de duplicados, avance de cursores, concurrencia/préstamos, persistencia en archivo tras abrir otro proceso, aislamiento por usuario, revocación, ERP/KAIQEN caídos y resúmenes de propuestas con reconfirmación. No alteran documentos comerciales.

Las lecturas reales del 21/10/2026 encontraron pedidos de venta vencidos, remitos con saldo y problemas de proyectos KAIQEN con vínculo de producto verificado. No se encontró compra pendiente vencida en la consulta real: ese caso se comprobó con datos controlados. Se verificó además una compra vencida con un SELECT de filas controladas en SQL Server, excluyendo entrega futura, atención completa y cierre, sin crear tablas ni modificar registros. Un seguimiento real conservó su ID, objetivo y posposición después de reiniciar el servicio. Los informes y capturas de verificación quedan en `data/`, fuera del repositorio.
