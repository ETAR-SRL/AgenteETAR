# Casos personales y resumen del día

Los casos amplían los avisos y seguimientos existentes: conservan `op_items.id`, propietario personal y sucursal. No crean una segunda bandeja ni una fuente ERP nueva. «Mis casos» incluye los pausados y cancelados; «Mis seguimientos» mantiene su alcance previo. Se pueden consultar desde otra conversación o tras reiniciar el servidor.

«Pausá este caso» detiene el seguimiento del objetivo y sus avisos; conserva evidencia, preferencias y objetivo. Las lecturas de la bandeja pueden actualizar el documento, pero no completan ni reactivan un objetivo pausado. «Retomá este caso» exige releer la fuente; si está caída conserva la pausa. «Cancelá este caso» conserva el historial. Posponer un aviso sigue siendo una acción diferente: sólo lo oculta temporalmente. Texto y dictado usan el mismo circuito personal del servidor.

«Objetivo del caso: revisar la fecha con compras», «Próximo paso: comprobar la fecha comprometida» y «Prioridad alta» guardan preferencias personales; «Cuál es el objetivo del caso» o «Próximos pasos» consultan lo guardado. Un objetivo redactado por el usuario no cambia las condiciones estructuradas de cumplimiento ERP. Las tarjetas muestran por separado el estado del caso, el objetivo comercial verificado, el estado del seguimiento y las referencias a propuestas. Esas referencias explican el motivo y estado registrado; nunca confirman una ejecución por sí solas.

La prioridad explica preferencia personal, fecha y su significado, antigüedad desde la detección y número de ítems/problemas leídos. Ordena la bandeja, sin sumar importes ni comparar monedas. Una fecha de emisión de remito se identifica como tal, no como compromiso de entrega. No interpreta hipótesis como causas demostradas.

Las investigaciones guardan conclusiones públicas: hechos, hipótesis, faltantes y fecha de evidencia. No almacenan razonamiento privado del modelo ni vuelven a presentar datos guardados como actuales. Se conserva hasta veinte investigaciones y cincuenta referencias por caso. Cada entrada registra sus recursos y revisión de permisos: un cambio de revisión o la revocación de cualquiera de sus recursos oculta esa entrada hasta una nueva investigación. Las lecturas base y la sucursal se revalidan además en cada consulta. No se reconstruye historia ERP anterior al seguimiento.

## Resumen personal

«Mostrame mi resumen del día» o **Generar resumen ahora** prepara cinco secciones: necesita atención, cambios, resuelto hoy, sin verificar y acción preparable. Esta última exige permisos actuales de preparación, además de lectura; no ejecuta nada. Los casos pausados se excluyen de atención y acción preparable; los cancelados se excluyen del resumen. Las cantidades e importes permanecen en sus tarjetas, separados por unidad y moneda.

La configuración personal permite activar la generación diaria, elegir hora `HH:mm` y zona IANA (por defecto 08:00, `America/Argentina/Buenos_Aires`). Está desactivada inicialmente. El servidor comprueba cada minuto si llegó el horario y genera un resumen por usuario, día local y sucursal; no depende del navegador. Si el servidor estaba apagado, puede generarlo al volver durante ese día. No promete una hora exacta ni recupera todos los días anteriores. No envía correos ni activa notificaciones externas.

`op_daily_settings` y `op_daily` conservan horario y referencias tras reinicios. Una clave única por propietario/día/sucursal y un préstamo durable independiente evitan duplicación entre procesos; una promesa evita ejecuciones simultáneas dentro del proceso. La generación explícita actualiza el mismo resumen. El servidor toma permisos actuales mediante `runAs`; no usa un administrador común. La persistencia del resumen guarda IDs y fecha, no copias con nombres o importes que puedan sobrevivir a una revocación. Al abrirlo reconstruye tarjetas accesibles con su última verificación y oculta lo revocado. La fecha de generación y la fecha de lectura de cada tarjeta son distintas.

El resumen tiene **alcance parcial**: reúne lo incorporado a la bandeja por tandas, en la sucursal seleccionada. No es un censo ERP. La caída de una fuente, un documento ausente o una lectura incompleta nunca acreditan resolución. Una caída de Protheus o KAIQEN deja su evidencia histórica como sin verificar; no genera cumplimiento. Las notificaciones PWA existentes siguen siendo opcionales y conservan sus recibos y deduplicación.

## Contrato local e integración

Rutas personales: `GET/PUT /api/attention/daily/settings`, `GET/POST /api/attention/daily?sucursal=...`; `POST /api/attention/:id/action` acepta `pause`, `resume`, `cancel` y `case-update` (`objective`, `nextSteps`, `preference`). El estado no se asigna mediante `case-update`: las transiciones requieren sus acciones explícitas. `currentDaily` devuelve `sections`, `sources`, `partial`, `scope`, `generatedAt`, `accessRevision`, `day` y `timeZone`.

`createAttentionChat` admite `enqueueInvestigation` para la cola durable del servidor; `chat.investigate(id,branch,{check})` investiga sin conversación mutable y comprueba cancelación/préstamo antes y después de releer, y antes de guardar hallazgos. `attention.recordInvestigation` y `attention.linkProposal` revalidan recursos antes de guardar. Estas funciones escriben sólo en la base local.

Las pruebas controladas verifican mismo caso entre conversaciones y reapertura de SQLite, pausa frente a cumplimiento, reanudación con fuente caída, aislamiento entre usuarios, evidencia revocada, horario local y cambio de horario de verano, deduplicación y concurrencia del resumen y fuente caída sin resolución. No alteran datos operativos ni habilitan notificaciones del usuario real.
