# Cambios

## Rendimiento

- El KPI pondera la carga asignada: 70% es lo entregado y 30% es lo entregado a tiempo. Una entrega tarde suma crédito y no le resta lo ya ganado a las demás.
- El crédito de una tarea terminada queda con quien la tenía en ese momento. Reasignarla después no mueve el rendimiento al nuevo responsable.
- El editor cuenta como entrega al pasar a revisión interna. Si la tarea vuelve a edición, queda pendiente otra vez y suma una corrección.
- Hacen falta 5 tareas con fecha de entrega comprobable para que la medición deje de ser provisional.
- Inicio y Rendimiento usan el mismo cálculo para accounts, edición y gestión.
- La meta diaria del editor y el avance semanal del account restan puntos del KPI cuando se quedan atrás, y el supervisor recibe el aviso.
- El tiempo de cada etapa entra en el rendimiento de quien la hizo. Producción, elaboración, revisión y aprobación ajustan un 25% de la nota. Usar hasta el 40% del plazo deja el ritmo en 100; pasarse del 120% lo deja en 0. La espera en la cola no cuenta. Sin tiempos medidos, la nota sigue en 70/30.

## Tareas

- Mover una tarjeta guarda en el servidor el estado y el orden de la columna. El servidor escribe las fechas del cambio, así que el cliente no puede inventar una entrega.
- La hora de vencimiento, si no se indica otra, queda en las 17:00.
- Una tarea de account o de edición puede repetirse en varias fechas según la recurrencia elegida.
- En Sala de edición y en Sala de producción, “En revisión” es una columna aparte.
- Cada cliente tiene un responsable. Al crear una tarea y elegir el cliente, Account se llena con esa persona y la tarea queda asignada a ella. En una tarea de account, el chip de Account y el asignado son el responsable. Al editar, solo se llena Account.
- El campo del cliente se llama “Responsable (opcional)”.
- En el detalle de la tarea se puede cambiar el account, con permiso de asignación.
- Los archivos de la tarea se separan en material y entrega del editor. En el contenido, las imágenes y los videos se ven en grande, marcados como Material o Editor.
- Cada visita de una tarea guarda cuánto duró, quién entró y quién la cerró. En el detalle, la sección Tiempos muestra producción, revisión y aprobación. Si la tarea es anterior al registro, el tiempo se estima con las fechas de estado.

## Chat y archivos

- Hay mensajes directos entre dos personas, con un identificador propio y validación de quién participa.
- Una tarea se puede compartir en un chat de cliente o de equipo.
- El chat muestra quién está en línea. La sesión envía un latido y registra la desconexión.
- Se pueden grabar notas de voz y adjuntarlas a la tarea o al chat, con su duración. Los formatos de audio del grabador se aceptan igual.
- Subir un archivo de chat exige pertenecer a esa conversación. Un manager o un super admin puede hacerlo con supervisión.
- El tamaño máximo de subida pasó a 1 GB.

## Reportes y actividad

- Rendimiento puede verse en las últimas 24 horas y descargar el reporte diario en PDF.
- El PDF sale de la captura de las secciones del reporte, parte las páginas largas y avisa si la generación falla.
- En reportes hay un botón para actualizar los datos, buscar usuarios y desactivar una cuenta. Nadie puede desactivar la propia.
- Abrir una notificación carga la tarea si todavía no está en pantalla.
- Cada apertura y movimiento de tarea queda en un registro de actividad.
- Los recordatorios de tareas y los avisos de cumplimiento salen por correo y por notificación push.

## Plataforma

- La app se puede instalar como PWA, con manifiesto, iconos y un service worker que deja usable la navegación sin conexión.
- Los mensajes del chat se actualizan solos cada 10 segundos mientras la pestaña está visible, y al instante cuando llega un push. La notificación web y la de la PWA abren el aviso y refrescan el chat.
- El correo de la sesión sale solo del token de Firebase, y la cuenta cuenta como verificada únicamente si Firebase lo marca así.
- Cambiar el account de una tarea exige permiso de asignar tareas.
