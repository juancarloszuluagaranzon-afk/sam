---
name: managing-mapas
description: >
  Módulo de mapas offline tipo Avenza en ASM (visor de capas Leaflet + tiles de
  FieldMaps + descarga a Cache Storage). Úsala cuando toques MapaView, MapasTab,
  MapaFormModal, mapaOffline.ts, la tabla `mapas`, o el usuario mencione "mapa",
  "capas", "offline", "tiles", "FieldMaps", "cartografía" o "GPS".
---

# Managing Mapas — SAM (visor offline tipo Avenza)

## Arquitectura (decidida 17/18-jul-2026, auditoría con 5 agentes)

ASM **NO genera ni sirve tiles**. Los tiles XYZ (PNG 256px) los produce el worker
GDAL de **FieldMaps** (otra app de Iván, VPS propio) y viven en su bucket
**público** con `Cache-Control` de 1 año:

```
https://api.mapview.surcoapp.tech/storage/v1/object/public/tiles/{org_id}/{map_id}/{z}/{x}/{y}.png
```

ASM solo guarda la **config** de cada mapa en su tabla `mapas` (migración
`20260717120000_mapas_offline`): `nombre, tiles_base, bounds jsonb
[minLon,minLat,maxLon,maxLat], minzoom, maxzoom, activo`. Cargada **on-demand**
(`loadMapas`, nunca en el arranque). Org de Iván en FieldMaps:
`d2598200-c647-4ffe-b73e-32dc92d8072d`; la tabla `maps` de FieldMaps usa la
columna `nombre` (no `name`) y bounds como array Postgres `{a,b,c,d}` → convertir
a jsonb `[a,b,c,d]`. Flujo para cartografía nueva: subir GeoPDF a FieldMaps →
tomar org/map id → registrar en ASM.

## Piezas

| Pieza | Rol |
|---|---|
| `src/views/MapaView.tsx` | Visor de **CAPAS**: varios mapas al tiempo, superpuestos (zIndex 10+i por orden del catálogo), opacidad individual, fitBounds a la UNIÓN de capas activas al prender una. Base satélite Esri (`{z}/{y}/{x}` — orden Esri). El mapa Leaflet se monta UNA vez; las capas se sincronizan por efecto `[capas, mapas]`. |
| `src/views/MapasTab.tsx` | Catálogos → Mapas (SOLO owner/administración): lista + Reemplazar/Renombrar/Ocultar/Eliminar. |
| `src/components/MapaFormModal.tsx` | Formulario COMPARTIDO (agregar / reemplazar): "Copiar configuración de…" (select interno que precarga bounds/zooms), "⚡ Probar que responde" (fetch de un tile real del centro al minzoom), estimación de tiles. Autocontenido (busy/error propios). |
| `src/lib/mapaOffline.ts` | Slippy math (`enumerarTiles`), descarga a Cache Storage `mapas-tiles` con pool de 8 + progreso + AbortSignal + `storage.persist()`, `estadoDescarga()` ('no'/'ok'/'desactualizado'), `borrarMapa` (limpia también el prefijo VIEJO si hubo reemplazo), metas en localStorage `sam-mapas-descargados`. |
| `vite.config.ts` runtimeCaching | La ÚNICA excepción al `runtimeCaching: []`: CacheFirst para `api.mapview.surcoapp.tech/.../tiles/` (cacheName **`mapas-tiles`** — DEBE coincidir con `MAPAS_CACHE`) y `arcgisonline.com`. PNGs estáticos sin Range → no aplica el bug que motivó el [] general. |

## Visual y herramientas (estilo Avenza, jul-2026)

Visor **pantalla completa oscura** (`.avz-*`): barra negra superior (← título ℹ️
🔍), retícula central, FABs GPS + brújula (aguja gira con `map.on('rotate')`; un
toque = `setBearing(0)`, **NUNCA fitBounds** — el fallback quitaba el zoom y se
eliminó a pedido), barra inferior (✏️ herramientas · píldora GPS · ⧉ capas).
**Rotación**: plugin `leaflet-rotate` (dos dedos móvil / Shift+arrastrar PC);
tipos en `src/types/leaflet-rotate.d.ts`.

