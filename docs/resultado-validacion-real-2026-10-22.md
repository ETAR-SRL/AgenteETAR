# Resultado de validación real — 22/10/2026

Se completó una validación de lectura contra ERP y KAIQEN con la conectividad existente. La filial se eligió únicamente porque `ERP_BRANCHES` contenía una sola filial autorizada. La muestra comercial fue de una fila por recurso, sin recorrer páginas. Para comprobar unicidad de SC5, cliente y SC6 se admitieron hasta dos filas, con los filtros exactos del recurso.

El resultado global permanece **failed / partial_requires_review**: la conexión funciona y se observaron contratos reales, pero hay dos diferencias de cantidades almacenadas que no se corrigieron ni se ocultaron. Se ejecutaron cero escrituras comerciales; no se abrió Store, no se prepararon propuestas y no se iniciaron servidores ni planificadores.

## Evidencia que pasó

- ERP y KAIQEN disponibles. Se leyeron productos, clientes, cabeceras de listas, precios de clientes/proveedores, SC5/SC6, documentos de salida, ítems SD2 y remitos emitidos.
- Bandejas reales de ventas vencidas y remitos pendientes: saldo positivo, unidad/moneda, identidad, vigencia, semántica de fecha y snapshot de muestra correctos. La fecha de venta corresponde a C6_ENTREG; la de remito a D2_EMISSAO.
- De un SC6 vencido se verificaron cabecera SC5 única, cliente/tienda exactos y SC6 único. SA1 utiliza la filial física compartida declarada en `sucursalesConfiguradas`; el filtro conserva siempre la filial solicitada y el adaptador existente resuelve su correspondencia.
- Un remito emitido quedó vinculado con sus ítems por documento y serie. Un precio DA1 quedó vinculado con SB1 por código exacto.
- KAIQEN: proyectos y, para el proyecto explícitamente configurado en el entorno local, proyecto/calidad/vínculo. El informe no conserva contenido de esas respuestas.

## Diferencias reales que requieren revisión

| Control | Hallazgo de la muestra | Resultado |
|---|---|---|
| C6_MILLAR | Cantidad positiva en UN y MILLAR almacenado en cero; no coincide con cantidad/1000, aun a seis decimales SX3 | failed |
| D2_MILLAR | Cantidad positiva, UM UN comprobada en producto enlazado y MILLAR almacenado en cero; no coincide con cantidad/1000, aun a cuatro decimales SX3 | failed |

No es una diferencia causada por asumir kilogramos u otra UM como millares, ni se resuelve redondeando a la precisión del diccionario. Es evidencia puntual de inconsistencia en registros existentes; no establece su causa, antigüedad ni extensión al resto de la base. No se modificó cantidad, precio, total ni MILLAR.

El validador ahora excluye otras unidades, deja pendiente una UM desconocida y distingue coincidencias por precisión SX3 de diferencias persistentes. MILLAR se sigue tratando como cantidad, nunca como precio.

## Evidencia pendiente

- SC7, SC1, bandeja de compras y exposición SC7 pendiente devolvieron cero filas. No hubo datos reales para aprobar esos contratos comerciales.
- El primer cliente muestreado tiene A1_TABELA vacío. El alias real es `listaPreciosCodigo`; el campo es opcional y su vacío no es un incumplimiento del contrato. La relación SA1→DA1→DA0 queda pendiente para esa muestra.
- La muestra general SC6→SD2 no devolvió coincidencias. El ítem SD2 general tampoco aportó pedido/ítem de origen.
- Para el SC6 vencido seleccionado se consultaron SC9 y `documentosPedidoVenta` con cliente/tienda y filial exactos, separando remitos/facturas; devolvieron cero filas. Se conservan pendientes, sin afirmar ausencia universal de liberaciones o documentos.
- El remito pendiente de la bandeja no quedó vinculado a una factura en este diagnóstico. Una página vacía de documentos de otro pedido no resuelve ese pendiente.
- No se validaron ejecución/rollback, aprobaciones, altas SC1 en dólares, todas las monedas/filiales ni el corpus completo. Los controles de moneda preservan el valor, sin homologar códigos ni cotizaciones.

## Presupuesto y reproducibilidad

Se intentaron cuatro lecturas operativas adicionales y seis lecturas para un solo pedido vencido. El segundo presupuesto comprende SC5, SA1, SC6, SC9, remitos vinculados y facturas vinculadas. No se agregó SQL ni se inventaron filtros. Se usaron exclusivamente `createErp` y las interfaces existentes con escritura ERP/local y escalamiento automático forzados a false.

El informe final saneado está en el directorio local ignorado `data/validation/2026-10-22T12-42-18-596Z-live-3a9f65e1.json`. Contiene conteos, estados y metadatos de esquema, sin filas, identidades comerciales, importes ni credenciales. El informe inicial de esta ampliación quedó conservado por trazabilidad; el final corrige el falso incumplimiento de filial SA1 al aplicar la configuración explícita de tabla compartida.

Validación del paquete: `node --test test/integration-validation.test.js` pasó **13/13**. Cubre contratos reales de filtros, muestras parciales/vacías, cabeceras ambiguas, aislamiento cliente/tienda/filial, SA1 compartida, precisión SX3, otras UM y persistencia de anomalías históricas. `git diff --check` no informó problemas de espacios. Las pruebas controladas no sustituyen la evidencia comercial real.
