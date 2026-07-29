# ASM / SAM — AgroServicios Morales (AgroMorales)

> **Lee esto primero.** Es el puente de contexto del proyecto: sirve igual desde el
> computador, desde `claude.ai/code` o desde el celular. Si algo aquí contradice
> lo que creas recordar, **manda esto**.

## Qué es

PWA de gestión de labores agrícolas (caña) para AgroServicios Morales. +50 usuarios
reales en campo. **Producción de verdad: la gente cobra por lo que registra aquí.**

- **App**: `sam-app/` — React 19 + TypeScript + Vite (rolldown). PWA offline-first.
- **Producción**: https://agroserviciosmorales.vercel.app (auto-deploy al hacer push a `main`).
- **Base de datos**: Supabase **self-hosted** en VPS Hostinger (`supabase.surcoapp.tech`,
  contenedor `supabase-db`). Studio: el usuario corre las migraciones a mano.
- **Usuario**: Iván García — dueño del producto, no programador. Habla en español,
  quiere resultados desplegados y verificados, no explicaciones técnicas largas.

## Reglas de oro (aprendidas con incidentes reales)

1. **`git fetch` ANTES de tocar código.** Regla férrea desde un incidente de pérdida
   de trabajo (19-may-2026). Hay un hook automático que lo recuerda.
2. **Verificar producción DESPUÉS de cada deploy** (cargar la URL y ver que renderiza,
   consola sin errores). Hubo un incidente de **pantalla blanca** por un chunk lazy.
3. **NO introducir `React.lazy` / chunks nuevos** sin verificar el preview real de
   Vercel: el chunking de Vercel difiere del local y tumbó producción (17-jul-2026).
4. **Migraciones**: van en `sam-app/supabase/migrations/`, pero **las corre el usuario
   a mano en Supabase Studio**. ⚠️ Debe **apagar la extensión traductora de Chrome** o
   el SQL se corrompe (`select`→`seleccione`). Recordárselo SIEMPRE.
5. **Cargas resilientes**: usar `select('*')` en tablas que evolucionan, para que una
   columna nueva sin migrar no rompa la pantalla.
5b. **🔴 NUNCA un `<select>` plano para listas largas.** Operarios, insumos, máquinas,
   suertes, usuarios… TODO eso va con **`<SearchableSelect>`** (`src/components/`):
   se escribe para filtrar. Un desplegable con 40 nombres es inusable en celular y
   el cliente ya lo reclamó. Si la lista es larga y no tiene búsqueda, **está mal**.
   - Además soporta **frecuentes**: pasar `frecuente: true` en las opciones de uso
     diario → solo esas se ven al abrir, el resto queda tras "⋯ Otros (N)".
     En insumos sale de la columna `insumos.frecuente` (se marca desde Inventario).
   - Al crear cualquier formulario nuevo: **revisar cada selector antes de dar por
     terminado**. Esta regla aplica a todo lo que se construya de aquí en adelante.
5c. **🔴 Todo registro de entrega lleva FECHA Y HORA.** Nunca solo el día. Con la
   hora se mide el tiempo de respuesta al operario y se reconstruye la ruta del
   supervisor; sin ella solo se sabe "fue el martes". Usar **`lib/fechas.ts`**
   (`fmtFechaHora`, `fmtLapso`, `minutosEntre`) — zona fija `America/Bogota` y
   24 h, para que la hora no dependa del reloj del equipo de quien mira. Aplica
   a pantallas Y a los Excel. Al crear cualquier listado de movimientos, entregas
   o despachos: **revisar que la hora esté antes de darlo por terminado.**
6. **Área ejecutada**: el fallback `executedArea>0?executedArea:area` aplica **SOLO** a
   estados `COMPLETADA`/`PARCIAL`. Una labor no cerrada muestra 0.00. Es dinero real.
7. **Al terminar un deploy, reportar la versión** (`git rev-parse --short HEAD`).
8. **Nunca usar `now()`** al normalizar fechas en SQL; usar `coalesce(fecha_inicio, created_at)`.

## Flujo de trabajo

```bash
cd sam-app
npx tsc --noEmit && npm run build      # siempre antes de commitear
git add -A && git commit -m "..." && git push origin main   # Vercel despliega solo
```
Rama productiva: **`main`**. Remote: `github.com/juancarloszuluagaranzon-afk/sam`.

## Módulos (todos en producción)

