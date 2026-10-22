# Correcciones de fechas, depósitos y condiciones de pago

Central extiende los descartes conversacionales a emisión, entrega/necesidad, depósito y condición de pago. Conserva producto, tercero, cantidades, precios, moneda y los campos no corregidos. Los candidatos y pendientes son entradas del usuario dentro del borrador, conversación y sucursal; no son preferencias globales ni valores acreditados por memoria.

## Alcance

Las correcciones se aplican a los borradores de nuevas solicitudes SC1 y pedidos de compra SC7, incluidos los preparados desde adjuntos. El resumen habitual y la confirmación explícita se mantienen. El ejecutor existente vuelve a verificar permisos, configuración, catálogos y valores actuales.

No se agregan escrituras ni permisos. En documentos existentes SC1/SC6/SC7 las operaciones habilitadas siguen limitadas a sus campos comerciales soportados. Una petición de cambiar fechas, depósito o condición de pago explica que ese ejecutor no está habilitado y bloquea la preparación de otros cambios pendientes. Se puede decir «cancelá el cambio de depósito» para continuar con el cambio comercial conservado. No modifica documentos históricos ni cabeceras por otra vía.

## Fechas

- Emisión y entrega/necesidad son datos distintos. «Esa fecha no» pregunta cuál cuando hay más de una posible, sin eliminar ambas ni elegir una silenciosamente.
- Una fecha nueva expresada antes de aclarar el tipo queda como candidato: «Cambiá la fecha al 25/10/2026» y luego «la de entrega» no exige repetirla. Un reemplazo posterior prevalece; un candidato descartado no vuelve al elegir el tipo.
- Formatos admitidos: AAAA-MM-DD, DD/MM/AAAA y DD-MM-AAAA. Se comprueba el calendario real, sin convertir 31 de febrero en otra fecha. Años ausentes o de dos dígitos requieren una fecha completa; no se adivina el año. Una expresión incompleta como «viernes 30 de octubre» pide la fecha completa en lugar de ignorar el día/mes y elegir el próximo viernes.
- Hoy, ayer, anteayer, mañana y pasado mañana se resuelven contra el día argentino del turno. Un día de semana sin otra precisión significa su próxima aparición; «pasado/anterior» retrocede. El resultado ISO se guarda y muestra en el resumen: no se vuelve a calcular al retomar mañana el borrador.
- «Vencimiento» requiere aclarar el tipo de fecha. No se convierte en entrega ni cambia vencimientos financieros.

## Catálogos y contexto

Un depósito o pago rechazado queda pendiente hasta una elección afirmativa. «El anterior», «el habitual» o una preferencia de depósito no lo recuperan. Las instrucciones de conservar («no cambies») y los ejemplos hipotéticos no son descartes ni cambios.

Se conservan ceros iniciales. Los códigos se consultan exactamente en `depositos` y `condicionesPago`; el resultado debe corresponder a ese código. Los nombres sólo usan la búsqueda acotada cuando el recurso anuncia su filtro `q`, y una coincidencia debe ser única. No se elige el primer resultado ni se sustituye un código por otro. Un fallo de fuente conserva el borrador, impide la propuesta y no acredita que el catálogo esté vacío.

Los pendientes se verifican antes de la selección acotada de mensajes para Qwen. Las aclaraciones usan el mismo contrato JSON reducido previo a la generación y se validan contra el esquema reducido y el original. No hay reparación posterior de respuestas ni entrenamiento de pesos. Las correcciones claras continúan por consultas estructuradas, sin una inferencia adicional.

Los adjuntos conservan pendientes por campo y fila. Corregir una fila no resuelve el descarte de otra ni restaura datos del archivo o preferencias. Si hay más de un alcance posible, se pide la fila o una instrucción explícita para todas. Emisión y pago pertenecen al documento. Cambiar a un documento nuevo autorizado limpia los bloqueos del destino anterior.

## Comprobaciones

Las pruebas controladas verifican calendario, descartes, candidatos, borradores pausados, preservación de precios/cantidades, catálogos inconsistentes o caídos, autorización y operaciones no habilitadas. La memoria y los adjuntos siguen separados por usuario y sucursal.

`scripts/evaluate-logistics-chat-live.js --live` usa ERP de sólo lectura, Qwen local, el chat HTTP real y SQLite aislado. El 22/10/2026 pasaron los cuatro recorridos (emisión, necesidad, depósito y pago), cada uno con 51 turnos de usuario, 102 mensajes y 46 consultas intermedias. Se realizaron 213 lecturas y 12 inferencias; hubo cero ejecuciones y cero confirmaciones enviadas. Se verificaron referencias reales de SB1, depósitos, condiciones de pago y proveedor/tienda. Pasaron aislamiento, revocación y validación del reemplazo. Informe privado: `reports/live-logistics-v8-2026-10-22.json`, sin filas comerciales persistidas.

`scripts/qwen-logistics-evaluate.js --live` comprueba cinco tipos de pendiente, cada uno en conversación corta y con 90 mensajes intermedios: diez casos sintéticos congelados. Registra esquema enviado y salida cruda en `data/evaluation`, ignorado por Git. `--validate-fixtures` sólo valida la construcción de las pruebas y no es inferencia.

Resultado del 22/10/2026: Qwen pasó 10/10, con argumentos vacíos y las aclaraciones correctas, sin modificar su salida después de generar. Registro privado: `data/evaluation/qwen-logistics-v8-release.json`. La suite completa aprobó 838/838 (`data/logistics-v8-release-tests.log`); las 41 comprobaciones específicas de adjuntos, candidatos, calendario y autorización pasaron nuevamente después del último ajuste del calendario (`data/logistics-v8-calendar-final-tests.log`). La revisión de las suites sintéticas anteriores de valores y referencias pasó 10/10 y 8/8 como validación de fixtures, sin afirmar una nueva inferencia de esos casos antiguos.

Las propuestas y sus confirmaciones se comprueban con dobles. Estas lecturas reales no constituyen una prueba de escritura SC1/SC7 en Protheus; no se alteran documentos comerciales para fabricar casos.
