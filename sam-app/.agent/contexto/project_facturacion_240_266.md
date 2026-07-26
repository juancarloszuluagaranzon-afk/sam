---
name: project-facturacion-240-266
description: SIN CERRAR — discrepancia ha ejecutada 240 vs 266 en SAM; sensible porque se facturó a 266. No decidir sin clasificar los area=0 por operario.
metadata: 
  node_type: memory
  type: project
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
---

⚠️ **Tema ABIERTO y sensible (facturación al cliente).** El dueño reportó que la misma persona (SARRIA BLANDON ESTIVEN, 2da quincena jun-2026) muestra **240** en el Resumen y **266** en el Reporte, y que **el Excel del Reporte descarga 240 aunque la pantalla dice 266**. Y **facturó al cliente a razón de 266 ha** — por eso NO se puede "corregir a 240" sin estar seguros.

## Qué es la diferencia (26 ha)
Son **labores COMPLETADAS con `area_realizada = 0`**. Dos fórmulas convivían: `executedArea` crudo (→240) vs `executedArea > 0 ? executedArea : area` (fallback al área programada, →266).

## Lo que estableció la auditoría (6 agentes, 5-jul)
- La app **solo** deja un `area=0` cuando un operario cierra al "100%" una suerte que **ya hicieron OTROS** del mismo ciclo (trabajo compartido) → ese 0 **es correcto** (el área está contada en los otros) → en ese caso **240 es lo bueno** y 266 dobla.
- Pero si el `area=0` es de una suerte que **nadie más hizo** → **sí se hizo, solo faltó capturar el área** → ni 240 (ignora trabajo real) ni 266 (adivina) son exactos: **hay que CAPTURAR el área real** de esas.
- No hubo importación masiva; el cierre normal siempre guarda área>0.

## ✅ DECISIÓN (6-jul-2026): el número es **266** (fallback), consistente en toda la app
El dueño confirmó que **a los operarios se les PAGA a razón del área de la labor COMPLETADA** aunque no se haya capturado el `executedArea`. Entonces "ha ejecutada" = `executedArea > 0 ? executedArea : area` para COMPLETADA/PARCIAL — **en TODAS partes** (Resumen, Reporte, Hoy, Facturación, tablas y **Excel**). Se descartó el 240 (crudo) porque ignora labores hechas sin área capturada.

## Lo que se hizo
- El **Excel** (`App.tsx handleDownloadReport`, col "Área Ejec.") ahora usa el mismo fallback → **Excel = pantalla = 266**.
- La columna "ÁREA" del Reporte (mixta y confusa) se **separó en dos**: **"Ha plan."** y **"Ha ejec."**.
- Pantalla ya estaba en 266 desde `ee4080f`; el bug era solo el Excel (exportaba crudo) + la columna ambigua.

## Matiz (documentado, no bloquea)
En trabajo compartido, un 2º operario que cierra al 100% algo que otros ya hicieron queda `area=0` → con el fallback cuenta su área plan. El dueño lo acepta porque **así se paga**. Un "neto por suerte" sería otra métrica aparte.

**Why:** el número alimenta el pago a operarios y la facturación (266); debe coincidir en todo.
**How to apply:** regla en `managing-assignments` (gotcha 2026-07-06). Toda vista que sume ejecutado usa el fallback.