| Módulo | Dónde | Notas |
|---|---|---|
| Labores / asignaciones | `views/SupervisorView`, `OperatorView` | Núcleo: asignar, tomar en campo, cerrar, aprobar, facturar |
| Planilla | `views/PlanillaTab` | Cuadrícula quincenal + novedades (V, T, F, OV, MT, IN, SP, LL…) |
| Maestro de suertes | `views/MaestrosTab` | Áreas oficiales; ⚠️ hay códigos de hacienda compartidos |
| Insumos y combustible | `views/Insumos*`, `Bodegas*`, `MiBodegaTab` | **Stock por BODEGA** (principal + satélites = el carro de cada supervisor), traslados con aval, solicitudes, despacho con evidencia, aval del operario, entrega directa, reportes Excel |
| Tanqueo + avales | `components/TanqueoModal`, `views/AvalesCombustibleTab`, `VehiculosTab` | Todo el combustible que no pasa por un despacho entra por aquí y lo avala el **analista de insumos** |
| Mapas offline | `views/MapaView`, `MapasTab` | Visor tipo Avenza (capas, medir, marcadores) + tiles de FieldMaps |
| Flota / Escolta | `views/Flota*` | Formato CDA-F-68, rol `conductor`, firma táctil + foto |
| Rendimiento | `views/MotivacionTab` | KPI quincenal por operario |

## Detalles que muerden

- **Fotos**: toda subida pasa por `lib/imagenLigera.ts` (comprime a ~20–80 KB). No
  subir imágenes crudas nunca — llenan el servidor.
- **Cantidades de insumos**: `lib/cantidad.ts`. Redondear **al calcular saldos**
  (sin eso el punto flotante guarda `1020.4100000000001`), y mostrar con
  `fmtCantidad(n, unidad)` — las unidades enteras (ganchos, tornillos) van **sin
  decimales**.
- **Barra inferior del dueño**: la arma él mismo (Más → ⚙ Personalizar barra,
  hasta 4 accesos, `lib/navPrefs.ts`, guardado por usuario en el equipo). Al
  agregar una sección nueva que valga la pena fijar, súmala a `NAV_OPCIONES`.
- **Mapas**: los tiles los genera **FieldMaps** (otro proyecto del usuario, VPS aparte).
  ASM solo guarda la config en la tabla `mapas`. Ver `.agent/skills/managing-mapas/`.
- **Roles**: `owner`, `administracion`, `supervisor`, `operador`, `supervisor_insumos`,
  `conductor`, `analista_insumos`, `soporte`. Al agregar uno hay que tocar ~6 archivos
  (ver cómo se hizo `conductor`: dominio, `mapRole`, routing en `App.tsx`, labels,
  dropdown de usuarios, ImpersonationBar).
- **🔴 Combustible: nadie se mete una entrada a mano.** El supervisor de insumos NO ve
  Inventario (`InsumosModule` le filtra la pestaña): si pudiera hacer "+ Entrada" el
  combustible aparecería de la nada. Todo lo que entra o sale sin un despacho pasa por
  `TanqueoModal`, que registra dos ejes independientes:
  - `origen`: **ESTACION** (se compró en la bomba, no sale de ninguna bodega) o
    **SEDE** (sale de la PRINCIPAL; se descuenta de una vez porque ya se lo llevaron).
  - `destino`: **CARRO**/**PIMPINAS** suman al satélite · **VEHICULO** (exige placa del
    catálogo `vehiculos`) y **MAQUINA** (exige horómetro) son consumo, no tocan stock.
  Todo nace `PENDIENTE` y lo avala el analista en `AvalesCombustibleTab`. **Rechazar
  REVERSA** los movimientos — si tocas ese flujo, mantén la reversa simétrica.
- **Skills del repo**: `sam-app/.agent/skills/` — leerlas antes de tocar su área
  (`managing-assignments`, `managing-insumos`, `managing-mapas`, `managing-supabase`,
  `managing-maestro`, `capturing-gotchas`).

## Cómo trabaja el usuario

- Pide en español, a menudo por voz (llegan transcripciones con erratas — interpretar).
- **Quiere acción, no preguntas**: si el contexto ya está claro, ejecutar y desplegar.
- Manda capturas de pantalla con errores: leerlas con cuidado, suelen tener la causa.
- Presenta el producto a un cliente real; le importa **la confianza y la reputación**.
  Si algo se rompe en producción: **revertir primero, diagnosticar después.**
