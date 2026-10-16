---
name: capturing-gotchas
description: >
  Captura automáticamente errores, correcciones y aprendizajes en el SKILL.md
  correcto. Úsala cuando ocurra un error inesperado, cuando el agente corrija
  algo que falló, cuando el usuario diga "anota esto", "no olvides", "agrega
  esto al skill", "gotcha", o cuando se resuelva un bug no trivial.
---

# Capturing Gotchas — SAM

Cuando detectes un error nuevo o una corrección relevante, sigue este flujo:

## 1. Identifica el SKILL destino

| Si el error involucra... | → Skill destino |
|--------------------------|-----------------|
| Supabase, queries, mapeo de filas, RPC | `managing-supabase` |
| Estados de asignación, WORKFLOW, roles, métricas | `managing-assignments` |
| Formularios, estados, drafts, submit | `building-react-forms` |
| No encaja en ninguno | Crear nuevo skill o anotar aquí |

## 2. Formato de gotcha

```
- **[YYYY-MM-DD]** Al hacer X → ocurre Y → solución: Z
```

Máximo 2 líneas. Concreto y accionable.

## 3. Dónde insertar

En la sección `## Gotchas` del SKILL.md destino, al **inicio** de la lista (más reciente primero).

## 4. Ejecutar captura automática

```bash
python .agent/skills/capturing-gotchas/scripts/capture_gotcha.py \
  --skill managing-supabase \
  --error "descripción del error" \
  --fix "cómo se resolvió"
```

## Gotchas de este mismo skill

- **[2026-04-09]** Si el skill destino no existe todavía, créalo antes de intentar añadir la gotcha — el script falla si el path no existe

## Un componente que funciona suelto es una hipótesis (17-sep-2026)

El pad de firma se arregló y se probó **montándolo solo** en el navegador: perfecto.
El cliente: *«esto sigue sin funcionar, pruébalo primero antes de decirme que ya
está»*. Dentro del formulario real había dos fallas que el componente aislado no podía
mostrar, y el flujo completo destapó una tercera de dos meses de antigüedad.

**Antes de decir «ya está»:**
1. Entrar con un usuario **del rol que lo usa**. Usuarios de prueba (`app_usuarios.es_prueba`):
   `U039` «Operador pruebas» y `U041` «Operador Pruebas 2» (operario), `U058` «MECANICO PRUEBAS»
   (taller; se le cambia el rol por unos minutos y se le devuelve), `U040` «Supervisor Pruebas»
   (inactivo).
2. En **modo celular**, que es donde vive el cliente.
3. Hacer **el flujo completo** en la pantalla real, incluido el paso exacto que falló.
4. **Medir donde queda guardado**: la fila en la base, el archivo en el servidor. No
   la pantalla.
5. **En producción**, después del deploy, otra vez.
6. **Borrar la prueba COMPLETA, no solo la labor.** Medido el 16-oct-2026 (prueba de U039 en la
   TRC-1): rechazar la labor la saca de las hectáreas, pero su fila de `labor_sesiones` seguía
   sumando horas en Eficiencia de maquinaria y su `horometro_final` seguía siendo la lectura vigente
   de la máquina. ✅ Ya no (mismo día): Eficiencia salta las CANCELADAS y `equipo_horometro_v` las
   excluye desde `20261016150000_horometro_sin_canceladas.sql` — ver «Rechazar no es borrar» abajo.
   Igual se borra la prueba entera: deja chequeos y filas sueltas. Respaldar y borrar en orden:
   `labor_sesiones` → `chequeos` (arrastra `chequeo_respuestas`) → `asignaciones`, y verificar con
   `equipo_horometro_v` que la máquina volvió a su lectura real.

## Un push que Vercel no recibió (18-sep-2026)

`git push` con todo en orden —el commit en GitHub, el mismo autor de siempre— y producción
siguió con el bundle viejo **17 minutos**. La causa no estaba en el código: GitHub **no tenía
ningún estado de Vercel** para ese commit, ni «pendiente». El aviso no llegó.

**Cómo verlo sin entrar a Vercel** (el proyecto de SAM no está en la sesión de `npx vercel` de
este equipo, solo los de AgroControl):
```bash
curl -s "https://api.github.com/repos/<owner>/<repo>/commits/<sha>/status"   # statuses[].state
curl -s "https://<app>.vercel.app/" | grep -o '/assets/index-[^"]*\.js'      # ¿cambió el bundle?
```
Un commit desplegado muestra `success` («Deployment has completed»); sin estado = Vercel ni se
enteró. Un commit vacío (`git commit --allow-empty`) re-dispara el aviso; si tampoco llega, lo
tiene que mirar el dueño del proyecto en su tablero.

🔴 **No decir «ya está desplegado» por haber hecho push.** Confirmar que el bundle servido trae
el cambio (buscar una cadena nueva del código en el `index-*.js` de producción).

## ⏰ La sincronización por cambios tenía DOS agujeros (hallados y cerrados el 21-sep-2026)

