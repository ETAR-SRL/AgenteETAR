# Actualizaciones reales de registros existentes

Implementación del 19/10/2026. La API y la PWA ejecutan UPDATE parametrizados sobre una única fila activa, después de preparar y confirmar una propuesta. No crean registros ni ejecutan SQL generado por el modelo. El alcance es una empresa/base configurada y sus sucursales autorizadas.

## Campos y conversiones

| Acción | Tabla | Campos actualizados |
|---|---|---|
| `precioLista` | DA1 | `DA1_PRCVEN`, y `DA1_PRCMIL` cuando existe y el producto es UN |
| `precioListaProveedor` | AIB | `AIB_PRCCOM` |
| `pedidoVenta` | SC6 | `C6_PRCVEN`, `C6_QTDVEN`, `C6_VALOR`, `C6_MILLAR`; sincroniza `C6_PRUNIT` al cambiar precio sólo si era igual al precio neto |
| `pedidoCompra` | SC7 | `C7_PRECO`, `C7_QUANT`, `C7_TOTAL`; sólo usaría `C7_MILLAR` si existiera y estuviera definido en SX3 |

Sólo se incluyen en el SET los campos con diferencias. No se modifica moneda, clave, vigencia, cliente/proveedor, estado, borrado lógico ni RECNO. Los triggers STAMP existentes pueden cambiar `S_T_A_M_P_`; cualquier otro cambio inesperado de la fila causa rollback. Se contrastan las definiciones de triggers habilitados con hashes inspeccionados en esta instalación. Un trigger nuevo o modificado bloquea la operación hasta su revisión.

Para UN: 1 millar = 1000 unidades; precio por unidad = precio por millar ÷ 1000. Ejemplo: 2,5 millares a 80 por millar → 2500 unidades × 0,08 = 200. Los precios y cantidades deben caber exactamente en SX3; sólo el total se redondea HALF_UP a los decimales del campo. El total enviado es una comprobación, no un importe independiente. Unidades diferentes de UN no admiten conversión a millares. `D2_MILLAR` no se actualiza: corresponde a documentos emitidos.

Los productos Z se vinculan a sus clientes mediante `SA1.A1_TABELA` y DA0/DA1. Un cambio de lista no cambia automáticamente pedidos existentes, ni actualiza otras listas. La propuesta identifica lista, producto, ítem, proveedor/tienda o pedido según la operación, y conserva los códigos de moneda del ERP.

## Límites de pedidos

Se aceptan ítems simples sin cantidades atendidas, liberadas, reservadas o comprometidas, sin documentos SD1/SD2, sin liberaciones SC9, sin descuentos ni cantidades en segunda unidad. Se rechazan bloqueos, aprobaciones/estados no vacíos, vínculos de fabricación/compra/contratos y los importes fiscales/accesorios detectados por la política. En ventas se valida y bloquea también SC5, incluidos descuentos, aumentos financieros, flete, seguro y gastos.

El total original debe coincidir con cantidad × precio a precisión SX3. Los casos rechazados requieren el circuito Protheus; este ejecutor no reproduce las validaciones ADVPL, recalcula impuestos ni vuelve a liberar/aprobar pedidos. Los campos y reglas locales se verificaron por SELECT; no se homologa aquí el circuito fiscal completo de Argentina. Contactos SA1/SA2 y cotizaciones no tienen ejecución en esta versión.

SC7 y SC9 se configuraron con filial `0101` por SX2 exclusivo E/E/E. SC7 no contenía filas en la verificación: el código de compras está probado con dobles, pendiente de contrastar con un pedido real autorizado. No se inventa C7_MILLAR, ausente en este esquema. En DA1 la filial física es `01`; cada alias resuelve su propia filial y no hereda la de otro.

## Activación y uso

`.env` local, nunca versionado:

```dotenv
ERP_WRITE_ENABLED=true
LOCAL_WRITE_ENABLED=true
API_WRITE_KEY=<secreto distinto de READ y PLAN, mínimo 32 caracteres>
```

Los defaults de `.env.example` están deshabilitados. El usuario SQL debe poder SELECT, consultar metadatos/definiciones y UPDATE las cuatro tablas; el agente no otorga permisos. El pool de escritura se abre sólo al ejecutar. La PWA habilita operador únicamente con ambos flags, en loopback y mismo origen, mediante cookie HttpOnly/SameSite=Strict. Esto autoriza al usuario local de este equipo, no constituye autenticación multiusuario de red. No exponer la PWA de operador por un proxy público.

