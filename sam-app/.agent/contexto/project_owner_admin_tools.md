---
name: project-owner-admin-tools
description: "Herramientas de gestión para propietario/administración agregadas en jun-2026 (catálogo de labores, reporte editable, planilla revisable) + landmine de la tabla `labores`."
metadata: 
  node_type: memory
  type: project
  originSessionId: 77039424-1dea-4cbc-a68d-d8a552b6ccd0
---

Entre el **15 y 16 de jun de 2026** se construyeron varias herramientas de gestión para propietario/administración en SAM/AgroMorales. El detalle técnico vive en los skills `managing-assignments` y `managing-supabase` (`sam-app/.agent/skills/`); aquí solo el contexto durable y las landmines.

## ⚠️ Landmine: la tabla `labores` (singular) NO es nuestra
Existe en Supabase una tabla `labores` (id entero serial, ~18 columnas, FK desde `recibos`, policy `operario_ver_sus_recibos`) que pertenece a un **módulo de recibos/nómina ajeno** (montado por el socio u otra persona). **NUNCA hacer DROP/ALTER de `labores`.** Por eso nuestro catálogo de tipos de labor se llama **`labores_catalogo`**. Tropezamos con esto al crear el catálogo (el `CREATE TABLE IF NOT EXISTS labores` chocó y el `DROP` falló por la FK). Antes de crear cualquier tabla nueva, verificar que el nombre no exista.

## Qué se entregó (15-18 jun 2026)
- **Catálogo de labores CRUD** (`labores_catalogo`): activar/desactivar + tipo Mecanizada/Manual. El operador de tractor solo ve mecanizadas al tomar en campo. **REPIQUE quedó DESACTIVADA y MANUAL.**
- **Vista "Realizadas"** (propietario/admin/**supervisor**): labores ejecutadas, filtros + segmentador de fecha; **consolida parciales por CICLO** (una tarjeta por corte, clic = detalle).
- **Planilla** (muchas mejoras): muestra TODOS los operarios del catálogo (trabajen o no), orden alfabético (con `.trim()` por nombres con espacio en BD); **colores** naranja=en proceso / verde=terminada + **convenciones**; **resaltado** en 4 colores pastel (`planilla_revisiones.color`); **selector de operarios visibles** (localStorage); **novedades** V/T/NP/D/P/C (`operario_novedades`) reportables por el operario o desde el nombre en la planilla; **clic en el número** = detalle de labores con editar/eliminar.
- **Aprobaciones**: TODA labor finalizada (asignada o de campo, parcial o completa) pasa a `approval='PENDIENTE'`; pestaña/bandeja **Aprobar** con badge + banner; aprueban supervisor o owner/admin. (La facturación aún suma sin filtrar por aprobación — pendiente si lo piden.)
- **Reporte editable** (dueño/admin): editar (incluida la **fecha de ejecución**) y **eliminar** líneas (DELETE real, requiere policy `asignaciones_delete`). El supervisor VE Realizadas/Reporte pero sin editar/eliminar.
- **`SearchableSelect` móvil**: abre la lista sin levantar el teclado; se toca para buscar.
- ~~Historial del operario recuerda la última selección~~ **REVERTIDO (24-jun):** ahora SIEMPRE abre en la quincena actual (sin localStorage). Ver [[project-reglas-asignaciones]].
- **Banner de pendientes viejas**: abre detalle para cancelar una/todas.

## Qué se entregó (24-29 jun 2026)
- **Cargue masivo del maestro = RECONCILIACIÓN** (no solo insertar): preview en 4 grupos (nuevas / área cambiada / desaparecidas / sin cambios), tú decides qué aplicar; desaparecidas con alcance por hacienda + aviso si tienen labor activa; reactiva suertes que reaparecen. Sin migración.
- **Registro rápido de labor realizada** (supervisor, botón en Asignar): para el ~5% de operarios poco afines a la tecnología, el supervisor anota lo que hicieron en una sola pantalla; supervisor y zona automáticos; nace COMPLETADA + APROBADA; toggle 100% (apagado por default) con el área de la suerte visible.
- **Editar ESTADO en el Reporte**: cambiar Programada/Pendiente ↔ Terminada/Parcial/Laborando; al pasar a Terminada/Parcial cae en la **bandeja de aprobación** del supervisor; ajusta fechas/área/aprobación coherentemente.
- **Barras de búsqueda** en Historial del operario y "Últimos movimientos" del supervisor.
- **KPIs/dashboards abren en la quincena actual** (Resumen/Reporte/Realizadas/Planilla/Historial operario). La franja "Hoy" de Labores sigue mostrando el día.

## Pendiente / a verificar
- **Registro REPIQUE de Julio César** (asignación `0f5878f9-d8de-4758-91b5-3463767b3bd1`, EL CEDRITO 160): era una labor manual mal registrada (LIBRE) en un operador de tractor, nunca cerrada. Se le dio el `UPDATE ... estado='CANCELADA'` — **confirmar con el usuario que lo corrió** (no quedó confirmado en chat).
- La tabla `labor_revisiones` (mig. `20260615150000`) y `samApi.*LaborRevision*` quedaron **creadas pero SIN USO** (el marcado de tarjetas de Labores se revirtió). Limpiar si estorba.

**Why:** el dueño/administración necesitan ajustar datos finales de liquidación y depurar registros errados sin depender de SQL manual.
**How to apply:** al tocar estas vistas, leer primero los skills; respetar la landmine de `labores`; aplicar migraciones en Studio ANTES del push. Ver [[feedback_persist_in_repo]] y [[feedback_fetch_before_implement]].
