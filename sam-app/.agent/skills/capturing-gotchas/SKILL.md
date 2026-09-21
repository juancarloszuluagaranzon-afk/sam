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

## ⏰ Un reloj adelantado deja la sync ciega (hallado 21-sep-2026) · 🔴 SIN ARREGLAR

Probando OFICIOS VARIOS, una labor recién creada **no aparecía** en `loadAssignments()`.
Causa: el **reloj de este PC va 72 s adelante** del servidor (el servidor está bien: NTP
sincronizado y coincide con la hora de Google al segundo).

`loadAssignments` guarda como marca `assignments_last_sync = new Date()` —**la hora del
aparato**— y el delta pide `updated_at >= marca − 10 s`, comparando contra la hora del
**servidor**. Con el aparato adelantado más de esos 10 s, todo lo que otros escribieron
entre dos consultas queda **antes** de la marca: el delta vuelve vacío siempre y la
pantalla solo se entera con una sincronización completa. No da error; simplemente no
llegan los cambios de los demás.

- **Arreglo** (en `services/samApi.ts`, `loadAssignments`): la marca debe salir del
  **servidor**, no del aparato — el mayor `updated_at`/`created_at` de las filas recibidas
  (y si no llegó ninguna, dejar la marca como estaba). Revisar las otras tablas que
  sincronizan igual (buscar `last_sync`).
- **Cómo medirlo**:
  ```bash
  date -u '+%H:%M:%S'; curl -sI https://www.google.com | grep -i '^date:'
  ```
  en el PC y en el VPS (`timedatectl` dice si hay NTP).
- Los celulares suelen tomar la hora de la red, pero **no todos**: uno con la hora puesta a
  mano repite el problema. Y cualquier caso de «a mí no me sale lo que el otro registró»
  debe empezar por aquí.
