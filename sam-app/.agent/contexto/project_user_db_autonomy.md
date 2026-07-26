---
name: Usuario quiere autonomía sobre la base de datos
description: Al 19-may-2026 el usuario pidió poder gestionar/eliminar datos sin depender de mí. Plan: Supabase Studio como herramienta principal + plantillas SQL reusables
type: project
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Pedido del usuario**

"Quiero poder eliminar o gestionar cosas en la base de datos sin depender de ti".

**Solución propuesta y aceptada**

Usar **Supabase Studio** (ya corriendo en el VPS, contenedor `supabase-studio`).

URL probable: `https://supabase.surcoapp.tech` (a confirmar — si Kong no lo enruta en raíz, exponerlo en `/studio` vía Caddy, o crear subdominio `studio.surcoapp.tech`).

Credenciales: `DASHBOARD_USERNAME` y `DASHBOARD_PASSWORD` en `/opt/supabase/docker/.env`.

**Capacidades que el usuario tendrá**

- **Table Editor:** browse + edit + delete fila por fila sin SQL.
- **SQL Editor:** queries libres con historial y guardados.
- **Database:** ver schema, índices, foreign keys, triggers.

**Plantillas SQL que se le pasaron**

- Conteo + rango de fechas.
- Distribución por tipo/estado.
- Backup interno (`CREATE TABLE bk AS SELECT *`).
- DELETE con BEGIN/COMMIT/ROLLBACK.

**Niveles de autonomía**

1. Básico: Table Editor en Studio (Excel-like, click derecho).
2. Intermedio: SQL Editor con plantillas guardadas.
3. Avanzado: `docker exec supabase-db psql` por SSH para automatización.

**Reglas que se le dieron para no romper**

1. Backup antes de DELETE/UPDATE masivo (pg_dump o CREATE TABLE bk).
2. BEGIN/COMMIT + ROLLBACK como red de seguridad.
3. Verificar WHERE con SELECT antes de convertirlo a DELETE.
4. Si duda, preguntar.

**⚠️ El TRADUCTOR de Chrome daña TODO el SQL (15-jul-2026):** una extensión de traducción reescribe el editor de Studio (`select→seleccione`, `from→de`, `coalesce→fusionarse`, `created_at→creado_en`, y `area→área` **con tilde** → "la columna área no existe"). **Ningún SQL corre con eso activo** y no hay forma de escribirlo para esquivarlo. Antes de pasarle SQL: recordarle apagar la extensión en `chrome://extensions` (el toggle de traducción integrado de Chrome NO basta). Me confundió a mí también (le sugerí `creado_en` creyendo el texto traducido).

**Plantillas de AUDITORÍA para que investigue solo (15-jul-2026):**
- *"¿Quién cambió esta labor?"* → en la app: **Editar → "Ver historial"**. Si solo sale "Creación" nadie la editó. Ver [[project_reglas_asignaciones]].
- *Auditoría por SQL (ojo con los tipos: `asignaciones.id` es uuid, `asignacion_id` es text):*
  ```sql
  select s.nombre_hacienda, s.numero_suerte, s.labor_nombre, au.accion, au.cambios,
         coalesce(u.nombre_completo,'sistema') as quien, au.editado_en
  from public.asignaciones_auditoria au
  join public.asignaciones s on s.id::text = au.asignacion_id
  left join public.app_usuarios u on u.id::text = au.editado_por
  where au.asignacion_id in ('<uuid>') order by au.editado_en;
  ```
- *Datos incoherentes (debe dar 0 filas):* `select … from asignaciones where estado in ('PENDIENTE','EN_PROCESO') and coalesce(area_realizada,0) > 0;`
- **La auditoría solo tiene lo posterior a su instalación** — para filas viejas usar `created_at`, `fecha_inicio`, `tipo_registro`, `editado_por` del propio registro.

**Why:** El usuario explícitamente pidió no depender de mí para gestionar datos. Dárselo es darle agencia operacional. Studio es la herramienta nativa de Supabase, no requiere desarrollo adicional.

**How to apply:**

- Cuando el usuario diga "necesito borrar/cambiar X en la base": primero confirmar si ya puede hacerlo en Studio él mismo; ofrecer una plantilla SQL en lugar de ejecutarlo yo.
- Si tiene operaciones destructivas: insistir en backup + BEGIN/COMMIT antes de ejecutar.
- Si reporta que Studio no abre / no carga: ese es el siguiente paso a destrabar (Caddy + DNS si toca, o tunel SSH como alternativa rápida).
- Para automatizaciones recurrentes: scripts SQL en `/root/scripts/` en el VPS, ejecutables con `docker exec -i supabase-db psql -U postgres -d postgres -f /root/scripts/<nombre>.sql`.
