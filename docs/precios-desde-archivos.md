# Precios desde Excel, fotos y PDF

En el chat, el botón **＋** junto al mensaje abre el menú de adjuntos. Elegir lista de proveedor (AIB) o cliente (DA1) y adjuntar un archivo XLSX, XLS, PDF, PNG, JPG o WebP. No hay controles de archivo ni selector de destino permanentes, ni una pantalla independiente de actualizaciones.

1. Elegir el archivo y revisar la lectura que aparece como un adjunto en el chat. Sólo se piden proveedor/cliente, moneda o base cuando faltan. **Corregir lectura o completar datos** despliega los campos detallados, sin mostrarlos permanentemente. Se conserva la lectura original de cada fila para comparar.
2. Indicar proveedor/cliente y, si hay más de una opción, tienda o lista. Si existen varias fechas o tramos, la verificación ofrece los registros ERP de esa fila para elegir explícitamente y volver a preparar. La moneda y base por fila prevalecen sobre los valores por defecto. Usar importes sin separadores de miles.
3. Elegir **Preparar resumen**. La aplicación relee SB1 y AIB/DA1. Para códigos propios de proveedores busca la relación exacta en SA5; para clientes exige la lista de SA1.A1_TABELA.
4. Revisar el resumen completo: producto, lista, precio anterior y nuevo en la misma base, moneda, unidad ERP y origen. Debajo se muestran las filas con errores, que quedan excluidas.
5. Marcar la confirmación del resumen y elegir **Confirmar y actualizar N precios**. Un solo botón aplica todos los precios válidos revisados. Adjuntar, corregir y preparar no modifican el ERP; no se crean productos ni precios ausentes.

La confirmación identifica un lote inmutable y su huella, con las filas válidas y los errores que se mostraron. Editar la revisión deshabilita la confirmación anterior; preparar de nuevo reemplaza el lote pendiente. El resumen vence cuando vence su primera propuesta (normalmente 15 minutos).

Antes de la primera escritura se revalidan todas las propuestas. Si alguna cambió, venció o perdió autorización, no se empieza la actualización. Cada precio se ejecuta en una transacción independiente con los controles existentes de precisión, moneda y concurrencia. **No es una transacción única de toda la lista**: un fallo posterior detiene el resto y conserva los precios ya aplicados. El resultado distingue aplicados, fallidos, inciertos y pendientes. Los errores del archivo no forman parte de la ejecución.

**Consultar resultado del lote** recupera el estado persistido, incluso tras perder la conexión. Un doble clic o repetir la misma confirmación sólo consulta el estado iniciado; no vuelve a aplicar cambios. Si el servicio se reinicia en medio de un lote, queda interrumpido: no continúa automáticamente. Los recibos de cada precio conservan los cambios confirmados y marcan los resultados inciertos. Verificar estos últimos en Protheus antes de preparar otra revisión. **Ver último lote**, dentro del menú **＋**, recupera el resumen desde el chat.

La base `unidad` significa la UM de SB1, que puede ser UN, G, KG u otra. `millar` sólo se acepta para productos UN y divide el precio por 1000. No se infieren conversiones entre G/KG ni moneda, impuestos o descuentos. Un `$` aislado no permite identificar la moneda. Se conserva la moneda de AIB/DA1. Las propuestas verifican de nuevo precio, producto, lista, proveedor/tienda y moneda; los cambios concurrentes requieren preparar otra propuesta.

La extracción es local, sin enviar archivos a IA externa. Excel usa valores guardados; no calcula fórmulas ni ejecuta macros. PDF usa texto/tablas cuando existen y OCR para páginas escaneadas. Las imágenes usan OCR. Las instrucciones escritas en archivos se tratan como texto, nunca como comandos. La lectura no garantiza interpretar cualquier diseño: encabezados desconocidos, celdas combinadas, imágenes borrosas y separadores ambiguos pueden necesitar corrección manual. Para varias tablas conviene usar encabezados Código, Descripción, Precio, Moneda y Unidad.

Límites: 20 MB, 20 páginas/hojas, 2000 filas extraídas, 40 columnas, 500 precios candidatos y 3 minutos de extracción. Un archivo se extrae por vez. El binario temporal se borra al finalizar, incluso con error. El texto y revisión quedan en la base local por usuario; el borrador vence a las 24 horas y se purga al siguiente adjunto. La evidencia de propuestas y auditoría sigue la conservación de las propuestas. No se guarda información comercial en el caché PWA.

## Instalación en Windows

Con Python 3.11 de 64 bits:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/instalar-documentos.ps1
```

Instala dependencias fijadas en `.venv-documents`, verifica Excel/PDF/OCR y marca el lector disponible. Para el servicio LOCAL SERVICE, ejecutar `scripts/instalar-inicio-automatico.ps1` como administrador concede lectura a este entorno y a su instalación base Python. El instalador de documentos no cambia ni reinicia el servicio.

## API y permisos

- `POST /api/price-imports?kind=proveedor&sucursal=0101`: cuerpo binario, `Content-Type: application/octet-stream`, `X-File-Name` con nombre codificado con `encodeURIComponent`.
- `GET /api/price-imports/:id`: recuperar borrador propio no vencido.
- `POST /api/price-imports/:id/preview`: JSON con `reviewed:true`, `party`, `shop`, `list`, `currency`, `unit` y `rows`. Cada fila tiene `id`, `product`, `description`, `price`, `currency`, `unit`, y opcionalmente `record` para seleccionar un candidato. Los IDs vienen de la extracción; las filas manuales usan `manual-1`, etc. El registro se relee limitado al producto, tercero y lista elegidos.
- `GET /api/price-imports/batches/:id`: resumen inmutable, errores y estado de cada precio, aislados por usuario.
- `POST /api/price-imports/batches/:id/execute`: JSON `{ "confirm": true, "fingerprint": "huella del resumen" }`. Exige permiso de ejecución DA1/AIB, además de los de lectura y preparación. Usa el ejecutor y los recibos individuales existentes; no acepta una lista arbitraria de propuestas enviada por el navegador.

Todos los endpoints requieren autenticación, permiso para preparar la acción DA1/AIB y lectura de catálogo, tercero y precios correspondientes. La sucursal y actor se fijan al adjuntar. No se admiten borradores de otros usuarios. La revocación o cambio de rol invalida el alcance anterior, incluso al recuperar evidencia.