Probando oficios varios, una labor recién creada **no aparecía** en `loadAssignments()`.
Tirando de ese hilo salieron dos fallas, independientes, que se sumaban:

**1. `asignaciones.updated_at` no se movía al editar.** La columna solo tenía `default now()`:
se llenaba al crear y nunca más (de 1.151 labores en 30 días, 4 con un `updated_at` distinto
del de creación). El delta pide `updated_at >= marca`, así que un **cierre, una aprobación o una
corrección** hechos en un aparato no llegaban a los demás. El aviso de tiempo real SÍ llegaba,
pero la recarga que dispara es ese mismo delta y volvía vacía. Solo se veía al reabrir la app
(que hace bajada completa): un supervisor con la app abierta toda la jornada no veía cerrar a
sus operarios. → Trigger `trg_asignaciones_updated_at` (migración `20260921120000`), solo si
algo cambió de verdad.

**2. La marca era la hora del APARATO.** `assignments_last_sync = new Date()` y el delta pedía
`updated_at >= marca − 10 s` contra la hora del SERVIDOR. Este PC iba **72 s adelante** (el
servidor está bien: NTP y coincide con Google al segundo): todo lo ajeno quedaba antes de la
marca. → La marca sale del mayor `updated_at`/`created_at` recibido (`marcaDeServidor`), en una
llave nueva (`assignments_marca`) para que cada aparato haga una bajada completa al actualizar.

⚠️ Al arreglar el 2 apareció un tercero: con la marca quieta, el margen de 10 s re-trae
**siempre** la última fila escrita, y `changed` salía en `true` cada 30 s — la app entera se
redibujaba sin motivo (lo que se siente como «el celular se puso lento»). Ahora solo cuenta
como cambio una fila que no estaba o cuyo `updatedAt` es otro.

**Cómo probarlo** (en el navegador, sin sesión): crear una labor, borrarla de Dexie para
simular que la hizo otro aparato, y llamar `loadAssignments()`; luego editarla directo con
`supabase.from(...).update` y volver a llamar. Ojo: la propia pestaña recibe el aviso de tiempo
real y aplica el cambio antes, así que `changed` puede salir `false` aunque todo funcione —
llamar justo después de escribir, antes de los 500 ms del debounce.

**Cómo medir un reloj:** `date -u '+%H:%M:%S'; curl -sI https://www.google.com | grep -i '^date:'`
en el aparato y en el VPS (`timedatectl`). Cualquier «a mí no me sale lo que el otro registró»
empieza por aquí.

## Rechazar no es borrar: lo que ya salió de la labor sigue vivo (16-oct-2026)

Rechazar deja la labor en `estado = 'CANCELADA'` + `aprobacion = 'RECHAZADA'`, y **todo lo que
lee `asignaciones` filtrando por estado** la suelta solo (hectáreas, planilla, Resumen). Pero hay
dos clases de lectores que no se enteran:

1. **Tablas de eventos inmutables.** `labor_sesiones` guarda el tramo al CERRAR y nunca se
   actualiza: no sabe que después la labor se rechazó. No tiene FK a `asignaciones`
   (`asignacion_id` es texto), así que tampoco se puede embeber el estado — hay que cruzarlo a
   mano. Eficiencia de maquinaria (`loadHorasPorRangoMes`) ahora salta las CANCELADAS.
2. **Vistas con varias fuentes en `UNION`**, donde cada rama lleva su propio filtro.
   `equipo_horometro_v` filtraba `CANCELADA` en solicitudes y `ANULADA` en órdenes, pero no en
   labores. Al copiar una rama para agregar una fuente, revisar el filtro de estado de cada una.

Medido ese día: **55 labores canceladas** (41 rechazadas; de las 14 canceladas sin rechazo, 6 con
tramo tienen una gemela COMPLETADA con el mismo horómetro — eran duplicadas); 45 tramos de 44 de ellas en `labor_sesiones` = 68,5 h sumables;
47 con horómetro final entraban a la vista. Y muchas se rechazan justo POR el horómetro
(`4490 → 1190`, `10733,2 → 1073,5`): son las lecturas que menos deben servir de referencia.

⚠️ **Sigue igual**: `equipo_horometro_dudoso_v` (la lista de lecturas descartadas del taller)
todavía lista lecturas de labores canceladas. Es solo una lista para revisar, no una referencia.

🔴 **Al agregar un lector nuevo de algo que nace de una labor** (horas, horómetro, combustible
por labor): preguntarse qué pasa si la labor se rechaza mañana.

**Cómo medirlo** (sin tocar nada): con la llave anon de `sam-app/.env`, traer `asignaciones`
(`id,estado`) y `labor_sesiones` (`asignacion_id,horas,...`) completas — el servidor no recorta
filas — y cruzar por id en Node. La vista se comprueba replicándola en JS y comparando contra
`equipo_horometro_v`: el 16-oct las 23 máquinas dieron igual, prueba de que la migración
`20260918140000` era la definición vigente.
