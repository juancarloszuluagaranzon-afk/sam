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
4. **Migraciones**: van en `sam-app/supabase/migrations/`. Normalmente **las corre el
   usuario en Supabase Studio** — ⚠️ debe **apagar la extensión traductora de Chrome** o
   el SQL se corrompe (`select`→`seleccione`); recordárselo SIEMPRE. También se pueden
   aplicar por SSH como `supabase_admin` (`postgres` NO es dueño de las tablas y no
   puede hacer `SET ROLE`); siempre con `-v ON_ERROR_STOP=1 --single-transaction`.
   Ver `.agent/skills/managing-supabase/`. Dos trampas ya cobradas: la tabla de
   usuarios se llama **`app_usuarios`** (no `usuarios`) y su CHECK de `rol` hay que
   ampliarlo a mano por cada rol nuevo; y una tabla nueva **no hereda los GRANT** —
   sin `grant … to anon, authenticated` la app responde *permission denied* aunque
   la policy RLS exista.
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
5d. **🔴 Los campos de lista SUGIEREN, no obligan.** Usar **`<CampoLista tipo="…">`**
   (`src/components/CampoPlaca.tsx`): campo escribible + `datalist`. Las sugerencias
   salen de `catalogos_valores` (lista por `tipo`) espejada en `localStorage` —así
   sigue sugiriendo sin señal— más lo que ya se escribió en ese equipo. Al guardar,
   `recordarValor(tipo, v)`. Obligar a dar de alta el valor antes de registrar era un
   muro en la bomba a las 6 a.m. Tipos vivos: `ESTACION`, `PLACA`, `USO`,
   `MOTIVO_RECHAZO`. Para `PLACA` va `<CampoPlaca>`, que además quita espacios y
   guiones (`abc 123` = `ABC-123` = `ABC123`). **Agregar una lista nueva NO necesita
   migración**: basta un `tipo` nuevo en `LISTAS` de `CatalogosInsumosTab`.
5e. **🔴 Lo que se digita va en MAYÚSCULA.** `lib/texto.ts` (`aMayus`, `normalizarPlaca`)
   + `autoCapitalize="characters"` en el input. Los mismos datos los escriben cinco
   personas distintas y "campoalegre"/"CampoAlegre" terminan siendo dos valores en un
   reporte. NO tocar fechas, horas ni números.
6. **Área ejecutada**: el fallback `executedArea>0?executedArea:area` aplica **SOLO** a
   estados `COMPLETADA`/`PARCIAL`. Una labor no cerrada muestra 0.00. Es dinero real.
7. **Al terminar un deploy, reportar la versión** (`git rev-parse --short HEAD`).
7c. **🔴 Todo lo que recibe un operario, él lo confirma.** Material y combustible. El
   material va por `insumos_solicitudes`; el **tanqueo a MÁQUINA** guarda `operario_id`
   en `combustible_externo` y le muestra la misma tarjeta de un toque. El campo
   "Entregado a" es obligatorio salvo que el que registra sea el propio operario — él
   es quien recibe. ⚠️ **Los VEHÍCULOS todavía no piden operario** (decisión del
   cliente, 3-ago-2026). `operario_id`/`confirmado_por` son TEXT, no uuid.
7b. **🔴 Nadie avala lo que él mismo registró.** El analista ahora también entrega y
   tanquea; el aval es el segundo par de ojos y si firma lo suyo el control desaparece.
   `AvalesCombustibleTab` esconde los botones cuando `registradoPor === session.id` y
   avisa que lo firma el dueño o administración (que ven la misma pantalla). Al abrir
   un flujo de aval a quien también origina el registro: cerrar esta puerta.
