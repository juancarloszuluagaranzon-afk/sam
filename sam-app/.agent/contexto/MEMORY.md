# USO: leer al inicio de cada sesión. Al ver el output del hook `[sam-sync]`, contrastar SHA contra `project_deploy_guarantee.md`. Si el usuario menciona algo ya documentado, NO re-preguntar — abrir la memoria relevante y referenciarla.

## Quién es y cómo trabaja

- [Perfil del usuario — Ivan García](user_profile.md) — rol, accesos, preferencias, qué le importa

## Producto y operación

- [AgroMorales = SAM](project_app_branding.md) — misma app, +50 usuarios, blindajes (cache, versión, diagnóstico, realtime) y riesgos vivos
- [VPS infrastructure & operación](project_vps.md) — Supabase self-hosted en Hostinger desde 9-may-2026, backups 03:00, UptimeRobot, firewall = riesgo recurrente
- [Migración y incidentes mayo 2026](project_history_incidents.md) — cronología 9/13/14/15/19-may + entregables del 19-may (DELETE 247→76, commit 8dc2535)
- [Garantía de deploy + versión visible](project_deploy_guarantee.md) — YA implementado en main; archivos productivos y cómo verificarlo
- [Contrato de sincronización entre dispositivos](project_sync_contract.md) — 7 capas + gotcha de DELETE-via-delta-sync
- [Autonomía del usuario sobre la BD](project_user_db_autonomy.md) — Supabase Studio + plantillas SQL (incl. **auditoría**); ⚠️ apagar la **extensión traductora** o ningún SQL corre
- [Claves Supabase NO se rotan — decisión consciente](project_pending_key_rotation.md) — usuario aceptó riesgo el 19-may; verificar `.env` antes de cualquier restart del stack
- [Herramientas propietario/admin jun-2026](project_owner_admin_tools.md) — catálogo de labores, reporte editable + **editar ESTADO**, planilla, **cargue masivo con reconciliación**, **registro rápido de labor** + ⚠️ landmine: la tabla `labores` (singular) es del módulo recibos, NO tocar (usar `labores_catalogo`)
- [⚠️ Código de hacienda compartido en maestro](project_maestro_codigo_compartido.md) — código `1`+`mayaguez` lo usan LA FLORESTA TASCON y Santa Fe; filtrar SIEMPRE por `nombre_hacienda`
- [Submenú Catálogos + Empresas/Terceros](project_catalogos.md) — Empresas = solo visual (NO ligar a operador); Terceros asignables a suertes vía `tercero_id`
- [Módulo Insumos y Combustible](project_insumos_modulo.md) — fases 1-4 HECHAS (inventario/kardex, solicitudes, despachos con evidencia + máquina, **aval del operario 1-toque** 11-jul); falta reporte de consumo/stock bajo
- [Reglas de Activas/dashboards/usuarios jun-2026](project_reglas_asignaciones.md) — 72h vencen Activas, NO duplicar programadas (reusar línea), KPIs en quincena actual, activar/desactivar + RLS de inactivos
- [Rendimiento/productividad del operario](project_rendimiento_operario.md) — KPI quincenal (jornadas cumplidas, cliente-only) + meta ha/día por labor + felicitación configurable (imagen/GIF) al ≥100%
- [✅ Facturación 240 vs 266 — RESUELTO](project_facturacion_240_266.md) — ha ejecutada = 266 (fallback `executedArea||area`) en TODA la app; así se paga a operarios. Excel corregido + columna del Reporte separada en "Ha plan."/"Ha ejec.".
- [Auditoría integral jul-2026](project_auditoria_2026jul.md) — 6 agentes; qué se corrigió (facturación, sync/offline, roles, BD), qué quedó diferido, y ⚠️ postura de seguridad real (anon_key, PINs semilla en repo)
- [✅ Módulo Mapas offline + auditoría de rendimiento](project_mapas_offline_propuesta.md) — IMPLEMENTADO: visor de CAPAS (Leaflet estático + tiles FieldMaps + descarga offline por capa + reemplazo de cartografía + gestión solo admin/jefe); skill del repo `managing-mapas`; 🔴 incidente pantalla blanca (NO lazy chunks) y quick wins de perf pendientes (#1-#4, #7)

- [Módulo Flota/Escolta (CDA-F-68) + compresión de fotos](project_flota_escolta.md) — rol `conductor`, registro de servicio con firma táctil + foto liviana, export Excel CDA-F-68; **compresión de imágenes en TODO el app** (`imagenLigera.ts`, fotos ~20-80KB vs 2-5MB)

## Referencias rápidas

- [Repositorio SAM — layout y rama](reference_repo_layout.md) — paths, remote, rama productiva, hook de auto-sync
- [Servicios externos](reference_external_services.md) — Hostinger hPanel, UptimeRobot, backups, Studio, Cloud legacy

## Reglas de comportamiento (feedback acumulado del usuario)

- [SIEMPRE git fetch antes de tocar código](feedback_fetch_before_implement.md) — regla férrea tras el incidente del 19-may; hook automático configurado en `.claude/`
- [Direct action when context is given](feedback_direct_action.md) — no re-preguntar lo que ya quedó claro; ir directo a la solución
- [Persistir contexto en README + skills](feedback_persist_in_repo.md) — cuando el usuario explique panorama operativo, dejarlo también en README/skills, no solo en memoria
- [Reportar versión vigente](feedback_report_version.md) — al final de cada implementación/deploy, indicar siempre qué `__APP_VERSION__` quedó activa
- [Seguridad NO es prioridad ahora](feedback_security_low_priority.md) — no sacar el tema de claves filtradas sin que el usuario lo pida
- [Área siempre como ejecutada / asignada](feedback_area_ejecutada_asignada.md) — en toda tarjeta de labor mostrar `ejec / asignada` separadas por `/`, nunca solo ejecutada
- [Probar programadas Y campo](feedback_test_programadas_campo.md) — todo cambio en labores debe verificarse en ASIGNADA (programada) y LIBRE (tomada en campo); + regla: migración de columna nueva ANTES del deploy (rompe toda edición si no)
