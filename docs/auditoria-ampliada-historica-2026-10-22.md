# Auditoría ampliada de lecturas e históricos — 22/10/2026

Se ejecutó `scripts/audit-expanded-historical.js --live` contra la filial ya autorizada, con cero escrituras ERP. No se abrió Store, no se prepararon propuestas y no se iniciaron servicios, tareas de fondo ni ejecutores. El adaptador fuerza escritura ERP/local y escalamiento a false. El resultado es `bounded_reads_completed / partial_requires_review`, con diferencias históricas pendientes de revisión; no es una aprobación productiva ni una corrección automática.

## Alcance reproducible

```powershell
# VALIDATION_BRANCH debe pertenecer explícitamente a ERP_BRANCHES.
node --env-file=.env scripts/audit-expanded-historical.js --live
node --test test/expanded-historical-audit.test.js test/integration-validation.test.js
```

Usa `createErp` y sus recursos existentes. Recorre hasta dos páginas de 25 filas por recurso/ventana, orden reciente. Ventanas: 2020–2023, 2024, 2025 y 01/01/2026–22/10/2026. SC1 y SC7 añaden una consulta sin filtro de fechas, también acotada. El máximo es 72 llamadas al adaptador; esta ejecución realizó 32. La inicialización y los enriquecimientos internos del adaptador realizan sus propias lecturas de metadatos, diccionarios y referencias; 32 no representa el número total de sentencias SQL. Un presupuesto separado añade dos diagnósticos SELECT agregados, uno por SC1/SC7, con hasta 501 filas activas y 501 borradas de la filial física autorizada y sin fechas.

Los recursos históricos son SC6 (`C6_ENTREG`, fecha prevista), SD2 (`D2_EMISSAO`) y entradas SD1 (`D1_DTDIGIT`, fecha de registro). **La fecha prevista de SC6 no acredita cuándo se creó ni modificó el registro.** Las ventanas 2020–2025 no devolvieron filas para esos filtros; esto no demuestra ausencia global de datos antiguos ni registros con fechas vacías, inválidas o fuera del intervalo.

Los informes contienen exclusivamente metadatos, conteos y estados. No guardan filas, productos, clientes/proveedores, documentos, importes, secretos, SQL ni errores del controlador. Quedan en `data/validation`, ignorado por Git. Informe final: `2026-10-22T13-53-37-907Z-expanded-historical-12adc61a.json`. Los informes previos se conservan como intentos de diagnóstico; el final usa la comparación SX3 de ambos valores y prioriza un origen SD2 verificado para consultar sus documentos.

## Por qué SC1 y SC7 devolvieron cero

Los recursos generales, sin filtros de fechas/producto/tercero/estado, devolvieron cero filas activas. Se verificaron tablas físicas configuradas, columnas de filial/borrado/RECNO y SX2 E/E/E. El diagnóstico parametrizado independiente obtuvo **0 activas y 0 borradas en la filial física autorizada**, para ambas tablas y todas las fechas. El cero no se explica por la primera página de una fila ni por un filtro de pendientes: no se encontraron registros en ese alcance físico.

La correspondencia de filial se conservó exactamente según el mapeo verificado. No se consultaron datos de otras filiales/empresas ni se sustituyó la tabla configurada por una tabla histórica no autorizada. El catálogo inspecciona estructura, no prueba que no existan otros orígenes. La validación comercial de SC1/SC7 y sus circuitos sigue pendiente por falta de registros reales en este origen/filial.

SD1 devolvió 50 ítems reales, todos con UM UN resuelta por su producto enlazado. Ninguno de esos 50 tenía todas las claves para el contraste exacto pedido/ítem/producto/proveedor/tienda con SC7. Esto amplía la evidencia de compras documentadas, pero no valida un pedido de compra ni demuestra ausencia de vínculos fuera de la muestra. La ventana reciente devolvió fechas de registro entre 15/10 y 22/10, con `hasMore=true`.

## Cantidades en millares y precisión

Se verificaron campos físicos `float`: `C6_QTDVEN` y `D2_QUANT`, ambos con dos decimales SX3; `C6_MILLAR` con seis y `D2_MILLAR` con cuatro. Se compara primero con Decimal la cantidad/1000 y el MILLAR almacenado. Si difieren literalmente, **ambos** valores se redondean HALF_UP a la precisión SX3 de MILLAR para distinguir coincidencias a esa precisión de diferencias persistentes. El valor original no se modifica. No se interpreta MILLAR como precio ni se inventa C7_MILLAR.

Sólo UM UN entra en esa comparación. SC6 conserva la UM propia; SD2 utiliza la UM del producto SB1 enlazado por el adaptador existente. Otras UM se excluyen y una UM no encontrada queda pendiente; no se presupone UN.

| Muestra 2026 | Filas UN | Coincidencia decimal exacta | Coincidencia a SX3 | Diferencia persistente, MILLAR cero | Diferencia persistente, MILLAR no cero |
|---|---:|---:|---:|---:|---:|
| SC6, entrega prevista 12/10–21/10 | 50 | 9 | 26 | 15 | 0 |
| SD2, emisión 16/10–22/10 | 50 | 14 | 24 | 12 | 0 |

Ambas muestras tienen `hasMore=true`; no son un censo ni una estimación representativa de todo 2026. SC6 contiene 36 ítems con saldo técnico positivo y 14 sin saldo positivo; 15 muestran referencia documental y ninguno muestra código de bloqueo no vacío en el contrato leído. Estas categorías describen campos observados, sin certificar estado comercial o entrega física. Los registros restantes del año no fueron recorridos.

Se mantienen las anomalías de MILLAR cero con cantidad UN positiva, aun a precisión SX3. Las coincidencias a SX3 no son diferencias persistentes según este control. No se atribuye causa, antigüedad del defecto ni alcance fuera de la muestra; no se corrigió cantidad, precio, total ni MILLAR.

## Vínculos documentales exactos

Entre 50 SD2 hubo uno con pedido/ítem/producto/cliente/tienda de origen completos. La consulta exacta devolvió un SC6 único con identidad coincidente, sin más páginas. Ambos tienen MILLAR cero y diferencia persistente al compararlos individualmente con su propia cantidad/1000. Ese SC6 vinculado se informa separado de la muestra principal de 50 SC6 para no duplicarlo ni atribuirle el mismo intervalo de fechas.

Para ese pedido verificado, `documentosPedidoVenta` devolvió un remito y una factura en consultas separadas. Se conservaron los filtros exactos de filial/pedido/cliente/tienda y el contrato existente de vínculos directos o vía remito, que exige referencias documentales inequívocas. Otros dos pedidos muestreados devolvieron cero documentos. No se sumaron remito y factura como movimientos independientes ni se igualó la cantidad de un documento individual con toda la cantidad del pedido. Tampoco se acredita entrega física ni facturación universal.

## Pruebas controladas y límites

El módulo independiente no modifica el validador anterior. Las pruebas verifican bloqueo de adaptador escritor antes de consultar, límites/páginas, ausencia de filas, aislamiento de filial, errores saneados, precisión/UM, enlaces exactos correctos/incorrectos y selección de documentos desde un origen verificado. La ejecución combinada pasó 19/19 pruebas. Son contratos con dobles, no escrituras reales ni evidencia de rollback, aprobación, alta en dólares o recuperación transaccional.
