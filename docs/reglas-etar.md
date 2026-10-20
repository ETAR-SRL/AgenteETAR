# Reglas de operación ETAR

Indicaciones del dueño del 19/10/2026. Son contexto permanente de este proyecto y del chat.

## Productos y clientes

Las altas y modificaciones se solicitan desde el chat por texto o voz, con revisión y confirmación en la conversación. No mantener una pantalla separada de formularios de Actualizaciones. Verificar el producto en SB1 y el pedido/ítem existente; distinguir expresamente un documento nuevo desde cero de una modificación.

Las solicitudes nuevas de un ítem con código explícito tienen una preparación conversacional directa: relectura exacta de SB1 en cada turno, descripción/tipo/UM de la fuente, datos pendientes conservados por conversación y sucursal y propuesta final con confirmación. El depósito de SB1 es una sugerencia, no se elige automáticamente. Códigos de un carácter son válidos; no se agregan ceros ni se transforman en productos Z. El recorrido directo evita llamadas al modelo; los pedidos más complejos conservan las herramientas de IA.

Los productos terminados de ETAR comienzan con `Z`. El vínculo comercial se resuelve mediante la lista de precios: `SA1.A1_TABELA` identifica la lista del cliente y `DA1_CODTAB` / `DA1_CODPRO` identifican sus precios de producto. La cabecera está en DA0. Conservar cliente, tienda, sucursal, moneda y vigencia. Un producto puede aparecer en varias listas; el prefijo Z por sí solo no identifica un cliente.

## Millares y unidades

La operación comercial se expresa habitualmente en millares, mientras que TOTVS almacena las cantidades en unidades:

- unidades = millares × 1000;
- millares = unidades ÷ 1000;
- precio por millar = precio por unidad × 1000;
- precio por unidad = precio por millar ÷ 1000;
- total base = unidades × precio por unidad = millares × precio por millar.

Ejemplo: 2,5 millares a 80 por millar son 2500 unidades a 0,08 por unidad, total base 200. No multiplicar a la vez cantidad y precio por 1000. Conservar moneda y precisión SX3; no redondear silenciosamente un precio para que entre en el campo.

La conversión comercial de precios se muestra para terminados Z cuya unidad SB1 es UN. Para otras unidades no se supone que un millar represente kilogramos, metros u otra medida. Antes de modificar un valor ambiguo hay que resolver su base (unidad o millar). En propuestas conversacionales DA1 se conserva la base explícita del contexto; si no existe, un terminado Z en UN usa millar como interpretación comercial visible en la respuesta y en la tarjeta que debe confirmar el usuario. Para otras unidades se pregunta, sin convertirlas.

Se verificaron en SX3 `C6_MILLAR` (6 decimales) y `D2_MILLAR` (4 decimales), titulados “Cant. Millar”. No se encontró `C7_MILLAR` en esa consulta; no se inventa un campo equivalente. Ambos campos verificados se exponen como opcionales en las lecturas. Los disparadores de formulario de Protheus no son triggers SQL: actualizar directamente MILLAR no garantiza que se actualicen cantidad, precio, total ni campos relacionados.

## Actualizaciones e informes que deben conservarse en el alcance

| Operación | Campos de referencia | Estado de esta versión |
|---|---|---|
| Lista de clientes | DA1_PRCVEN + DA1_PRCMIL; cliente por A1_TABELA | Lectura, propuesta y UPDATE confirmado |
| Lista de proveedores | AIB_PRCCOM, proveedor/tienda/lista/producto | Lectura, propuesta y UPDATE confirmado |
| Pedido de venta | C6_PRCVEN, C6_QTDVEN, C6_VALOR, C6_MILLAR | UPDATE simple; en liberados/parciales sólo precio del saldo SC6 + SC9 pendiente elegible, conservando históricos y cantidades |
| Pedido de compra | C7_PRECO, C7_QUANT, C7_TOTAL | UPDATE de ítems simples; SC7 sin filas reales en la verificación actual |
| Informes de saldos | Pedido menos atendido, con alcance y unidad explícitos | Lectura paginada; no afirmar que una página es un informe global |

