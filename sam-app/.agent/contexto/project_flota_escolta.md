---
name: project_flota_escolta
description: Módulo Flota/Escolta (CDA-F-68) + compresión de fotos en todo el app
metadata: 
  node_type: memory
  type: project
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
  modified: 2026-07-23T04:54:06.322Z
---

**Módulo Flota / Escolta (CDA-F-68) — implementado 23-jul-2026, commit `f22fbdd`, migración `20260723120000_flota_escolta`.**
Control de las camionetas de escolta que alquila AgroMorales (flota NO propia). Origen: formato Excel CDA-F-68 "Control de transporte flota no propia" que trajo el usuario. Campos del formato: fecha, tipo servicio, centro de costo, proceso solicitante, nombre pasajero, origen, destino, hora salida/llegada origen/destino, hora espera, # peajes, otros gastos, total km, observación.

- **Rol nuevo `conductor`** (vista propia `FlotaView`, como `supervisor_insumos`). Wireado en: `domain/sam.ts` (Role), `samApi.mapRole`, `App.tsx` (routing), getRoleLabel (ImpersonationBar/OperatorView/SupervisorView), dropdown Usuarios, SupportSwitcher (grupo Conductor).
- **`FlotaForm`**: registro de servicio con TODOS los campos CDA-F-68 + **comprobante**: firma táctil (`FirmaPad`) con nombre del firmante + foto de evidencia. Origen/destino obligatorios.
- **`FlotaTab`**: lista con rango de fechas (default mes), búsqueda, ver foto/firma, **anular** (soft, estado ANULADO), y **export a Excel formato CDA-F-68** (solo admin). Con `conductorScope` = vista del conductor (sus servicios); sin scope = admin ve todos. Acceso admin: SupervisorView → Más → 🚙 Flota/Escolta.
- API: `loadFlotaServicios/createFlotaServicio/anularFlotaServicio/uploadImagenFlota` en samApi. Tabla `flota_servicios` (RLS permisivo, select('*') resiliente).
- ⚠️ Iván debe correr la migración en Studio (traductor apagado) y crear usuarios rol Conductor.

**COMPRESIÓN DE FOTOS EN TODO EL APP — commit `f49806a` (23-jul):** el usuario pidió que NINGUNA foto llene el servidor. Antes NINGUNA subida comprimía (fotos crudas 2-5 MB). Nuevo `src/lib/imagenLigera.ts`: `comprimirImagen(file, opts)` (Canvas + toBlob JPEG; `createImageBitmap(file,{imageOrientation:'from-image'})` corrige EXIF; salta GIF/no-imagen; no empeora imágenes ya chicas; opción maxBytes baja calidad por pasos). Perfiles `PERFIL_IMAGEN`: evidencia (1000px/0.5/~90KB), avatar (512px/0.7), motivacion (1200px/0.7). Aplicado en las 3 funciones de subida de samApi: `uploadEvidencia` (despachos insumos), `uploadUserPhoto` (avatar), `uploadMotivacionImagen` (salta GIF). Resultado: fotos ~20-80 KB vs 2-5 MB (50-100× más livianas). `FirmaPad` (componente firma táctil, Pointer Events, exporta JPEG ~10-20KB). Puntos de foto en el app: BandejaInsumosTab (evidencia despacho + entrega directa), OperatorView/SupervisorView (avatar), MotivacionTab (imagen/GIF), y ahora FlotaForm (evidencia+firma) — TODOS pasan por compresión.
Relacionado: [[project_insumos_modulo]] (mismo patrón proof-of-delivery con firma/foto).