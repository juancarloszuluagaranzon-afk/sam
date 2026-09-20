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
