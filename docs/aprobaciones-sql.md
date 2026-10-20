# Aprobaciones de compras por SQL

Las altas SC1/SC7 pueden confirmarse con estado B cuando tienen un circuito soportado. Se crea el documento y su circuito pendiente en una transacción; B describe una espera en Protheus, no un bloqueo de ejecución de la app. No se ejecuta REST, ADVPL ni una aprobación automática.

## Reglas

- SX6: prioridad de filial lógica sobre global. Parámetros requeridos ausentes, duplicados o mal tipados producen un error; no se inventan valores predeterminados. Los parámetros exclusivos de entidades se requieren sólo cuando ese modo está activo.
- Pedido estándar: grupo SY1.Y1_GRAPROV del comprador, con MV_PCAPROV como alternativa. Se guarda C7_COMPRA y C7_APROV. Si hay grupos por comprador, se necesita identificar el comprador. Y1_PEDIDO=2 sigue exigiendo vincular una solicitud, fuera del alta independiente.
- SAL/SAK/DHL: usuario, perfil, nivel y moneda local. AL_AUTOLIM=S selecciona por rango inclusivo mínimo/máximo; N incluye cualquier importe. MV_ALTPDOC determina si se aplican los indicadores AL_DOCPC/SC/IP. Se conservan los tipos de aprobador A/V y liberación U/N/P en SAL, sin modificarlos. El primer nivel aplicable queda pendiente; los posteriores esperan.
- Entidades SC1/SC7: centro de costo validado en CTT, correspondencia DBL con las otras entidades vacías y alternativa MV_APGRDFL=grupo;ítem. MV_PERFALC=1 evalúa el total agrupado; 2 evalúa cada ítem. MV_IPAPREC determina si SC7 queda pendiente por grupo o documento. Importes calculados después de convertir millares/unidades, sin volver a multiplicar por 1000.
- SC1 simple: con MV_RESTSOL=S se requiere solicitanteCodigo (usuario ERP, distinto del nombre). SAI evalúa permisos individuales de inclusión/exclusión, producto, grupo y cantidad; B1_SOLICIT y MV_CHKSOLI preservan restricciones. MV_APROVSC determina la espera simple para ítems sin permiso, liberable en MATA110, sin inventar SCR. Con alçadas contables se utiliza el circuito SC.

## Registros y transacción

SCR guarda número, tipo PC/SC/IP, grupo, ítem DBL, usuario, aprobador, nivel original de SAL, emisión e importe. CR_STATUS=02 para el primer nivel; 01 para los posteriores. CR_NUM usa el número del documento sin concatenar filial ni grupo. CR_ITGRP corresponde a DBL_ITEM, no a AL_ITEM. Para SC/IP, DBM vincula número/ítem/grupo/ítem DBL/usuario, importe y DBM_APROV=2. Los campos de liberación realizada permanecen vacíos/cero. No se consume ni reinicia saldo SCS.

Huella de alta versión 4: parámetros, catálogos, reglas, referencias, esquemas y valores iniciales. Relectura con UPDLOCK/HOLDLOCK antes del INSERT y del COMMIT. Un cambio invalida la propuesta. Orden de bloqueo: documento, SCR, DBM. RECNO por MAX+1 global incluyendo borrados y otras filiales, usando BigInt y TABLOCKX/HOLDLOCK. Se rechaza cualquier circuito previo para número/filial/tipo, incluso borrado. INSERT parametrizado, verificación completa posterior y rollback conjunto. El recibo incluye los RECNO de cada tabla; la repetición de una confirmación no vuelve a insertar.

Continúa el límite de numeración: no coordina reservas en memoria de DBAccess/AppServer. Tampoco ejecuta puntos de entrada, notificaciones ni personalizaciones ADVPL. La liberación posterior debe realizarse en Protheus; no se ha homologado esa liberación en sus pantallas.

## IP+PC y superiores

MV_APRIPPC=1 habilita dos fases. El alta genera IP y muestra PC diferido, con grupo del comprador o MV_PCAPROV y el total del pedido. Si no hay IP aplicable, genera PC inmediatamente, sin DBM para PC. Mientras PC esté diferido, todos los ítems se crean en B incluso con MV_IPAPREC activo. No se crean aprobaciones PC pendientes antes de finalizar IP.

**Continuar IP → PC** relee el documento y el circuito completo. Exige todos los pasos IP en 03/05, evidencia de liberación para cada 03 y vínculos DBM en 1, con importes y grupos coincidentes. Inserta PC pendiente con RECNO MAX+1 en una transacción. Si Protheus ya generó PC, verifica sus pasos y devuelve que ya existe, sin duplicarlo o reiniciarlo. No cambia C7_CONAPRO a L; la aprobación sigue a cargo de Protheus. Configuración modificada, un IP rechazado, vínculos incompletos o PC histórico borrado impiden recreación.

