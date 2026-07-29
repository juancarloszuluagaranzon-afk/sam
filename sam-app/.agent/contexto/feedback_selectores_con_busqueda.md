---
name: feedback_selectores_con_busqueda
description: Regla permanente — toda lista larga usa SearchableSelect (escribir para filtrar) + insumos frecuentes
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
  modified: 2026-07-29T02:00:35.070Z
---

**NUNCA usar un `<select>` plano para listas largas** (operarios, insumos, máquinas, suertes, usuarios…). Siempre **`<SearchableSelect>`** (`src/components/SearchableSelect.tsx`): se escribe y va acotando. Acepta `disabled` y opciones con `rightLabel` (ej. stock) y `frecuente`.

**Why:** el cliente reclamó (28-jul-2026) que el desplegable de operarios en Entrega directa mostraba los ~40 nombres de golpe y "satura visualmente"; en celular es inusable. Pidió expresamente que **quede implementado para todo lo que se haga de ahora en adelante** — "para que nunca más volvamos a fallar con esto".

**How to apply:** al terminar CUALQUIER formulario, revisar selector por selector antes de darlo por hecho. Si la lista puede pasar de ~10 ítems → SearchableSelect. Regla escrita también en `CLAUDE.md` del repo (punto 5b) para que viaje a cualquier sesión, incluida la del celular.

**Frecuentes (mismo pedido):** las listas de insumos muestran solo los marcados como frecuentes (4-6 de uso diario) y el resto va detrás de **"⋯ Otros (N)"**; al escribir se busca en TODOS. Sale de la columna `insumos.frecuente` (migración `20260728130000_insumos_frecuentes`), se marca desde Inventario → menú ⋯ → "⭐ Marcar como frecuente". El patrón `frecuente` del componente sirve para cualquier catálogo, no solo insumos.

Relacionado: [[project_insumos_modulo]], [[feedback_direct_action]].
