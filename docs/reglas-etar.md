# Reglas de operación ETAR

Indicaciones del dueño del 19/10/2026. Son contexto permanente de este proyecto y del chat.

## Productos y clientes

Los productos terminados de ETAR comienzan con `Z`. El vínculo comercial se resuelve mediante la lista de precios: `SA1.A1_TABELA` identifica la lista del cliente y `DA1_CODTAB` / `DA1_CODPRO` identifican sus precios de producto. La cabecera está en DA0. Conservar cliente, tienda, sucursal, moneda y vigencia. Un producto puede aparecer en varias listas; el prefijo Z por sí solo no identifica un cliente.

## Millares y unidades

La operación comercial se expresa habitualmente en millares, mientras que TOTVS almacena las cantidades en unidades:

- unidades = millares × 1000;
- millares = unidades ÷ 1000;
- precio por millar = precio por unidad × 1000;
- precio por unidad = precio por millar ÷ 1000;
- total base = unidades × precio por unidad = millares × precio por millar.

Ejemplo: 2,5 millares a 80 por millar son 2500 unidades a 0,08 por unidad, total base 200. No multiplicar a la vez cantidad y precio por 1000. Conservar moneda y precisión SX3; no redondear silenciosamente un precio para que entre en el campo.

La conversión comercial de precios se muestra para terminados Z cuya unidad SB1 es UN. Para otras unidades no se supone que un millar represente kilogramos, metros u otra medida. Antes de modificar un valor ambiguo hay que resolver su base (unidad o millar).

Se verificaron en SX3 `C6_MILLAR` (6 decimales) y `D2_MILLAR` (4 decimales), titulados “Cant. Millar”. No se encontró `C7_MILLAR` en esa consulta; no se inventa un campo equivalente. Ambos campos verificados se exponen como opcionales en las lecturas. Los disparadores de formulario de Protheus no son triggers SQL: actualizar directamente MILLAR no garantiza que se actualicen cantidad, precio, total ni campos relacionados.

## Actualizaciones e informes que deben conservarse en el alcance

| Operación | Campos de referencia | Estado de esta versión |
|---|---|---|
| Lista de clientes | DA1_PRCVEN + DA1_PRCMIL; cliente por A1_TABELA | Lectura, propuesta y UPDATE confirmado |
| Lista de proveedores | AIB_PRCCOM, proveedor/tienda/lista/producto | Lectura, propuesta y UPDATE confirmado |
| Pedido de venta | C6_PRCVEN, C6_QTDVEN, C6_VALOR, C6_MILLAR | UPDATE de ítems simples sin dependencias; sincroniza C6_MILLAR y C6_PRUNIT cuando corresponde |
| Pedido de compra | C7_PRECO, C7_QUANT, C7_TOTAL | UPDATE de ítems simples; SC7 sin filas reales en la verificación actual |
| Informes de saldos | Pedido menos atendido, con alcance y unidad explícitos | Lectura paginada; no afirmar que una página es un informe global |

El usuario autorizó implementar UPDATE sobre registros existentes. DA1, AIB, SC6 y SC7 tienen ejecución transaccional con confirmación explícita y permiso writer. No hay INSERT, DELETE, altas automáticas ni actualización de remitos SD2. El chat y el dictado preparan propuestas; sólo la tarjeta/API de ejecución puede confirmarlas. Las propuestas de contactos SA1/SA2 siguen sin ejecutor.

El ejecutor relee y bloquea la fila y sus dependencias, comprueba la huella previa, actualiza una única fila y verifica los valores antes de confirmar la transacción. Los pedidos con cantidades atendidas, liberaciones, documentos, descuentos, segunda unidad o condiciones fiscales/comerciales dependientes se rechazan. El total no es un importe libre: debe coincidir con precio × cantidad redondeado a SX3.

Ver [contrato de actualizaciones](actualizaciones.md) para campos, permisos, límites y resultados inciertos. No se modificaron registros comerciales durante las pruebas de implementación.
