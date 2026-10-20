# Precios desde Excel, fotos y PDF

En el chat, **Adjuntar precios** abre un archivo XLSX, XLS, PDF, PNG, JPG o WebP. El destino inicial es proveedor (AIB); también admite cliente (DA1). No hay una pantalla independiente de actualizaciones.

1. Elegir el archivo y revisar la tabla extraída. Corregir códigos, importes, moneda y base cuando haga falta. Se conserva la lectura original de cada fila para comparar.
2. Indicar proveedor/cliente y, si hay más de una opción, tienda o lista. Si existen varias fechas o tramos, la verificación ofrece los registros ERP de esa fila para elegir explícitamente y volver a preparar. La moneda y base por fila prevalecen sobre los valores por defecto. Usar importes sin separadores de miles.
3. Marcar la revisión y elegir **Verificar y preparar cambios**. La aplicación relee SB1 y AIB/DA1. Para códigos propios de proveedores busca la relación exacta en SA5; para clientes exige la lista de SA1.A1_TABELA.
4. Revisar y confirmar cada propuesta. Adjuntar, corregir y preparar no modifican el ERP. Cada confirmación actualiza un registro existente en una transacción independiente. Las filas rechazadas tienen un motivo; no se crean productos ni precios ausentes.

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
- La ejecución usa las rutas existentes de propuestas, con su confirmación y permiso independiente.

Todos los endpoints requieren autenticación, permiso para preparar la acción DA1/AIB y lectura de catálogo, tercero y precios correspondientes. La sucursal y actor se fijan al adjuntar. No se admiten borradores de otros usuarios. La revocación o cambio de rol invalida el alcance anterior, incluso al recuperar evidencia.