En **Actualizaciones**, ingresar un RECNO existente obtenido en Explorar ERP, seleccionar la base de precio/cantidad, preparar y revisar. En el chat puede pedirse por texto o dictado: el modelo busca el registro y prepara una tarjeta; ante identidad/base ambiguas debe solicitar aclaración. El ejecutor no está disponible como herramienta del modelo. La confirmación final es un botón explícito de la tarjeta.

API: usar la misma clave writer para crear, confirmar y consultar la propuesta. La clave planner sólo prepara/comprueba sus propias propuestas, nunca ejecuta; la reader sólo lee. Los valores son texto decimal con punto, sin separadores de miles.

```json
{
  "action": "pedidoVenta",
  "target": {"sucursal": "0101", "registro": "RECNO_EXISTENTE"},
  "changes": {"precioUnitario": "80", "cantidadPedida": "2.5", "total": "200.00"},
  "priceUnit": "millar",
  "quantityUnit": "millares"
}
```

1. `POST /api/changes/preview`: recibe ese objeto, lee el origen y devuelve `id`, `fingerprint`, identidad, diferencias y cálculo. Vence en 15 minutos. No escribe en ERP.
2. Opcional: `POST /api/changes/{id}/check`, que detecta cambios sin bloquear.
3. `POST /api/changes/{id}/execute` con `{"confirm":true,"fingerprint":"HUELLA_RECIBIDA"}`. La huella debe coincidir exactamente. No existe ejecución masiva implícita.
4. `GET /api/changes/{id}`: devuelve propuesta y estado/recibo de ejecución de ese actor.

## Transacción y fallos

SQLite registra la intención antes de tocar ERP. SQL Server comienza una transacción SERIALIZABLE, con XACT_ABORT y timeout de bloqueos. Relee la fila y dependencias con UPDLOCK/HOLDLOCK, compara la huella (incluye producto, cabecera, triggers y ámbito), recalcula valores y verifica que sean los confirmados. Ejecuta un UPDATE filtrado por filial, RECNO y borrado lógico, exige exactamente una fila afectada y verifica los valores mediante SELECT antes del COMMIT. No añade tablas ni triggers en el ERP. El OUTPUT usa una variable de tabla transitoria compatible con triggers STAMP.

`executed` conserva un recibo que se devuelve sin otro UPDATE ante reenvío del mismo ID. `failed` requiere corregir el problema y preparar otra propuesta. `executing` no admite reenvío. `unknown` indica que no se pudo confirmar COMMIT/rollback o que el proceso terminó durante una ejecución. No existe transacción distribuida entre SQLite y SQL Server: si se pierde la respuesta o falla el guardado del recibo después del COMMIT, no se adivina éxito/fracaso ni se reintenta. Se consulta el estado y se compara el registro en Protheus antes de emitir otra propuesta. Los registros `executing` heredados al reiniciar se convierten en `unknown`.

Referencias técnicas: [bloqueos y aislamiento SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-ver17), [UPDLOCK/HOLDLOCK](https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-table?view=sql-server-ver15), [xFilial](https://tdn.totvs.com/pages/viewpage.action?pageId=27675626).

## Verificación

`npm test`: 74 pruebas aprobadas. Incluye actualizaciones de las cuatro tablas con dobles transaccionales, conversiones, precisiones, totales, rollback, concurrencia, aislamiento de actores, idempotencia, pérdida de COMMIT y recuperación tras reinicio. El chat se prueba preparando sin ejecutar y HTTP con permisos separados.

`node --env-file=.env scripts/check-writes-readonly.js` lee datos reales y prepara propuestas sin guardarlas ni ejecutarlas. DA1 y AIB prepararon correctamente; los tres pedidos de venta históricos muestreados se rechazaron por dependencias; SC7 no tenía registros. No se ejecutó ningún UPDATE comercial como prueba. También se comprobó por SELECT el permiso UPDATE de las cuatro tablas y una transacción real sin DML mediante el pool de escritura. Esto verifica conectividad, metadatos y preparación, no acredita una modificación real ni sus efectos en pantallas/reportes Protheus.

Prueba HTTP con el modelo local real: una petición de cambio de precio por millar resolvió producto y lista vigente, y guardó una propuesta revisable en tres pasos. No se ejecutó. Las filas inactivas del mismo producto no se confunden con la única alternativa vigente; varias alternativas vigentes requieren identificar la lista o el cliente.