7d. **🔴 La unidad de una labor ya no siempre es hectáreas.** **ACEQUIAS se mide en
   HECTÓMETROS**: es lineal. Usar **`unidadDeLabor(nombre)`** de `lib/texto.ts` en toda
   etiqueta y encabezado de área — nunca escribir "ha" fijo. `labores_catalogo.unidad`
   y `asignaciones.unidad` (esta última **nullable y sin default**: `null` = se registró
   cuando todo eran hectáreas). ✅ **La Planilla los desglosa**: TRES columnas al final
   — **Total** (el de siempre, que junta las dos), **Total ha** y **Total hm** — y,
   dentro de la casilla del día, el hectómetro va debajo CON su unidad. El desglose va
   PEGADO al total a propósito: así el combinado se audita de un vistazo en vez de ser
   un número suelto. Decisión del cliente conservar el Total — se le advirtió dos veces
   que mezcla unidades y lo reafirmó.
   Medido antes de separarlos: a un operario se le sumaban 196,88 hm con 59,51 ha y
   salía un total de 256,39 sin significado — y **8 de los 17 días con acequias**
   mezclaban las dos unidades. ⚠️ El Resumen y el Reporte **todavía suman**; al tocar
   un total que cruce labores, separarlo igual.
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
| Insumos y combustible | `views/Insumos*`, `Bodegas*`, `MiBodegaTab`, `CatalogosInsumosTab` | **Stock por BODEGA** (principal + satélites = el carro de cada supervisor), traslados con aval, solicitudes, despacho con evidencia, aval del operario, entrega directa, reportes Excel |
| Tanqueo + avales | `components/TanqueoModal`, `views/AvalesCombustibleTab` | Todo el combustible que no pasa por un despacho entra por aquí y lo avala el **analista de insumos** (`AnalistaView`), que además ve Inventario/kardex, Bodegas, Catálogos **y también entrega**: despacha solicitudes, hace entregas directas desde la principal y registra tanqueos. ⚠️ **No puede avalar lo que él mismo registró** — eso lo firma el dueño o administración |
| Mapas offline | `views/MapaView`, `MapasTab` | Visor tipo Avenza (capas, medir, marcadores) + tiles de FieldMaps |
| Flota / Escolta | `views/Flota*` | Formato CDA-F-68, rol `conductor`, firma táctil + foto |
| Taller de maquinaria | `views/TallerModule`, `views/taller/*` | Hoja de vida, preventivo por horómetro, órdenes de trabajo, repuestos, compras e indicadores ($/hora, disponibilidad, TMEF, TMR) |
| Informe semanal | `views/InformeSemanalTab`, `lib/informeSemanal.ts` | Una fila por máquina y semana: horómetro inicial/final, **horas trabajadas**, combustible y **gal/hora**. Reemplaza la hoja de Excel manual. ⚠️ Descarta las lecturas de horómetro con magnitud distinta a la dominante de esa máquina y las marca — no las esconde |
| Rendimiento | `views/MotivacionTab` | KPI quincenal por operario |
| Chequeo diario | `views/ChequeoDiarioView`, `services/chequeoApi.ts` | 30+ ítems por máquina, **un ítem por pantalla** en 3 vueltas físicas, orden rotado cada día. ⚠️ Hoy **solo activo en TRC-1** (banco de pruebas): las 21 máquinas reales tienen `chequeo_lista_id` en null hasta que el cliente lo valide — la asignación original quedó guardada en `chequeo_listas.nota` |
| Eficiencia maquinaria | `views/ConsumoDashboardTab`, `consumoApi.ts` | Segunda cara del tablero del dueño. Une el papel (mar–jul) con la app (ago→) vía `consumo_unificado_v`; gal/hora contra la referencia 2025 de CADA máquina. Las **horas** salen de `equipo_horas_mes` (cierre mensual de horómetros) y caen a `labor_sesiones` si el mes no tiene cierre |
| Flota · planilla CDA-F-68 | `views/FlotaTab` | El Excel sale **calcado del formato impreso**: membrete IMECOL, códigos de normalización, las 16 columnas y la cuadrícula. ⚠️ Usa **exceljs** y no `xlsx`, porque la versión comunitaria de `xlsx` **no escribe estilos** (probado: descarta bordes y negritas al guardar). Entra por `import()` en su propio chunk. El **conductor también descarga** la suya |
| Viajes de trozas | `views/MaderaTab`, `MaderaForm`, `MaderaView`, `maderaApi.ts` | Negocio nuevo de transporte de madera; existe porque **el dueño del camión vive lejos** — es confianza, no reportes. Cinco campos y una **foto de la guía de despacho (obligatoria)**; la hora la pone el servidor y se muestra. Rol propio `conductor_madera` (ve solo lo suyo, sin anular). ⚠️ **El kilometraje quedó OPCIONAL: el odómetro del camión está dañado** — exigirlo obligaba a inventar un número. ⚠️ Tiene **6 viajes DEMO** (`nota like 'DEMO%'`) que hay que borrar antes de registrar de verdad. Ver `.agent/skills/managing-madera/` |
| Movimientos de insumos | `views/MovimientosTab`, `movimientosApi`, `resumen_movimientos_insumos` | Quién entrega, qué y a quién. Base del **pago por productividad** que quiere arrancar el cliente. 🔴 **El volumen nunca se muestra solo**: al lado va la calidad del registro y las visitas. Un despacho es UN hecho — contar filas de kardex infla un 51%. Ver `.agent/skills/managing-movimientos/` |
| Máquinas (maestro) | `views/MaquinasCrudTab`, `hooks/useEquipmentForm` | Crear, editar, activar, desactivar y eliminar. Lo ven el dueño y el analista, con la **misma lógica compartida** en el hook |
| Tarifas | `views/TarifasTab`, `tarifasApi.ts` | ⚠️ **El código está en `main` pero la entrada del menú está COMENTADA** (`SupervisorView`, buscar "TARIFAS NO SE MUESTRA"): decisión del cliente. La tabla solo tiene 27 tarifas de ejemplo, y una tarifa de mentira en una pantalla de precios es peor que no tener la pantalla. Para habilitarla: descomentar. Ver `.agent/skills/managing-facturacion/` |

