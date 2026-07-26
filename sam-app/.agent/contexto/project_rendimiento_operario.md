---
name: project_rendimiento_operario
description: Gamificación de productividad del operario — KPI rendimiento quincenal + metas ha/día por labor + felicitación configurable (imagen/GIF)
metadata:
  node_type: memory
  type: project
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
---

Pedido del cliente (12-jul-2026, commit `c9e03ef`, mig. `20260712120000_rendimiento_operario`): motivar a los operarios (les pagan por productividad). Implementado:

- **Meta ha/día por labor**: columna `labores_catalogo.meta_ha_dia`. Se edita **en línea** en Catálogos → Labores (nueva columna "Meta ha/día"). `Labor.metaHaDia`. `loadLabores/createLabor/updateLabor` usan `select('*')` (no rompe si la columna no está migrada).
- **KPI rendimiento quincenal** en la vista del operario (OperatorView, tab Activas), **calculado 100% en el cliente** (cero carga BD) desde `quincenaHistory` + metas. Modelo "jornadas cumplidas" = Σ(ejecutado_labor / meta_labor); **rendimiento% = jornadas / días hábiles transcurridos** de la quincena (excluye domingos). Muestra %, barra, "Hoy X ha (pct%)" con ✓ si cumplió el día. Maneja multi-labor (cada labor con su meta). Solo aparece si hay metas configuradas.
- **Felicitación configurable**: tabla `motivacion` (fila única id='default': mensaje, imagen_url, umbral=100, activo). Se edita en Catálogos → **🏆 Motivación** (owner/admin, `MotivacionTab`) con vista previa; imagen/GIF sube al bucket `avatars` prefijo `motivacion/` (`uploadMotivacionImagen`, máx 3 MB). Se muestra al operario cuando `rendimiento.pct >= umbral` (default 100%) con tarjeta verde degradada + imagen + mensaje. Contexto expone `motivacion/setMotivacion` (carga en el load global).

**Decisiones del usuario (AskUserQuestion):** meta POR LABOR (no global), felicitar al **≥100% de la quincena** (no diaria), **un** GIF/imagen configurable (no varios por nivel). Verdicto de peso dado al usuario: **liviano** (KPI sin backend; 1 columna; 1 imagen en Storage ya existente; GIF < 1-2 MB recomendado).

- **Indicador DIARIO** (12-jul, commit `47e918a`, mig. `20260712130000`): además del %, la tarjeta muestra **Promedio por día** (= ha_quincena / días trabajados distintos) y **Último día trabajado** (ha del último día < hoy + fecha), cada uno con ✓ "Muy bien" si ≥ `meta_dia_ref`. Es ha/día PLANO (no ponderado por labor) contra una referencia configurable (`motivacion.meta_dia_ref`, default **15**, editable en Motivación). **Aplica aunque NO haya metas por labor** (solo necesita días trabajados) — así el operario siempre ve su promedio diario. El cliente lo pidió: "buen indicador = >15 ha/día y que el promedio de días vaya >15; mostrar cómo terminó el día anterior".

Pendiente/futuro posible: excluir días con novedad (vacaciones/enfermedad) del denominador de días hábiles; varias imágenes por nivel. Relacionado con [[project_reglas_asignaciones]] (quincena actual), [[project_insumos_modulo]] (mismo patrón de Storage/config).
