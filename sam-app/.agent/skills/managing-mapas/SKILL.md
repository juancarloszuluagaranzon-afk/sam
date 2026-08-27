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

## El plano sube desde el visor pero se registra aparte (30-jul-2026)

Subir un GeoPDF y que aparezca en el visor son **dos pasos**, y eso ya costó:
dos planos (PICHICHI y PICHICHI SUR) quedaron procesados y sin registrar porque
quien los subió no supo que faltaba confirmarlos.

1. `subirCartografia()` manda el PDF a FieldMaps → el worker lo procesa en
   segundo plano (minutos). Esto NO crea nada en ASM.
2. Cuando queda `status = 'ready'`, hay que **registrarlo** en `mapas` de ASM
   con `createMapa()`.

La reconciliación (comparar `listarCartografias()` contra `loadMapasAdmin()` por
`tiles_base` normalizado) está ahora en **los dos sitios**: Catálogos → Mapas y
el panel de Capas del visor. El ciclo se cierra donde empieza — quien sube el
plano lo ve aparecer ahí mismo con un botón "Agregar al visor".

Para diagnosticar un plano que "no quedó":

```sql
-- En fieldmaps-db: ¿lo proceso el worker?
select nombre, status, error, created_at from public.maps order by created_at desc limit 5;
-- En supabase-db (ASM): ¿quedo registrado?
select nombre, tiles_base, activo from public.mapas order by created_at desc;
```

Si en FieldMaps está `ready` y en ASM no aparece, es que falta el paso 2.

## Gestión del mapa desde el visor (30-jul-2026)

Renombrar, reemplazar la cartografía y eliminar ya no viven solo en Catálogos →
Mapas: el panel de **Capas** del visor tiene un `⋯` por capa (solo owner y
administración) con las tres acciones. Quien está mirando el plano es quien
detecta que está mal nombrado o desactualizado, y hacerlo ir a otra pantalla era
garantía de que no lo hiciera.

- **Renombrar** cambia el nombre en el catálogo: lo ven todos los equipos.
- **Reemplazar** reusa `MapaFormModal` con `editar`, así el mapa conserva su id
  y los equipos que lo tenían descargado ven "🔄 Actualizar".
- **Eliminar** pide confirmación (es para todos los equipos, no solo este) y
  borra además la copia descargada del dispositivo — dejarla ocuparía espacio
  por un mapa que ya no existe.

⚠️ Ojo al colocar modales en `MapaView`: hay **dos** `return` con `<MapaFormModal>`
— uno en la rama de "aún no hay mapas" y otro en el render principal. Un modal
puesto en la primera rama no se renderiza nunca cuando sí hay mapas. Ya pasó.

Ocultar/mostrar (`activo`) se queda en Catálogos a propósito: el visor solo
carga los activos, así que desde ahí no habría forma de recuperar uno oculto.


## Volvió a pasar: MAYAGUEZ (27-ago-2026)

Tercera vez. El plano quedó `ready` en FieldMaps a las 21:49 y **sin registrar en
ASM**, igual que PICHICHI y PICHICHI SUR en julio. El cliente reportó "no está
quedando".

El diagnóstico de esta skill funcionó tal cual: `select ... from public.maps` en
`fieldmaps-db` lo mostró `ready`, y `mapas` en ASM no lo tenía.

⚠️ **Que la reconciliación exista en la UI no basta**: quien sube el plano sigue
sin darse cuenta de que falta confirmarlo. Si esto se repite una cuarta vez, el
arreglo ya no es documental — hay que **registrar automáticamente** al llegar a
`ready`, o al menos avisar en el Inicio del dueño.

### Subir un plano sin la UI

```bash
curl -X POST "https://mapview.surcoapp.tech/api/asm/ingest"   -H "x-asm-secret: <el de fieldmapsApi.ts>"   -F "file=@PLANO.pdf" -F "nombre=NOMBRE DEL MAPA"
# devuelve {"map_id":"...","status":"processing"}; sondear con ?id=<map_id>
# hasta `ready`, y ahí sí insertar en `mapas` de ASM con bounds/minzoom/maxzoom.
```