## Detalles que muerden

- **🔴 El detalle de una entrega va con `<DetalleDespacho>`** (`src/components/`): quién
  recibió, quién entregó, horómetro, nota, evidencia y el aval del operario. Se abre
  desde Reportes (lista, detalle de máquina, detalle de insumo) e Inicio, así que vive
  en un componente y no dentro de una pantalla. Se le pasa el movimiento de kardex; si
  quien lo abre ya tiene la entrega cargada se la pasa en `entrega`, y si no, la busca
  sola por `referencia` (`loadSolicitudPorId` / `loadCombustiblePorId`). Al agregar un
  listado de movimientos nuevo: hacer la fila tocable y colgar este componente.
- **🔴 Un despacho es UN hecho, no una fila por insumo.** El kardex guarda una fila
  por insumo, así que una entrega de ganchos + combustible sale duplicada —misma
  máquina, misma hora, mismo operario— y en celular llena la lista sin decir nada.
  Usar **`agruparDespachos()`** (`lib/despachos.ts`): agrupa por `referencia`, y el
  TIPO entra en la llave para que la devolución del operario NO se mezcle con la
  salida. Ya aplicado en Reportes (lista y detalle de máquina) y en el modal de
  Inicio. Al listar movimientos de kardex en una pantalla nueva: agrupar.
- **El dato que puede faltar va NULLABLE, no con default.** `insumos_solicitudes.engraso`
  (¿engrasó la máquina?) tiene **tres** estados: `true`, `false` y `null` = no se
  preguntó. Un `boolean NOT NULL DEFAULT false` diría que ninguna máquina se ha
  engrasado nunca — que es una afirmación distinta de "no sabemos", y ahí caerían todas
  las entregas anteriores a la migración. Por lo mismo `<SwitchEngraso>` arranca sin
  elegir: un descuido no debe quedar grabado como "no engrasó". En el informe semanal
  sale como "2 de 3", no como un sí/no.
- **En la entrega se puede despachar lo que NO se pidió.** `entregarSolicitud` acepta
  ítems sin `itemId` y los inserta con **`cantidad: 0`** y `cantidad_despachada` = lo
  entregado. Ese cero es deliberado: lo pedido sigue siendo cero porque el operario no
  lo pidió, y la diferencia entre lo que se solicita y lo que de verdad hace falta en
  campo es justamente el dato interesante. **No igualar las dos cifras.**
- **🔴 El texto que explica una pantalla va dentro de `<Ayuda>`** (`src/components/`):
  un botoncito "ⓘ Info", cerrado por defecto. Sirve la primera vez, pero al que entra
  quince veces al día le come media pantalla del celular — en Bodegas eran **231 px**,
  más de un cuarto de la pantalla, antes de ver el primer dato. **Aplicado en las 25
  pantallas del app**, taller incluido. Al crear una pantalla nueva: el párrafo
  introductorio va plegado, no suelto. Lo que va dentro de un MODAL se queda suelto —
  ahí el texto es la instrucción del momento, no un letrero permanente.
  Ver `.agent/skills/writing-ui-copy/`.