El usuario autorizó implementar UPDATE sobre registros existentes. DA1, AIB, SC1, SC6 y SC7 tienen ejecución transaccional con confirmación explícita y permiso writer. El dueño autorizó también crear solicitudes y pedidos nuevos. INSERT SC1/SC7 implementado por pedido explícito posterior: MAX(RECNO)+1 global y número automático bajo bloqueo exclusivo en transacción. Crea documentos independientes: SC7 en moneda local o dólares configurados en SX6 con cotización SM2; SC1 admite dólares como solicitud de importación (SI/MATA113) elegida explícitamente, con C1_PRECO y C1_MOEDA; la solicitud común conserva C1_VUNIT local. Ver [monedas en altas](monedas-altas.md). El estado se decide con SX6/SY1: L cuando se verificó que no requiere aprobación. Cuando corresponde, crea también el circuito SCR/DBM pendiente en la misma transacción: grupos, niveles y rangos de Protheus. Las altas B con circuito soportado se pueden confirmar. Configuración desconocida o variantes fuera del alcance siguen rechazándose con motivo específico; ver [alcance de aprobaciones SQL](aprobaciones-sql.md). Sin aprobación nativa ni vínculos a otra solicitud. No coordina reservas numéricas en memoria de DBAccess. No hay DELETE ni actualización de remitos SD2. El chat y el dictado preparan propuestas; sólo la tarjeta/API de ejecución puede confirmarlas. Las propuestas de contactos SA1/SA2 siguen sin ejecutor.

El ejecutor relee y bloquea la fila y sus dependencias, comprueba la huella previa, actualiza el ítem y las liberaciones pendientes incluidas en la propuesta y verifica los valores antes de confirmar la transacción. En ventas liberadas/parciales sólo admite precio; conserva SC9 documentada, SD2, cantidades y estados. El dueño autorizó después el reajuste directo SQL aun con crédito activo: conserva los estados y muestra que no revalida crédito ni recalcula sus saldos. Los bloqueos efectivos en SC9 y los parámetros desconocidos siguen rechazándose. Compras con recepciones/aprobaciones, descuentos, segunda unidad o condiciones fiscales/comerciales dependientes conservan sus restricciones. El total no es un importe libre: debe coincidir con precio × cantidad redondeado a SX3.

Ver [contrato de actualizaciones](actualizaciones.md) para campos, permisos, límites y resultados inciertos. No se modificaron registros comerciales durante las pruebas de implementación.

SC1: `solicitudCompra` actualiza precio estimado C1_VUNIT, cantidad C1_QUANT y total C1_TOTAL de ítems existentes sin atención/aprobación/vínculos. En el modo de ventas liberadas, segunda unidad se conserva completa al cambiar sólo precio.

Los ajustes porcentuales de listas DA1 recorren todas las páginas y verifican cada producto en SB1 y cada precio en DA1/DA0. Se excluyen de forma visible los registros inactivos o fuera de vigencia. El porcentaje se calcula sobre el precio actual redondeado a la precisión SX3, nunca sobre propuestas anteriores pendientes. Cualquier redondeo del nuevo precio a SX3 se muestra en el resumen. Se prepara una tarjeta por registro; cada confirmación es una transacción independiente, no una operación atómica de toda la lista. La precondición de precio, producto, lista y moneda se verifica de nuevo durante la preparación y ejecución.

## Conversación directa y resúmenes (20/10/2026)

Los códigos y nombres de productos, clientes y proveedores, las referencias de pedidos y listas y las aclaraciones de precio/cantidad se verifican por consultas directas antes de recurrir al modelo local. El contexto pertenece al usuario, conversación y sucursal; no es una fuente de precios actuales. Las propuestas releen productos y registros, separan bases de precio/cantidad y usan los ejecutores existentes. Las fichas de producto no tienen ejecutor; contactos conservan su ejecución deshabilitada. Las altas conversacionales directas SC1/SC7 cubren un ítem; los adjuntos mantienen su flujo existente.

El pedido general de dashboard/resumen de ventas o compras del mes actual consulta sin filtros de terceros o productos. Períodos y filtros adicionales continúan por las herramientas del modelo; sus valores de ejemplo como «código» se rechazan antes de consultar. El resumen visible es breve; los límites técnicos quedan en «Cómo se calculó». No se ejecutan cambios ERP durante las pruebas.
