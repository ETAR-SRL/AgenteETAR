# Actualizar la app y volver atrás si falla el arranque

## Uso en el servidor

Abrir **Actualizar-app.bat**, elegir el ZIP de **fuentes** de la nueva versión y aceptar el aviso de Windows. También se puede arrastrar el ZIP sobre el BAT o indicar la ruta:

```bat
Actualizar-app.bat "C:\Actualizaciones\AgenteETAR-fuentes.zip"
Actualizar-app.bat --check "C:\Actualizaciones\AgenteETAR-fuentes.zip"
Actualizar-app.bat --offline "C:\Actualizaciones\AgenteETAR-fuentes.zip"
```

`--check` verifica el paquete y su compatibilidad estructural sin parar el servicio ni modificar la instalación. Usa una carpeta temporal de fuentes y la elimina al finalizar. `--offline` exige que las dependencias npm estén en la caché local; sin esa opción prioriza la caché y descarga faltantes con `npm ci`, lockfile e integridad, sin ejecutar scripts de instalación. Una falta de dependencias se informa **antes de detener la app**.

Usar el ZIP generado por `scripts/package-source.py` desde `main`, con manifiesto SHA-256 y `updateProtocol: 1`. El ZIP de descarga genérica de GitHub no lleva ese manifiesto. El ZIP privado de traslado tampoco sirve para actualizar: contiene datos de otra instalación y se rechaza. No se necesitan Git ni credenciales de GitHub en el servidor para aplicar un paquete local. El manifiesto comprueba integridad; no acredita al editor: obtener el paquete por un canal confiable y comparar el `.sha256` entregado.

Requiere el servicio nativo **CentralETAR**, bajo **LOCAL SERVICE**, instalado en esa misma carpeta con soporte de mantenimiento. La instalación preparada en esta entrega ya lo incluye. No reemplaza tareas programadas anteriores ni intenta migrar una versión antigua en ejecución que todavía no tenga ese soporte. Para esa primera migración usar el paquete de instalación actualizado durante mantenimiento, según [instalación](instalacion-otro-servidor.md).

## Qué conserva

Conserva `.env`, `config`, certificados y claves TLS, base local, usuarios, roles, preferencias, conversaciones, seguimientos y aprendizaje. Las fuentes `config` del ZIP se verifican pero **no sustituyen** la configuración del servidor. No ejecuta la preparación de una instalación nueva ni vuelve a poner sus opciones en modo consultivo. No habilita permisos, escrituras, notificaciones ni proveedores de IA distintos de los configurados.

Los modelos, runtimes y entornos de IA, voz y OCR se mantienen. El actualizador prepara nuevas dependencias npm en una carpeta separada; no instala sobre las que utiliza el proceso en ejecución. Cambiar la versión de Node o el host/permisos del servicio exige una actualización del instalador durante mantenimiento y se rechaza antes de parar la app. Si una versión depende de otros componentes locales, su comprobación de arranque debe pasar antes de habilitarla; no se da por instalada por copiar archivos.

## Recorrido y respaldo

1. Verifica rutas, contenido exacto del ZIP, versiones y hashes. Rechaza archivos privados, entradas duplicadas, enlaces y rutas fuera del destino. Prepara dependencias sin tocar las actuales.
2. Activa mantenimiento mediante un archivo protegido: nuevas consultas, ingresos y operaciones comerciales reciben una respuesta de mantenimiento. Espera las solicitudes ya iniciadas y el cierre de los procesos de fondo. No detiene una operación activa ni acepta resultados inciertos de ejecuciones, escalaciones o lotes de precios.
3. Detiene SCM y confirma que terminaron sus procesos. Vuelve a comprobar SQLite en modo de sólo lectura. Crea un respaldo privado junto a la instalación, en **`.AgenteETAR-backups\fecha-identificador`**, con fuentes, configuración y una copia SQLite consistente. No copia un WAL activo por separado. Los modelos y cachés pesados se conservan en su lugar; las dependencias anteriores se guardan en el respaldo durante el intercambio.
4. Aplica la versión y arranca en **modo de prueba**: las operaciones comerciales y los procesos automáticos siguen bloqueados. Comprueba PID/versión/huella, HTTP, HTTPS cuando está habilitado, IA local y voz. Protheus o KAIQEN pueden estar sin conexión; eso no resuelve seguimientos ni impide probar el servidor.
5. Sólo después de comprobar el arranque confirma la versión y activa explícitamente las operaciones con sus permisos previos. No hace un segundo arranque sin protección para probarla.

No borra los respaldos automáticamente. Contienen datos y credenciales: mantenerlos protegidos y fuera de Git y de las carpetas compartidas con usuarios. Reservar espacio para fuentes, dependencias y datos locales del respaldo. La carpeta de trabajo **`.AgenteETAR-update`** también queda fuera de la instalación y sirve para diagnóstico. No eliminar un respaldo ni su carpeta de trabajo mientras figure una actualización pendiente.

## Si falla

Si falla la aplicación, el arranque o la comprobación **antes de activar operaciones**, detiene la versión fallida, restaura fuentes, dependencias, configuración y SQLite anteriores —incluido el esquema anterior a una migración— y vuelve a comprobar esa versión antes de abrir el acceso. Devuelve error indicando que se restauró la versión previa; no presenta una reversión como una actualización exitosa. Guarda los nuevos archivos locales introducidos por el arranque fallido en el respaldo para diagnóstico.

No modifica ni revierte documentos de Protheus para hacer estas pruebas. Una vez confirmada la versión y permitido operar, no rebobina automáticamente una base que podría contener nuevas operaciones. Si falla la activación final, mantiene el registro y exige revisar ese estado; no oculta el problema restaurando datos anteriores.

Ante corte de Windows, registro incompleto, fallo de respaldo o imposibilidad de verificar la restauración, conserva el estado de mantenimiento y evita otra actualización encima. Revisar los registros y el respaldo antes de intervenir; no borrar el control para forzar la apertura. Esto es un bloqueo seguro, no una promesa de recuperación automática ante cualquier daño del equipo.

Registros dentro de `DATA_DIR`: `maintenance/active-update.json`, `update-last-result.json` (en `data` del servicio), `update-runtime.json`. En el respaldo: `journal.json`, fuentes/datos y dependencias anteriores. El servidor sólo lee el control protegido y escribe su confirmación aparte; los usuarios del chat no disponen de una API para actualizar ni salir de mantenimiento. `DATA_DIR` externo a la carpeta se rechaza para no realizar un respaldo incompleto.

## Comprobaciones de esta entrega

Se probaron éxito, fallo al iniciar, fallo de verificación después de alterar el esquema SQLite, recuperación de usuarios y roles, conservación exacta de `.env`, configuración y dependencias, bloqueo de operaciones activas/inciertas, paquetes inválidos y registros interrumpidos. La integración Windows usa carpetas temporales y SCM simulado: no detuvo un servicio real ni alteró documentos comerciales. La validación de IA/voz se prueba también con servidor aislado, sin datos de producción. El arranque SCM en el servidor nuevo se verifica al ejecutar allí el BAT.