- **📖 Los manuales están DENTRO de la app**: `<BotonManual>` (`src/components/`) en el
  menú lateral (dueño/admin/supervisor/operario) y en la barra superior de los roles que
  no tienen menú (analista, insumos, flota). Elige el manual por rol; a quien le sirven
  varios le abre un selector. Se abre en pestaña aparte para no perder lo que estaba
  haciendo. Al agregar un rol nuevo: sumarlo a `manualesDe()`.
- **📖 Los manuales** viven en `sam/manuales/` (cuerpos `_cuerpo_*.html` + `_estilo.css`)
  y se publican con la app en `public/manuales/`, para compartirlos por WhatsApp con un
  enlace: `/manuales/manual-{operario,supervisor-insumos,analista-diego,taller}.html`.
  ⚠️ `vite.config.ts` lleva `navigateFallbackDenylist: [/^\/manuales\//]`: sin eso el
  service worker se queda con la navegación y a quien tiene la PWA instalada le abre el
  aplicativo en vez del manual. **Al cambiar una pantalla, revisar si el manual quedó
  mintiendo** — ya pasó con el de insumos (decía que el combustible entraba por tanqueo,
  y el tanqueo no tiene ningún destino que le sume a la principal; entra por
  Inventario → + Entrada).
- **Fotos**: toda subida pasa por `lib/imagenLigera.ts`. Perfiles por uso, y el criterio
  NO es "lo más chico posible" sino lo más chico que TODAVÍA SIRVE: `evidencia` 800 px
  (~45 KB, solo hay que ver qué es), `documento` 1400 px (~120 KB, la tirilla hay que
  poder LEERLA), `avatar` 400 px (~24 KB), `motivacion` 1000 px. Nunca subir crudo.
  ⚠️ **Las fotos NO son el problema de disco** (medido 1-ago-2026: 30 MB en total, ~12
  fotos/día ≈ 200 MB/año contra 201 GB libres). Lo que llena el VPS es el **build cache
  de Docker** de los otros SaaS: 103 GB, 94 recuperables con `docker builder prune`.
- **🔴 NUNCA sumar cantidades de insumos distintos.** Galones + unidades = un número
  que no significa nada (ya pasó en el Inicio: "Entrega directa 63,95" era 40 ganchos
  + 23,95 galones). Cuando una serie mezcla unidades: o se cuentan MOVIMIENTOS, o cada
  punto lleva su unidad al lado (`Punto.sufijo` en `components/Charts`). En el Resumen
  de inventario, "Otros" cuenta MATERIALES, no cantidades.
- **⭐ Destacados = `insumos.frecuente`.** Una sola marca con dos efectos: salen de
  primeras en los selectores Y llevan tarjeta y columna propias en el Resumen de
  inventario; el resto se pliega en "Otros". Se eligen en **Insumos → 📊 Resumen →
  ⭐ Elegir materiales destacados** (y también desde Inventario → ⋯). Hoy: COMBUSTIBLE
  y GANCHOS. Dos o tres es lo sano.
- **🔴 En el kardex hay DOS fechas y no son intercambiables.** `created_at` = cuándo se
  tecleó (inmutable, auditoría); **`fecha_efectiva` = cuándo ocurrió (la que usan TODOS
  los reportes)**. El registro y el hecho no pasan al mismo tiempo: el supervisor entrega
  a las 6 a.m. en el lote y registra a las 4 p.m. cuando vuelve a tener señal. Pisar
  `created_at` al corregir habría sido más simple y es justo lo que no se puede hacer:
  se perdería la evidencia que permite detectar a alguien retrofechando. **`mapKardex`
  devuelve `createdAt = fecha_efectiva`**, así que corregir un despacho se propaga sola
  a Reportes, Excel, consumo por máquina e informe semanal — el valor de registro sale
  aparte en `registradoEn`. La columna es NOT NULL con default a propósito: PostgREST no
  filtra sobre expresiones y un `null` dejaría el movimiento fuera de todo rango de
  fecha, invisible en los reportes. `editarDespacho()` corrige **en su sitio** (no
  compensa, igual que anular un traslado) y deja el rastro en
  `insumos_despachos_auditoria`. ⚠️ Solo toca las filas **SALIDA**: la ENTRADA del aval
  es el reclamo del operario y pisarla lo borraría.
