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

Huella versión 3: parámetros, catálogos, reglas, referencias, esquemas y valores iniciales. Relectura con UPDLOCK/HOLDLOCK antes del INSERT y del COMMIT. Un cambio invalida la propuesta. Orden de bloqueo: documento, SCR, DBM. RECNO por MAX+1 global incluyendo borrados y otras filiales, usando BigInt y TABLOCKX/HOLDLOCK. Se rechaza cualquier circuito previo para número/filial/tipo, incluso borrado. INSERT parametrizado, verificación completa posterior y rollback conjunto. El recibo incluye los RECNO de cada tabla; la repetición de una confirmación no vuelve a insertar.

Continúa el límite de numeración: no coordina reservas en memoria de DBAccess/AppServer. Tampoco ejecuta puntos de entrada, notificaciones ni personalizaciones ADVPL. La liberación posterior debe realizarse en Protheus; no se ha homologado esa liberación en sus pantallas.

## Alcance explícito

No se trata cualquier configuración avanzada como equivalente al circuito básico. Se rechazan: dos etapas IP+PC (MV_APRIPPC=1), superiores/escalamiento, reglas DHM por tipo de compra no informado, divisas, usuarios repetidos en un grupo, permisos SAI por grupos de usuarios o dominio R y restricciones contables MV_RESTSCC. El formulario no admite rateos ni otras entidades contables. Estos casos conservan un motivo específico; ya no existe el bloqueo general por tener alçadas activas. Una configuración sin aprobadores aplicables produce L, con exclusiones visibles en la propuesta.

## Evidencia

Pruebas con dobles: circuito estándar, SC/IP con DBM, niveles y tipos de liberación, rangos y límites, múltiples grupos, conversión de millares, permisos simples, rollback de SCR/DBM, concurrencia, cambios de reglas e idempotencia HTTP.

`node --env-file-if-exists=.env scripts/check-purchase-creation-readonly.js`: configuración real permite SC1/SC7 en L. `scripts/check-approval-circuit-readonly.js`: esquema real y catálogos existentes, con parámetros, indicadores de documento y DBL simulados **sólo en memoria** para preparar PC/SC/IP. Verifica valores iniciales, permisos y SELECT de asignación. Cero escrituras de negocio o configuración. No sustituye una prueba de liberación comercial en Protheus.

## Referencias

- [TOTVS: configuración estándar y rangos](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360006822671).
- [TOTVS: parámetros y tablas](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360024915131).
- [TOTVS: grupos y entidades](https://tdn.totvs.com/pages/viewpage.action?pageId=506993520).
- [TOTVS: liberación por usuario, nivel o documento](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360018595131).
- [TOTVS: solicitantes y bloqueo simple](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360007049611).
- Esquemas SX2/SX3, relaciones SX9 y tipos/defaults/índices SQL de esta instalación, inspeccionados en lectura. El mapeo SQL es implementación del adaptador; no un contrato de escritura SQL publicado o certificado por TOTVS.
