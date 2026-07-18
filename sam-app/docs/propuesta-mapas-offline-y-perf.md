# Propuesta: Mapas offline tipo Avenza en ASM + Auditoría de rendimiento

> **ESTADO (18-jul-2026): IMPLEMENTADO Y EN PRODUCCIÓN** con ajustes sobre esta
> propuesta: imports ESTÁTICOS en vez de lazy (el chunk aparte rompió el build de
> Vercel — pantalla blanca 17-jul), visor de CAPAS múltiples superpuestas con
> opacidad individual, gestión autoservicio (solo admin/jefe) con reemplazo de
> cartografía, y formulario compartido también desde el visor. La referencia
> técnica VIVA del módulo es **`.agent/skills/managing-mapas/SKILL.md`** — este
> documento queda como registro de la propuesta y de la auditoría de rendimiento
> (cuyos quick wins #1-#4 y #7 siguen pendientes).

> Elaborada la noche del 17-jul-2026 con 5 agentes expertos (bundle, runtime, red/sync,
> código FieldMaps, estado del arte offline-maps 2026). Decisión pendiente de aprobación.

## PARTE 1 — Mapas offline en ASM (recomendación única)

### Hechos que definen la solución
- FieldMaps YA produce todo lo necesario: el worker GDAL convierte el GeoPDF en
  **tiles PNG XYZ estándar** (256px) subidos al bucket **público** `tiles` de su propio
  Supabase (VPS FieldMaps), con `Cache-Control` de 1 año. URL patrón:
  `https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/{org}/{map}/{z}/{x}/{y}.png`
- Mapa RIOPAILA: 1.118 tiles, maxzoom 16 (+4 de overzoom visual), ~40–50 MB estimados.
- El visor de FieldMaps usa maplibre-gl (~275 KB gzip). Para el caso de uso de ASM
  (raster + GPS + marcadores + medición simple) **Leaflet (~42 KB gzip) + plugins hace lo mismo 7× más liviano**.
- ASM no debe cargar su servidor ni su arranque: los tiles salen del stack de FieldMaps
  (GETs estáticos cacheables) y el visor va en un **chunk lazy** que no toca el arranque.

### La opción más viable (Fase 1 — implementable en 1–2 días)
**Módulo "Mapa" dentro de ASM, lazy-loaded, con Leaflet + los tiles ya existentes de FieldMaps, y descarga offline explícita tipo Avenza.**

1. **Visor** (`React.lazy` → chunk separado ~50 KB gzip):
   - Leaflet + capa raster del GeoPDF (tiles FieldMaps) + toggle satélite (Esri World Imagery, igual que FieldMaps) + opacidad del overlay.
   - Config del mapa (bounds/min/maxzoom/prefijo) **hardcodeada o en un `meta.json`** en el
     mismo bucket público — sin auth, sin tocar la BD de FieldMaps.
2. **Offline total (modelo Avenza):** botón **"Descargar mapa"** → baja la lista de
   ~1.118 tiles a **Cache Storage** con barra de progreso (concurrencia 8; ~40–50 MB una sola vez)
   + `navigator.storage.persist()`. Gestor "Mis mapas" con tamaño y botón borrar.
   El visor sirve tiles cache-first → **funciona 100 % sin señal**.
3. **GPS eficiente:** `watchPosition` con high-accuracy **solo mientras el visor está abierto**
   (cleanup al salir y al ir a background). Punto azul + círculo de precisión (código portable
   de FieldMaps `gps.ts`). Wake lock **opt-in** ("mantener pantalla activa"). **Cero GPS
   cuando el mapa está cerrado** — el resto de ASM no cambia.
4. **Impacto en ASM:** arranque +0 KB (chunk lazy); servidor ASM +0 requests (tiles van al
   stack FieldMaps y luego a caché local); el rendimiento normal queda intacto.
5. **Impacto en FieldMaps/VPS:** solo GETs de archivos estáticos con caché de 1 año —
   despreciable (y cada dispositivo los baja UNA vez).

### Fase 2 (mejora opcional, cuando haya varios mapas)
Convertir cada mapa a **UN archivo `.pmtiles`** (`pmtiles convert`, encaja con el pipeline GDAL)
subido al mismo bucket → descarga de un solo archivo con progreso a OPFS (más robusto para
mapas grandes/múltiples; Supabase Storage soporta range-requests). El visor Leaflet lee PMTiles
con `pmtiles-js` (~7 KB). La UI de Fase 1 no cambia.

### Qué se descartó y por qué
- **Iframe/enlace a FieldMaps:** no cumple offline dentro de ASM, doble login, UX rota.
- **Copiar el visor maplibre de FieldMaps tal cual:** +275 KB gzip vs 42 KB de Leaflet;
  maplibre solo se justifica con tiles vectoriales/rotación 3D que no se necesitan.
- **Backend nuevo o mover tiles al Supabase de ASM:** carga el servidor de ASM sin necesidad.

## PARTE 2 — Auditoría de rendimiento de ASM (3 expertos)

### Veredicto general
**La base es sólida** — la app abre de caché en <50 ms, el delta sync + Dexie + versionado
del maestro + xlsx lazy + precache por hash están bien diseñados. Los problemas son
puntuales y corregibles; ninguno es incendio, pero 3 son de impacto alto.

### Hallazgos TOP (priorizados)
| # | Hallazgo | Impacto | Esfuerzo |
|---|---|---|---|
| 1 | **Re-render de TODA la app cada 30 s** (poll) y con cada evento realtime: `loadAssignments` siempre devuelve array nuevo y el `value` del contexto no está memoizado → los 20 consumidores se re-renderizan aunque nada cambie. Micro-freeze periódico en gama baja. | ALTO (jank global) | Medio |
| 2 | **Listas sin tope + `maestro.find` (15K) por ítem en render** (Labores con filtro Completada puede pintar miles de `<li>` × 15K comparaciones). Congelamiento de 1–3 s. Fix: `Map` indexado del maestro + `slice(0,50)`/"ver más". | ALTO (freeze al filtrar) | Bajo |
| 3 | **Cada tecla del buscador re-renderiza App + SupervisorView (4.000 líneas)** — `laborSearch` vive en App.tsx; con filtro de ingenio es O(1.000×15K) por tecla. Fix: `useDeferredValue` + Map indexado. | ALTO (lag al escribir) | Bajo-medio |
| 4 | **Primer arranque bloquea el Login hasta terminar 10 fetches** (incluido maestro 15K) — 10–30 s en señal rural. Fix: login primero, catálogos después. | ALTO (primera instalación) | Medio |
| 5 | **Full sync de asignaciones ×2 con `select('*')` en cada apertura** (~250 KB, filas duplicadas entre las 2 queries). Fix: columnas explícitas + deduplicar. −30/50 % del payload más gordo. | MEDIO (datos móviles) | Bajo |
| 6 | **Landmine:** si `PGRST_DB_MAX_ROWS` vuelve a 1000, la paginación del maestro se trunca **silenciosamente** a 1.000 de 15K. Fix: `limit` explícito por página. | MEDIO (riesgo config) | Bajo |
| 7 | **Invalidación del maestro todo-o-nada:** una edición de suerte → los 50 dispositivos re-bajan 15K filas (~100 MB de pico al VPS a las 6 am). Fix: delta por `updated_at` (la columna ya existe). | MEDIO (pico VPS) | Medio |
| 8 | **Iconos sin optimizar en precache** (favicon 82 KB, pwa-512 129 KB...) → ~250 KB gratis en primera instalación. | BAJO | Trivial |

Consumo de datos actual estimado: **~2–3 MB/día por operario (~50–80 MB/mes)** — razonable,
pero los hallazgos 5 y 7 son los que pueden duplicarlo.

### Orden recomendado de quick wins
1. #8 iconos (30 min) → 2. #5 columnas explícitas → 3. #6 límite de página → 4. #2+#3 (Map
indexado + deferred search) → 5. #1 (memo del contexto + bail por igualdad) → 6. #4 (login
primero) → 7. #7 (delta maestro). Todo verificable con: rol operario Y supervisor, labores
ASIGNADA y LIBRE, online y offline.

## Decisiones pendientes del dueño/Iván
1. ¿Aprobar Fase 1 de mapas (visor Leaflet + tiles FieldMaps + descarga offline)?
2. ¿Quién ve el mapa? (propuesto: todos los roles, entrada en menú del operario y en Más del supervisor)
3. ¿Arrancamos también los quick wins de rendimiento (orden de arriba)?
