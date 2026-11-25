# ClusterAG

Aplicacion web y movil con frontend React, API Express y persistencia SQL. PostgreSQL es la base de produccion; SQLite se conserva para desarrollo local y pruebas. Firebase se usa solo para autenticacion por enlace/correo y notificaciones push, nunca como base de datos de la aplicacion.

## Arranque local

1. Copia `.env.example` a `.env` y completa los valores locales.
2. Ejecuta `npm install`.
3. Ejecuta `npm run dev`.
4. Abre `http://127.0.0.1:3000`.

La base local se crea en `.tmp/clusterag.sqlite`. El proyecto no copia ni restaura automaticamente una base semilla.

## Configuracion de produccion

- Define `DATABASE_CLIENT=pg` y una `DATABASE_URL` de PostgreSQL.
- Usa valores aleatorios de al menos 32 caracteres para `SESSION_SECRET` y `CRON_SECRET`. El servidor rechaza el arranque inseguro en produccion.
- Configura `APP_BASE_URL` y `GOOGLE_CALLBACK_URL` con el dominio real.
- Declara los usuarios iniciales mediante `SEED_SUPER_ADMIN_EMAILS`, `SEED_MANAGEMENT_TEAM_JSON` y `SEED_EDITOR_TEAM_JSON`; no hay identidades privilegiadas dentro del codigo.
- Ejecuta el bootstrap solo de forma deliberada con `RUN_BOOTSTRAP_ON_START=true`. En Vercel permanece desactivado por defecto.
- Completa `FIREBASE_*` para autenticacion por correo y push, y `SMTP_*` para reportes/notificaciones por email.
- Completa `R2_*` para archivos de tareas en Cloudflare R2 (hasta 10 GB). El endpoint se arma con `R2_ACCOUNT_ID`. Sin `R2_PUBLIC_BASE_URL` las descargas van por URL firmada. Los objetos se borran a los 5 dias (`R2_RETENTION_DAYS`). CORS: `npm run r2:cors`.

El acceso es por invitacion: una identidad de Google o Firebase que no exista previamente en `users` ni en la configuracion de bootstrap es rechazada.

## Comandos

- `npm test`: pruebas del backend y controles de seguridad.
- `npm run build`: genera CSS, bundle JavaScript y el directorio `public/`.
- `npm run check:design`: valida invariantes visuales y dependencias del frontend.
- `npm run check:kpi`: valida calculos KPI y ranking.
- `npm run check:polling`: valida la sincronizacion adaptativa.
- `npm run db:cleanup:dry-run`: calcula la limpieza segura del historial sin modificar datos.

El KPI de Inicio y Rendimiento usa el mismo periodo (inicio del mes hasta hoy,
hora de Honduras) y consolida las tareas asignadas de Accounts, Edicion y Gestion.
La nota es `(70 * peso completado + 30 * peso entregado a tiempo) / peso evaluable`,
considerando evaluables las tareas completadas o cuyo plazo ya venció. Los pendientes
de hoy y futuros siguen visibles, pero no reducen la nota antes de su fecha y hora
límite (17:00 de Honduras cuando no se especifica hora). El ritmo tampoco descuenta
por tareas abiertas que aún están dentro del plazo. El resultado se redondea
una sola vez; P1/P2/P3/P4 pesan 4/3/2/1. Las entregas sin fecha verificable
no acreditan puntualidad y mantienen la nota provisional, al igual que una muestra
de menos de cinco tareas evaluables. Los responsables y el vencimiento se conservan al completar
la tarea; reasignarla o editarla despues no transfiere el credito historico.

Cada cliente puede guardar un **Editor habitual** desde su formulario de edición.
Al crear un video y elegir ese cliente se selecciona su editor activo; una elección
manual en el video tiene prioridad. El creador no se usa por defecto como editor
si no pertenece al equipo de edición. Corregir responsables en tareas existentes
requiere el permiso `assign_tasks` (paquete «Asignar responsables»).

La limpieza real del historial exige `--apply --backup-confirmed`. No se debe ejecutar contra produccion sin una copia verificada.

## Supervisión de clientes y cuotas

El rol **Supervisor** tiene acceso global de visualización y gestión de clientes, equipo, tareas y calendario, además de usuarios, auditoría y configuración de reportes. Asígnalo desde **Usuarios y Accesos**.

Cada ficha de cliente admite un plan personalizado con cuotas mensuales de videos, publicaciones y pautas publicitarias. Las tareas de la sala de Edición permiten elegir la categoría y ponderar cada actividad aprobada al 30% o al 100% de una unidad contratada. La planilla suma esas unidades por mes de aprobación y calcula el porcentaje contra la cuota; no limita el resultado, por lo que un cliente puede llegar al 120% o más. Una actividad sin cliente no afecta cuotas.

