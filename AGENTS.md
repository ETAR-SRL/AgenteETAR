# Agente ETAR

- Trabajar exclusivamente sobre `main`. No crear ramas ni worktrees para este repositorio.
- Escribir mensajes de commit claros en español, describiendo el cambio real y sus límites.
- No versionar `.env`, credenciales, bases locales, audio, capturas comerciales, informes con filas ERP, modelos ni runtimes. Usar `.env.example` sin valores secretos.
- Preservar PWA, consultas por texto/voz, memoria local, fuentes ERP/KAIQEN, informes de saldos y aislamiento de sucursales.
- Leer `docs/reglas-etar.md` antes de modificar precios, cantidades, pedidos o vínculos comerciales.
- Los terminados de ETAR comienzan con `Z`. Resolver cliente → `SA1.A1_TABELA` → lista DA0/DA1 → producto; no inferir un cliente único a partir del prefijo ni del nombre.
- La operación comercial usa habitualmente millares; TOTVS guarda cantidades en unidades. Un millar = 1000 unidades. Mantener separadas cantidad, precio por unidad, precio por millar y total.
- `C6_MILLAR` y `D2_MILLAR` son cantidades en millares, no precios. Un UPDATE SQL no ejecuta automáticamente los disparadores de pantalla/ADVPL.
- Las actualizaciones solicitadas son sobre registros existentes: DA1, AIB, solicitudes SC1 y pedidos SC6/SC7; SC9 sólo como dependencia pendiente de un cambio de precio de SC6. El dueño amplió el alcance a altas SC1/SC7, todavía sin ejecutor por numeración/RECNO compartidos y circuito de creación pendientes. No inventar RECNO con MAX+1. El contrato de ejecución y sus límites están documentados; no presentar una propuesta como una modificación ejecutada.
- No ejecutar cambios de negocio como prueba de arranque, publicación o tests. Las pruebas automatizadas usan dobles; las comprobaciones de producción son lecturas salvo una instrucción concreta del dueño para modificar registros identificados.
- Ejecutar las pruebas relevantes antes del commit. Mantener explícitos los campos, filiales y circuitos que todavía no se verificaron.

- Indicación más reciente del dueño: reajuste directo SQL de C6_PRCVEN y C9_PRCVEN pendientes, incluso con MV_BLOQUEI activo, conservando estados y documentos emitidos. Mostrar que no revalida crédito ni recalcula saldos SA1; nunca escribir aprobaciones ni desactivar parámetros. No invocar REST Protheus. Las cantidades de segunda unidad se conservan completas en este modo de sólo precio.