**Herramientas portadas del original FieldMaps** (`src/lib/mapaGeo.ts`, sin
turf — haversine + exceso esférico): 📏 medir distancia (m/km), ⬠ medir área
(**ha 3 decimales** + perímetro) marcando puntos con toque/✛ cruz central/+GPS,
con Deshacer/Limpiar/💾 Guardar; 📍 marcadores (nombre+nota+paleta de 6 colores
idéntica al original, "Guardar aquí" = centro de la cruz, ir-a, borrar);
📐 mediciones guardadas (ver-en-mapa azul + fitBounds, borrar). Persistencia
**localStorage por equipo** (`sam-mapa-marcadores`, `sam-mapa-mediciones`) —
offline y personales, igual que el original.

## Permisos

- **Ver el mapa: TODOS los roles.** Operario = 4ª pestaña "Mapa"; supervisor/owner/admin = Más → Mapa; **supervisor_insumos = 4ª pestaña en InsumosModule** (no pasa por SupervisorView — no olvidarlo al agregar features).
- **Gestionar (agregar/reemplazar/ocultar/eliminar): SOLO owner (jefe) y administración.** Entrada Catálogos → Mapas oculta al resto; botón "+ Agregar mapa" del visor gateado con `puedeGestionar`.

## Reemplazo de cartografía (el plano cambia)

`updateMapa` acepta `tilesBase/bounds/zooms` → el mapa **conserva id y nombre**.
La meta de descarga guarda el `tilesBase` con el que se bajó → si difiere del
actual, `estadoDescarga()` = `'desactualizado'` → el visor muestra
**"🔄 Actualizar"** (y 🔄 en la capa) en vez de creer que está vigente. Al
re-descargar o borrar se limpia el prefijo viejo del cache.

## 🔴 Gotchas críticos (aprendidos con incidentes)

1. **NADA de `React.lazy`/chunks nuevos en esta app.** El intento original
   (MapaView lazy) hizo que el build de VERCEL partiera el bundle distinto al
   local (chunk `jsx-runtime` de 330 KB) → **pantalla blanca en producción**
   (17-jul). El build local pasaba. Todos los imports del módulo son ESTÁTICOS
   (+49 KB gzip aceptados). Si algún día se quiere lazy: rama `pruebas` +
   verificar el PREVIEW REAL de Vercel + navegador antes de main.
2. **`.mapa-canvas` DEBE tener `position: relative; z-index: 0`** (stacking
   context). Leaflet usa z-index internos 400–1000 que sin esto SE ESCAPAN y
   tapan el more-sheet (z195) y los modales (z200+). Pasó en producción.
3. **Tras todo deploy del módulo: verificar producción con navegador**
   (get_page_text del login + consola sin errores). Un usuario atascado tras un
   deploy roto se cura con incógnito → recargas dobles → borrar datos del sitio.
4. **NUNCA `detectRetina: true`** en los tile layers: con pantallas retina
   Leaflet pide tiles UN NIVEL MÁS PROFUNDO del que existe → al acercar, el PDF
   desaparecía y Esri salía en cuadros grises (19-jul). La nitidez viene de los
   tiles reales (DPI 1200 → z17); el overzoom se maneja con `maxNativeZoom`
   (estira la imagen, nunca desaparece). Esri rural: `maxNativeZoom: 17`.
5. El clasificador de permisos **bloquea escrituras** a las BD por SSH y extraer
   la anon key de FieldMaps → los writes van vía Studio del usuario; los datos de
   mapas nuevos de FieldMaps se obtienen con SSH-read (permitido) a
   `fieldmaps-db`.

## GPS / batería

`watchPosition` con `enableHighAccuracy` SOLO mientras el toggle 📍 está activo y
el visor montado; cleanup en el efecto y al desmontar. `maximumAge: 5000`,
`timeout: 15000`. Cero GPS con el mapa cerrado — promesa explícita al usuario.

## Mapas configurados (18-jul-2026)

RIOPAILA — Plano detallado (map `2ae98a6c`, z10-16, ~40-50 MB) · ZONA 1
(`8039e5f2`, z11-16) · Mapa general Riopaila-Castilla (`a7f8b8d2`, z8-15,
pesado — mejor online). Todos de la org `d2598200-…`.
