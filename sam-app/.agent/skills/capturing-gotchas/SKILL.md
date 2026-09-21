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
1. Entrar con un usuario **del rol que lo usa** (`U058` es el de pruebas; se le cambia
   el rol por unos minutos y se le devuelve).
2. En **modo celular**, que es donde vive el cliente.
3. Hacer **el flujo completo** en la pantalla real, incluido el paso exacto que falló.
4. **Medir donde queda guardado**: la fila en la base, el archivo en el servidor. No
   la pantalla.
5. **En producción**, después del deploy, otra vez.
6. Borrar la prueba.

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