**Transferir al superior** admite un paso SCR en 02, sin liberación y con ítems pendientes B. Resuelve primero SAK.AK_APROSUP y después SAL.AL_APROSUP/AL_USERSUP. Verifica existencia, usuario, moneda y cadena sin ciclos. No añade el superior como un nivel extra al dar el alta ni infiere ausencia o saldo agotado. La transferencia puntual SQL cambia CR_USER/CR_APROV, conserva CR_USERORI/CR_APRORI y establece CR_TPTRAN=3 (valor verificado en SX3). En SC/IP cambia también DBM_USER, conservando DBM_USEROR. Mantiene importes, nivel, estados, fechas de liberación y saldos SCS. Otro salto conserva el origen inicial. Colisiones con un paso ya asignado al superior se rechazan, no se fusionan aprobaciones.

Ambas acciones se preparan en **Actualizaciones → Continuar o escalar una aprobación de compra**, o por texto/voz indicando IDs explícitos. Requieren revisión y confirmación writer; no son tareas de fondo. Operan sobre altas ejecutadas por esta app y pertenecientes al mismo actor, usando el ID de propuesta original como prueba de procedencia. La propuesta de origen puede estar vencida: su recibo ejecutado sigue siendo válido; cada propuesta de transición tiene su propio vencimiento. No admiten importación de circuitos históricos ajenos ni ejecutan transferencias de todas las pendencias de un usuario. Las acciones manuales conviven con el proceso automático por vencimiento descrito abajo. Tener superior por sí solo no habilita ese proceso.

API: `POST /api/changes/preview` con `{"action":"continuarAprobacionCompra","target":{"sucursal":"0101","propuesta":"UUID_DEL_ALTA"}}`; para transferir, acción `escalarAprobacionCompra` y `target.registro` con el RECNO SCR. Confirmar por `/api/changes/{id}/execute` con `confirm:true` y la huella. El ID no da acceso a propuestas de otro actor. Las entradas privadas `source` se rechazan. El recibo registra tabla/RECNO y operación; las repeticiones del mismo ID devuelven el recibo guardado. Una segunda propuesta concurrente se invalida si cambió el circuito.

## Escalamiento automático por vencimiento

El servicio local de fondo, habilitado por `ERP_APPROVAL_AUTO_ESCALATE=true` junto con `ERP_WRITE_ENABLED=true`, revisa cada `ERP_APPROVAL_POLL_MS` (60000 por defecto) las filiales autorizadas. No necesita una confirmación por aprobación. Incluye SCR SC/IP/PC existentes en ERP, aunque no provengan de una propuesta de esta app; la restricción por actor del flujo manual permanece intacta. Se detiene al cerrar el servidor Node o perder acceso a la base, y retoma al iniciarse/conectarse. La PWA no necesita estar abierta.

La configuración aplicable es la que Protheus materializó en el documento: **CR_PRAZO** válido y anterior a la fecha actual del servidor SQL, **CR_ESCALSP=T**, estado 02 y ausencia de liberación. No escala el día del vencimiento. CR_ESCALON y CR_AVISO son de notificaciones; no habilitan una transferencia. Este servicio no envía correos, no recalcula plazos ni evalúa fórmulas COMA200/DHK. Las altas SQL de esta app que no tengan plazo/indicador resueltos no adquieren un plazo arbitrario: no se activa escalamiento por el solo hecho de tener un superior. Las reglas DHM de creación continúan con el alcance indicado abajo.

Resuelve el superior inmediato con prioridad SAK sobre SAL y verifica usuario, nivel, grupo, cadena sin ciclos y moneda local. Relee documento, SCR, DBM, SAK/SAL y esquemas dentro de una transacción serializable. Sólo transfiere ítems B sin atención/cierre, con importes y vínculos consistentes. PC no puede adelantar IP pendiente. Cambia exclusivamente los campos de destinatario y origen ya documentados para la transferencia puntual. Conserva el plazo, flags, niveles, importes, saldos SCS y estados de aprobación.

Hace **un salto por aprobación/vencimiento**, no recorre automáticamente toda la cadena por un plazo ya vencido. Un origen o tipo de transferencia ya informado se considera previamente transferido, incluso por Protheus, y no se repite. No inventa un nuevo plazo para el superior. Los bloqueos y la huella impiden sobreescribir una aprobación o transferencia concurrente. Coordinar la operación con SCHEDCOMALC: este adaptador no apaga ni administra el job nativo, y no afirma exclusión mutua con implementaciones nativas que no respeten esos marcadores.