- **🔴 Eliminar un despacho SÍ borra la ENTRADA del aval** — al revés que editarlo. La
  diferencia es si el hecho existió: al corregir, el despacho ocurrió y el reclamo del
  operario sigue siendo suyo; al eliminar, el despacho nunca ocurrió y una devolución
  por diferencia no tiene de qué ser devolución. `eliminarDespacho()` guarda el despacho
  completo en la auditoría **antes** de borrar, y devuelve la solicitud a **PROGRAMADA**
  si la pidió un operario (sigue necesitando el material) o a **CANCELADA** si era
  DIRECTA. Limpia el aval y lo despachado; lo **pedido** no se toca.
- **🔴 La Planilla y el Resumen usan el MISMO criterio de área.** Daban números
  distintos para la misma quincena y el cliente lo detectó. Cerrar una labor sin
  escribir el área significa "hice lo planificado", no "hice cero": `areaCerrada()`
  en `PlanillaTab` aplica el mismo respaldo que el Resumen. Antes de corregirlo
  faltaban **89,91 ha de 7 operarios** en la planilla con la que se paga. ⚠️ El
  mismo criterio va en el avance acumulado por suerte, o el restante de las
  EN_PROCESO sale inflado. Lo que SÍ difiere y está bien: la Planilla cuenta las
  EN_PROCESO (lo que se está trabajando) y el Resumen no (solo lo cerrado).
- **🔴 Las novedades de la planilla las crea ADMINISTRACIÓN, ya no el código.**
  Tabla `novedad_tipos` + Más → 🏷️ Novedades de la planilla. La leyenda, los
  botones y el color de cada celda salen del catálogo. Un código que ya tiene días
  marcados **no se borra, se desactiva** — borrarlo dejaría las celdas de meses
  pasados sin significado, y esa planilla es la nómina. Si el catálogo no carga,
  las pantallas caen a la lista fija de `samApi`, que se conserva a propósito.
- **🔴 Una foto sin señal hay que PODERLA VER.** `<FotoEvidencia url>` la arma
  desde el blob de Dexie con `createObjectURL` (y **revoca la URL al desmontar**).
  Antes salía un cuadrito gris que decía "sin subir" y el supervisor no podía
  comprobar lo que acababa de tomar. Al listar fotos: usar el componente, no un
  `<img src>` pelado. ⚠️ **Solo DOS pantallas producen marcadores `local://`** — las
  que llaman a `subirOGuardarFoto`: `BandejaInsumosTab` y `TanqueoModal`. En el resto,
  las URL vienen del servidor y un `<img>` pelado está bien. El tanqueo es el caso
  más agudo: la tirilla se toma **en la bomba a las 6 a.m.**, donde no hay señal.
- **🔴 El AJUSTE FIJA el saldo, no lo suma.** Al rehacer stock desde el kardex, sumar
  `SALIDA/ENTRADA` a ciegas sobre un insumo con ajustes da un número que no corresponde
  (GANCHOS suma 1480 en el kardex y su saldo real es 1200; las dos cifras son correctas).
  Y si el recálculo SALTA esos pares "por seguridad", el saldo no se corrige: ya mordió
  al limpiar una entrega de prueba (3-ago-2026) y quedó 1 gancho abajo. **Después de
  borrar movimientos, verificar el saldo contra lo que había antes.**
- **🔴 Corregir un tanqueo YA tiene pantalla**, y va por la función de base de datos
  `corregir_tanqueo(id, galones, motivo, quien)`: cambiar la cantidad obliga a rehacer
  el saldo de TODOS los movimientos posteriores de esa bodega, y seis `update` sueltos
  desde el navegador pueden cortarse a la mitad. La función recalcula la cadena entera
  desde el principio (así los AJUSTE quedan bien, que FIJAN el saldo). **No avala**: el
  tanqueo sigue PENDIENTE. El botón está en `AvalesCombustibleTab` y lo ve el analista.