La **Sala de Supervisión** está disponible en las salas de trabajo para Supervisores. Permite crear y revisar actividades, consultar responsables y estado, filtrar por cliente/tipo, y ver las cuotas mensuales actualizadas con cada aprobación. Desde allí se configuran reportes diarios, semanales o mensuales y destinatarios por correo. El reporte mensual enviado al inicio del mes corresponde al mes anterior; los reportes diario y semanal muestran el consumo del mes vigente. El envío automático requiere `SMTP_*`, el cron de Vercel y al menos un destinatario configurado o un usuario activo con permiso `receive_reports`.

## Control de Eventos y Cumplimiento (Compliance)

El sistema vigila de forma continua el cumplimiento operativo en tareas y penaliza el KPI mensual:

1. **Tareas vencidas**:
   - Monitoreo continuo de tareas abiertas cuya fecha/hora límite ha expirado.
   - Envío recurrente de notificaciones y correos al responsable y a sus superiores jerárquicos cada `COMPLIANCE_NAG_INTERVAL_HOURS` horas (por defecto 6h), dentro de la jornada laboral de Honduras (`07:00` a `19:00`, lunes a viernes).
   - Para Editores (`role: editor`), se escala a los Account Managers (`role: manager`) asignados al cliente de la tarea y a niveles superiores (`management`, `operations`, `super_admin`).
   - Para Account Managers, se escala directamente a Dirección y Administración (`management`, `operations`, `super_admin`).

2. **Meta diaria de editores**:
   - Meta estándar: **5 piezas nuevas diarias** fuera de correcciones/revisiones.
   - Evaluado al finalizar o iniciar la siguiente jornada hábil (el lunes evalúa el viernes previo).
   - Notificación de incumplimiento: *"No cumpliste con la meta diaria por lo cual eso está afectando tu rendimiento en el sistema"*, con copia a superiores.
   - Penalización en KPI: `(piezas faltantes / 5) * 20` pts (máximo 20 pts de penalización).

3. **Ritmo semanal de Account Managers**:
   - Semana laboral de Honduras: lunes 00:00 a viernes 18:00 (114 horas).
   - Se compara el porcentaje de tiempo transcurrido contra el avance de publicaciones completadas o vencidas de esa semana.
   - Las publicaciones que todavía están en plazo no generan descuentos ni aumentan los descuentos de otras tareas vencidas.
   - Penalización en KPI: `min(30, % tiempo transcurrido - % avance entregado)` pts (máximo 30 pts).

4. **Penalización acumulada y KPI**:
   - El tope de penalización por cuotas/ritmo es de 40 puntos.
   - Se deduce directamente de la calificación mensual `70/30` calculada en el sistema.
   - Si la persona subsana sus pendientes o incrementa su ritmo, la penalización se actualiza en tiempo real.

5. **Banner y Pantalla Roja de Alerta**:
   - Un banner rojo persistente (`ComplianceAlertBanner`) y un diálogo interactivo (`ComplianceAlertModal`) se activan en la interfaz de la persona afectada cuando tiene tareas vencidas, incumplimiento de meta diaria o atraso en el ritmo semanal.
   - Incluye acceso directo para abrir y completar cada tarea vencida inmediatamente.

6. **Endpoints Cron**:
   - `/api/cron/task-reminders`: Recordatorios de 24h, 8h y seguimiento recurrente por vencimiento.
   - `/api/cron/compliance-events`: Evaluación y despacho de alertas de cuota diaria de edición y ritmo semanal de accounts.

## Arquitectura

- `server/routes/auth.js`: OAuth, intercambio nativo de un solo uso y sesiones opacas revocables.
- `server/routes/collections.js`: autorizacion, validacion, integridad referencial y mutaciones SQL.
- `server/routes/cron.js`: tareas programadas protegidas con `CRON_SECRET` y locks distribuidos.
- `server/lib/compliance-events.js`: motor de evaluación y despacho de eventos de cumplimiento.
- `server/lib/task-reminders.js`: cálculo y despacho de recordatorios y escalación jerárquica.
- `server/lib/supervision-reports.js`: envío automático de reportes de cuotas por cliente.
- `src/app/utils/compliance.js`: reglas compartidas de metas, ritmo laboral, escalación y deducción de KPI.
- `src/app/utils/supervision.js`: cómputo mensual de unidades y porcentajes de cuota.
- `server/lib/audit.js`: auditoria inmutable generada por el servidor.
- `server/db/migrate.js`: migraciones versionadas y serializadas en PostgreSQL.
- `src/app/lib/firebase-*-compat.js`: adaptadores del frontend hacia la API y Firebase Auth.
- `src/app/main.jsx`: interfaz principal; las reparaciones automaticas de datos estan desactivadas.

Firestore y Firebase Hosting no exponen datos: las reglas deniegan todo y el backend sirve unicamente `public/`.