`approval_escalations` en SQLite conserva identidad de la fila y vencimiento, estado, destinatarios y recibo; `audit` registra la ejecución como `system:approval-scheduler`. Reclamo atómico compartido entre procesos locales y lectura SQL posterior. Un fallo con rollback confirmado se vuelve a evaluar; COMMIT incierto, reclamo interrumpido o fallo al guardar el recibo no se reenvían automáticamente. Los registros afectados requieren conciliación de su estado. La paginación por RECNO avanza entre ciclos para evitar que un pendiente problemático impida revisar los siguientes.

**Actualizaciones → Escalamiento automático de aprobaciones → Ver actividad** muestra estado, últimos recibos e incidencias. API writer de sólo lectura: `GET /api/approvals/automation`; `/api/capabilities` expone únicamente estado agregado. No hay endpoint público que fuerce ejecución ni cambios de configuración desde el chat.

Verificación: tests de fechas, flags, SC/IP/PC, jerarquías, concurrencia, reinicio, rollback y resultado incierto. En el relevamiento de esta implementación había cero SCR activos SC/IP/PC. Se verificó la preparación contra esquemas reales usando documentos simulados en memoria, sin ejecutar escrituras comerciales. No equivale a homologar la pantalla de aprobación nativa.

## Alcance explícito

No se trata cualquier configuración avanzada como equivalente al circuito básico. Se rechazan: reglas DHM por tipo de compra no informado, divisas, usuarios repetidos en un grupo, permisos SAI por grupos de usuarios o dominio R y restricciones contables MV_RESTSCC. El formulario no admite rateos ni otras entidades contables. Estos casos conservan un motivo específico; ya no existe el bloqueo general por tener alçadas activas. Una configuración sin aprobadores aplicables produce L, con exclusiones visibles en la propuesta.

## Evidencia

Pruebas con dobles: circuito estándar, SC/IP con DBM, niveles y tipos de liberación, rangos y límites, múltiples grupos, conversión de millares, permisos simples, rollback de SCR/DBM, concurrencia, cambios de reglas e idempotencia HTTP.

`node --env-file-if-exists=.env scripts/check-purchase-creation-readonly.js`: configuración real permite SC1/SC7 en L. `scripts/check-approval-circuit-readonly.js`: esquema real y catálogos existentes, con parámetros, indicadores de documento y DBL simulados **sólo en memoria** para preparar PC/SC/IP, IP+PC y una cadena de superior. También prepara las transiciones usando documentos/circuitos simulados en memoria sobre los esquemas reales. Verifica valores iniciales, permisos y SELECT de asignación. Cero escrituras de negocio o configuración. No sustituye una prueba de liberación comercial en Protheus.

## Referencias

- [TOTVS: configuración estándar y rangos](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360006822671).
- [TOTVS: parámetros y tablas](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360024915131).
- [TOTVS: grupos y entidades](https://tdn.totvs.com/pages/viewpage.action?pageId=506993520).
- [TOTVS: liberación por usuario, nivel o documento](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360018595131).
- [TOTVS: solicitantes y bloqueo simple](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360007049611).
- Esquemas SX2/SX3, relaciones SX9 y tipos/defaults/índices SQL de esta instalación, inspeccionados en lectura. El mapeo SQL es implementación del adaptador; no un contrato de escritura SQL publicado o certificado por TOTVS.

Fuentes de esta ampliación: [TOTVS: proceso IP+PC](https://tdn.totvs.com/pages/viewpage.action?pageId=556389327), [prioridad del superior SAK sobre SAL](https://tdn.totvs.com/pages/viewpage.action?pageId=274637723), [transferencia al superior](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360016547552), [programación por tipo de compra](https://tdn.totvs.com/pages/viewpage.action?pageId=267795014). Se trata de una implementación SQL del adaptador; no se presenta como ejecución ADVPL ni homologación de liberación en las pantallas Protheus.

## Documentos con origen en dólares

SC7 conserva C7_MOEDA/C7_TXMOEDA y los pasos SCR conservan CR_MOEDA/CR_TXMOEDA, incluido PC diferido después de IP. CR_TOTAL y DBM_VALOR corresponden a importes del documento; los rangos DHL locales se comparan con importe × cotización. SC1 común mantiene su estimación local. SC1 en dólares es SI/MATA113 y aplica MV_APROVSI (B/L), sin generar SCR/DBM de SC. Los perfiles, aprobadores y superiores soportados siguen siendo de moneda local. El escalamiento admite un SC7 extranjero si moneda y cotización coinciden con SCR; no modifica ninguna de ellas. Ver [alcance y evidencia de monedas](monedas-altas.md).