- **🔴 El aviso del horómetro** (`lib/horometro.ts` + `<AvisoHorometro>`): entre dos
  lecturas de la misma máquina no puede haber más de **24 horas**, *así hayan pasado tres
  días* — si estuvo en el taller el horómetro no avanzó. ⚠️ NO multiplicar por los días
  transcurridos: le regala 72 h de margen a la máquina que estuvo parada, que es justo el
  caso que hay que cazar. **Avisa, no bloquea** (un bloqueo habría rechazado el 13,5% de
  los registros históricos) y **no toca el guardado**. La referencia sale de la lectura
  limpia y se espeja en `localStorage`; sin referencia no dice nada. La referencia se
  puede **ver**: Más → ⏱️ Horómetros (`views/HorometrosTab`) lista por máquina la última
  lectura buena, **el tope que aceptaría el próximo registro** y de dónde salió — una
  regla que no se puede auditar la gente aprende a ignorarla. Hoy el aviso está solo en
  **cerrar labor** (91% de las lecturas); faltan insumos, tanqueo y órdenes de trabajo.
- **Un tanqueo también se puede rechazar**: los despachos sí
  (`editarDespacho`/`eliminarDespacho`); el tanqueo solo se puede **rechazar** en
  `AvalesCombustibleTab` —que reversa— y volver a teclear. Cuando toque corregir uno
  por SQL: **corregir el HECHO, no el saldo.** Dejar el stock bueno y el kardex malo
  parece resuelto y reaparece solo en el consumo por máquina, el informe semanal y el
  tablero. Y corregir **todos los saldos posteriores** de esa bodega: el `saldo` es una
  foto del stock en ese instante, no una fórmula. Rastro en
  `insumos_despachos_auditoria` (⚠️ `solicitud_id` es NOT NULL — va el id del
  `combustible_externo`) y **no** avalar desde SQL, que salta el segundo par de ojos.
- **🔴 En las tirillas de ZEUSS el punto es DECIMAL.** Imprimen `62.255 GL` = sesenta y
  dos galones; en Colombia eso se lee como sesenta y dos mil, y un supervisor tecleó
  62255 dejando el carro en 62.329,54 gal (22-ago-2026). `TanqueoModal` pide un segundo
  toque por encima de `GALONES_SOSPECHOSO = 200` y nombra la trampa — **no bloquea**,
  porque un límite duro obliga a inventar un número a las 6 a.m. en la bomba.
  ⚠️ **La primera corrección de ese caso estuvo MAL**: se dedujo 75,46 de un reporte
  verbal teniendo la foto de la tirilla adjunta desde el principio. **Cuando hay
  evidencia adjunta, se mira ANTES de calcular** — un número deducido que "encaja" es
  justo el que nadie vuelve a cuestionar. Ver `managing-insumos`.
- **⚠️ El kardex de la BODEGA PRINCIPAL no es un libro de compras.** El combustible que
  llega no se está registrando como ENTRADA: se deja correr hasta que el saldo queda en
  negativo y se cuadra con un **AJUSTE por conteo físico** (−23,06 gal el 22-ago, tapado
  con +992,06). Cuadra el número y borra la historia — sin fecha, proveedor ni precio no
  hay costo del combustible. Es problema de operación, no de código, pero hay que saberlo
  al leer cualquier cifra de la principal. Los saldos de los **carros** sí son fiables.
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
  `conductor` (escolta), `conductor_madera` (camión de trozas), `analista_insumos`,
  `taller`, `soporte`. Agregar uno cuesta **13 ediciones en 9 archivos** (checklist
  completo en `.agent/skills/managing-supabase/`): dominio, **`mapRole`**, routing en
  `App.tsx`, su vista, labels, **tres** sitios de ImpersonationBar, el selector de
  usuarios, `manualesDe()` y la migración del CHECK. 🔴 **Olvidar `mapRole` no da
  error**: el rol desconocido cae a `operador` y la persona entra a la pantalla
  equivocada. ⚠️ Postgres no *amplía* un CHECK — hay que leer el vigente y
  reescribirlo completo, o se borran roles que ya existen.