Tarda unos minutos: un PDF de 4 MB tomó ~6 sondeos.

### ⚠️ Al probar un tile, calcular bien las coordenadas

Probar `z/x/y` a ojo da **400** y hace creer que el mapa quedó mal. La fórmula:

```python
x = int((lon + 180) / 360 * 2**z)
y = int((1 - log(tan(rad(lat)) + 1/cos(rad(lat))) / pi) / 2 * 2**z)
```

Con el centro de los `bounds` los tiles responden 200 con 16-80 KB. Y **la primera
petición en frío puede devolver 200 con 0 bytes** — repetir antes de alarmarse.

### Mapas registrados a 27-ago-2026

MAYAGUEZ (z9-14) · RISARALDA — Plano general 2025 (z8-14) · CASTILLA MANEJO
DIRECTO (z8-14), además de PICHICHI, PICHICHI SUR, SAN CARLOS, RIOPAILA detallado
y el general.

⚠️ El de CASTILLA vino de un PDF de **39 páginas** y el worker procesa **una
sola**. Si el cliente esperaba las 39 hojas, eso sigue pendiente.

## El orden de la lista lo manda el jefe (27-ago-2026)

`mapas.orden` + flechas **↑ ↓** en Mas → Catálogos → Mapas. Antes salía por
nombre, un orden que no significa nada para quien la usa: el mapa que más se abre
podía quedar de último por empezar con S.

🔴 **`orden` es NULLABLE y sin default**: `null` = nadie lo ha ubicado y se va al
final (`.order('orden', { nullsFirst: false })`). Un default (999) afirmaría que
alguien lo puso ahí.

🔴 **Mover renumera la lista COMPLETA**, no intercambia dos valores: un mapa
recién agregado llega con `orden` en null y el intercambio entre un número y un
null deja la lista a medias. Se escriben solo las filas que cambiaron.

La lista se mueve **en pantalla primero** y se guarda después: son ocho mapas a
punta de flechas y esperar el viaje al servidor en cada toque se siente trabado.
Si el guardado falla, se recarga del servidor, que es la verdad.

### Orden vigente (27-ago-2026)

RIOPAILA CASTILLA · RIOPAILA AGRICOLA · RISARALDA · SAN CARLOS · MAYAGUEZ ·
**PICHICHI SUR · PICHICHI CENTRO · PICHICHI NORTE** · CASTILLA

## Reemplazar cartografia: la fila se conserva, NO se borra y se crea

PICHICHI paso de dos planos a tres sectores. 🔴 **El `id` de la fila es lo que
amarra la descarga offline de cada equipo**: borrando y creando, a quien ya lo
tenia bajado se le queda un mapa huerfano en el celular. Actualizando
`tiles_base`/`bounds` sobre la misma fila, ve el aviso de re-descarga y sigue
siendo el mismo mapa. Es lo que hace 🔄 **Reemplazar** en la pantalla.

⚠️ **Los bounds identifican un plano mejor que su nombre de archivo.** El
"PLANO GENERAL SECTOR NORTE" se habia registrado como MAYAGUEZ NORTE, y sus
coordenadas (lat 3,646–4,346) eran las del PICHICHI viejo (3,625–4,347): era la
version nueva de esa misma hoja. **Antes de registrar un plano, comparar sus
bounds con los que ya estan** — un solape casi exacto significa que es un
reemplazo, no un mapa nuevo. Igual salio que el "MAPA GRAL SUR" traia bounds
identicos a los de PICHICHI SUR.

⚠️ El conteo de paginas que reporta el lector de archivos **no es el del PDF**:
anunciaba 137 y 201 paginas para planos que `pypdf` lee como **una sola**. Antes
de avisar que faltan hojas, contarlas de verdad.