- **🔴 Combustible: nadie se mete una entrada a mano.** El supervisor de insumos NO ve
  Inventario (`InsumosModule` le filtra la pestaña): si pudiera hacer "+ Entrada" el
  combustible aparecería de la nada. Todo lo que entra o sale sin un despacho pasa por
  `TanqueoModal`, que registra dos ejes independientes:
  - `origen`: **ESTACION** (se compró en la bomba, no sale de ninguna bodega) o
    **SEDE** (sale de la PRINCIPAL; se descuenta de una vez porque ya se lo llevaron).
  - `destino`: **CARRO**/**PIMPINAS** suman al satélite · **VEHICULO** (exige placa) y
    **MAQUINA** (exige horómetro) son consumo, no tocan stock.
  Todo nace `PENDIENTE` y lo avala el analista en `AvalesCombustibleTab`. **Rechazar
  REVERSA** los movimientos — si tocas ese flujo, mantén la reversa simétrica.
- **🔴 Horómetro: nunca el máximo ni la mediana.** Es la base del preventivo y los
  datos vienen sucios de dos formas: dedazos sueltos (un `14.142.545` entre lecturas
  de ~145.200) y **escalas mezcladas** (unos digitan `5407`, otros `54030` — la misma
  lectura con y sin la décima). `equipo_horometro_v` usa **magnitud dominante**: agrupa
  las últimas 12 lecturas por `floor(log10(h))`, gana el grupo más numeroso y dentro de
  él la más reciente. La lectura **manual manda siempre**. Ver `.agent/skills/managing-taller/`.
- **🔴 Anular un traslado BORRA su kardex, no lo compensa.** `anularTraslado()` elimina
  las filas de `insumos_kardex` con esa `referencia` y recalcula el saldo con
  `recalcularStockBodega()`. **No** se registra una entrada de devolución: un traslado
  en tránsito que se anula nunca ocurrió, y dejar salida+devolución cuadra el saldo
  pero mete dos movimientos físicos que nadie hizo — y la salida sigue contando como
  consumo de la principal (el cliente lo reclamó, 1-ago-2026). El rastro de la
  equivocación vive en el traslado (`estado=ANULADO` + quién/cuándo/por qué), no en el
  libro de inventario. Dos caminos: `ENVIA` (**Eliminar** en Bodegas) y `RECIBE`
  (**No es para mí** en Mi bodega, por la cola offline). ⚠️ El guard
  `.eq('estado','EN_TRANSITO').select()` impide anular dos veces. NO confundir con
  "faltó algo" (recepción parcial), que es un traslado válido.
- **🔴 CONSUMO ≠ todo lo que salió de la bodega.** Surtir un carro es un MOVIMIENTO
  entre bodegas: el material sigue siendo de la empresa. Consumo = movimientos **con
  `equipoCodigo`** (SALIDA menos ENTRADA de devolución). Es el criterio de
  `ConsumoEquiposTab` y ahora también del Resumen de inventario, para que den el mismo
  número. Contar los traslados inflaba el consumo de la principal en 330 galones.
- **🔴 La orden de trabajo es la pieza central del taller.** Sin `paro_en`/`arranque_en`
  no hay disponibilidad ni TMR. Los repuestos se descuentan **al cerrar**, marcados uno
  por uno (`ot_repuestos.descargado`) para que cerrar dos veces no descuente doble.
  Igual con las compras: nacen en BORRADOR y solo **recibirlas** mueve el inventario.
- **🔴 Medir a la gente cambia las reglas del dato.** Cuando un número va a decidir
  un pago deja de ser un reporte: se vuelve la meta, y entonces deja de medir
  (Goodhart). Tres reglas que salieron de construir el tablero de movimientos y
  aplican a cualquier métrica de desempeño que se construya aquí:
  1. **El volumen nunca va solo** — al lado, la calidad de lo registrado.
  2. **Numerador y denominador salen del mismo conjunto.** Ya mordió: el ritmo por
     hora dividía todas las entregas entre horas que excluían los días de una sola.
  3. **Ninguna cifra escrita a mano en la pantalla.** Un número quemado sirve el mes
     que se escribió y miente después, y nadie vuelve a revisarlo.
  Ver `.agent/skills/managing-movimientos/`.
- **Skills del repo**: `sam-app/.agent/skills/` — leerlas antes de tocar su área
  (`managing-assignments`, `managing-insumos`, `managing-mapas`, `managing-supabase`,
  `managing-maestro`, `managing-taller`, `managing-facturacion`, `managing-madera`,
  `managing-flota`, `managing-movimientos`, `writing-ui-copy`, `building-react-forms`,
  `capturing-gotchas`).

## Cómo trabaja el usuario

- Pide en español, a menudo por voz (llegan transcripciones con erratas — interpretar).
- **Quiere acción, no preguntas**: si el contexto ya está claro, ejecutar y desplegar.
- Manda capturas de pantalla con errores: leerlas con cuidado, suelen tener la causa.
- Presenta el producto a un cliente real; le importa **la confianza y la reputación**.
  Si algo se rompe en producción: **revertir primero, diagnosticar después.**
