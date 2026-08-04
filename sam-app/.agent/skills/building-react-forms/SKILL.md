---
name: building-react-forms
description: >
  Patrones de formularios React en SAM. Úsala cuando crees o modifiques
  formularios, estados de formulario, validaciones, o cuando el usuario mencione
  "form", "formulario", "input", "select", "estado del form", "draft",
  "AssignmentFormState", "handleSubmit", "selector", "lista", "sugerencia",
  "placa", "mayúscula" o "campo obligatorio".
---

# Building React Forms — SAM

## Patrón canónico de estado de formulario

Siempre definir un tipo explícito y un valor vacío inicial:

```ts
interface MiFormState {
  campo1: string
  campo2: string
  // todos string aunque sean números — se convierten al usar
}

const EMPTY_FORM: MiFormState = {
  campo1: '',
  campo2: '',
}

const [form, setForm] = useState<MiFormState>(EMPTY_FORM)
```

## Función de actualización con reset de dependencias

Cuando un campo resetea otro al cambiar (ej: hacienda → suerte), manejar en la misma función:

```ts
function updateForm(field: keyof MiFormState, value: string) {
  setForm((current) => {
    if (field === 'haciendaCode') {
      return { ...current, haciendaCode: value, suerte: '' } // reset suerte
    }
    return { ...current, [field]: value }
  })
}
```

## Reset después de submit exitoso

```ts
// Reset completo
setForm(EMPTY_FORM)

// Reset parcial (conservar algunos campos, como equipo del operador)
setForm((current) => ({
  ...EMPTY_FORM,
  equipmentCode: current.equipmentCode || session.equipmentCode,
}))
```

## Patrón de submit

```ts
async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (!session || session.role !== 'supervisor') return  // guard de rol

  // validar campos obligatorios antes de llamar a la API
  if (!form.campo1 || !form.campo2) {
    setError('Completa todos los campos requeridos.')
    return
  }

  setBusy(true)
  setError('')
  try {
    await miApiCall(...)
    setForm(EMPTY_FORM)
    setInfo('Operación exitosa.')
    await refreshData()
  } catch {
    setError('No se pudo completar la operación.')
  } finally {
    setBusy(false)
  }
}
```

## Drafts para acciones inline (sin form completo)

Para ediciones dentro de listas (ej: área ejecutada por asignación), usar un `Record<id, draft>`:

```ts
const [drafts, setDrafts] = useState<Record<string, { area: string; notes: string }>>({})

function updateDraft(id: string, field: 'area' | 'notes', value: string) {
  setDrafts((current) => ({
    ...current,
    [id]: {
      area: current[id]?.area ?? '',
      notes: current[id]?.notes ?? '',
      [field]: value,
    },
  }))
}

// Limpiar draft después de usar
setDrafts((current) => {
  const next = { ...current }
  delete next[id]
  return next
})
```

## Mensajes de feedback

SAM usa un sistema de dos canales: `error` (rojo) e `info` (verde). Siempre limpiar `error` al inicio de un submit exitoso:

```ts
const [error, setError] = useState('')
const [info, setInfo] = useState('')

// Al iniciar acción:
setError('')
// Al tener éxito:
setInfo('Mensaje de éxito.')
// Al fallar:
setError('Mensaje de error.')
```

## Botón de submit con estado busy

```tsx
<button className="primary-button" type="submit" disabled={busy}>
  {busy ? 'Guardando...' : 'Crear asignacion'}
</button>
```

## Gotchas

- **[2026-05-29]** Para inputs que deben quedar siempre en mayúsculas (ej: nombre de hacienda en `NewSuerteModal`), aplicar 3 capas: (1) `onChange={(e) => setValue(e.target.value.toUpperCase())}` — el value en estado/DB queda en mayúsculas; (2) `autoCapitalize="characters"` — hint al teclado móvil para abrir directo en Caps Lock; (3) `style={{ textTransform: 'uppercase' }}` — respaldo visual. La capa 1 es la importante; las otras dos mejoran UX. Aplicar también al setter cuando se autocomplete desde otra fuente (ej: `handleHaciendaChange`) para consistencia.

- **[2026-05-29]** Cuando un modal se abre desde dentro de un bottom sheet (`.more-sheet` z-index 195 o `.assign-sheet` 195) o del menú lateral (`.side-drawer` z-index 210), el `.modal-overlay` genérico (z-index 100) queda DETRÁS del sheet padre. Fix: agregar una clase específica al overlay del nuevo modal con z-index >= 250. Patrón: `<div className="modal-overlay nombre-modal-overlay open">` + en CSS `.nombre-modal-overlay { z-index: 250 }`. Sin esto, el modal aparece pero se ve traslúcido o tapado.

- **[2026-05-28]** Cuando un bloque JSX necesita variables computadas (ej. `progress = getSuerteProgress(a, assignments)` antes del return), envolverlo en IIFE: `{cond ? (...) : (() => { const x = ...; return (<JSX/>) })()}`. Cuidado con el cierre: la sintaxis correcta es `)})()` — un `)` cierra el `return(...)`, `}` cierra el body, `()` ejecuta. Si solo pones `)}` (como en el ternario simple), TypeScript no se queja pero el JSX queda mal balanceado y el runtime lanza error críptico.

- **[2026-05-28]** Para mostrar info inline en una card sin agregar líneas extra (mantener compacta), usar `<span>` con clase de fondo destacado dentro del párrafo padre, NO `<p>` ni `<div>` que generan línea propia. Patrón: `<span className="partial-inline">5.00 realizadas · Falta 9.51 ha</span>` con `display: inline` + `background` + `border-radius`. La franja se ve como un "chip" inline ámbar.

- **[2026-05-27]** Bottom sheet del operario (`.more-sheet`) tiene ancho FIJO de 440px en viewport >= 600px. El `.finish-grid` con 3 columnas (220px + 1fr + 180px ≈ 450px) DESBORDA dentro del sheet entre 600-900px (el media query @900px que lo colapsa a 1 col solo dispara más chico). Síntoma visual: labels superpuestos ("Ha ejecutadas" sobre "Horometro final"), botón "Finalizar" cortado, scroll horizontal. → Solución: forzar grid a 1 columna dentro del sheet con selector específico `.active-sheet .finish-grid, .more-sheet .finish-grid { grid-template-columns: 1fr; }`. También `overflow-x: hidden` + `box-sizing: border-box` en `.more-sheet` para defensa adicional. Mobile no se ve afectado (ya estaba en 1 col).

- **[2026-05-27]** Para que un input "acumule" valor entre sesiones (caso PARCIAL: el operario continúa la labor al día siguiente y debe ver el `executedArea` previo), usar un `useEffect` que pre-llene el draft cuando se selecciona la asignación, con guard contra sobreescribir un draft en curso: `if (existing && existing.area !== '') return current`. El effect depende de `selectedActiveAssignment` y se vuelve a disparar si el server sync actualiza la asignación — el guard previene loops y pérdida de datos.

- **[2026-05-27]** El campo `<input type="number">` del finish form recibe el valor del draft como `value={draft?.area ?? ''}`. Si pre-llenas el draft con `executedArea.toFixed(2)` (string), el input lo acepta sin warning. Pero si pre-llenas con `executedArea` directo (number), React tira warning "value should be string". Siempre stringificar al pre-llenar.

- **[2026-05-27]** Botones de dictado (`DictateButton`, `DictateInlineButton`) antes devolvían `null` si el navegador no soportaba Web Speech API. El operario veía el form descalibrado y pensaba "ya no funciona". → Solución: mostrar el botón **deshabilitado** con icono de micrófono tachado (línea `<line x1="2" y1="2" x2="22" y2="22" />` cruzando el SVG) y tooltip "Dictado no disponible. Usa Chrome o Edge actualizado." Además `supported` debe ser síncrono (initial state via `useState(() => ...)`), no en `useEffect`, para evitar flicker null → botón.

- **[2026-05-27]** Errores del dictado (`recognition.onerror`) tienen códigos en inglés (`not-allowed`, `audio-capture`, `no-speech`, `network`, `aborted`, etc.). El operario ve "permiso denegado" como botón mudo si no se le traduce. → Crear `dictationErrorMessage(code)` en `useDictation.ts` que traduce a mensajes en español accionables ("Permite el microfono desde el icono junto a la URL"). Pasar `onError={handleDictateError}` que setea `setError(dictationErrorMessage(err))` en cada uso crítico del operario.

- **[2026-05-27]** Theme toggle: cada selector con override en `:root[data-theme="dark"]` debe coincidir EXACTAMENTE con el selector real en el HTML. Confundí `.status-pill--done` (BEM con doble guión) con la clase real `.status-pill.done` (compuesta con espacio). Resultado: en dark los pills "Parcial"/"Completada" quedaron con colores light invisibles. → Antes de hacer override en dark, abrir DevTools, inspeccionar el elemento, copiar las clases reales. Mantener ambas variantes (`status-pill--done`, `status-pill.done`) en el override si hay duda — los selectores que no matchean nada son inocuos.

- **[2026-05-27]** Al migrar literales de color en `App.css` para soportar dark mode: priorizar **superficies grandes** (`.app-shell`, `.modal-card`, `.side-drawer`, cards principales, inputs base). Los chips y badges con clases específicas (`.user-card`, `.entity-card`, `.labor-cell-box.*`, `.summary-filters-bar select`) NO heredan automáticamente — necesitan override puntual en el bloque `:root[data-theme="dark"]`. App.css tenía 332 ocurrencias de literales; migré ~70 en superficies + ~50 overrides dirigidos en dark. Anti-flash: script inline en `index.html` ANTES de React monta para evitar parpadeo light→dark.

- **[2026-05-15]** En el LoginView las sugerencias se truncaban con `.slice(0, 10)` y SAM tiene 30+ operadores, los que quedaban fuera no aparecían → solución: en listas que pueden tener N items reales, no usar slice (o usar slice mayor que el total posible) y dejar que el scroll interno del dropdown (`max-height + overflow-y: auto`) maneje el overflow. Ordenar alfabéticamente con `localeCompare('es', { sensitivity: 'base' })` para que el usuario ubique su entrada visualmente.
- **[2026-05-15]** En LoginView usabamos `SearchableSelect`, pero un operador que tecleaba sin seleccionar dejaba `userId` vacío → el RPC `app_login` respondía error y la app mostraba "Credenciales inválidas" confundiendo al usuario → solución: usar input de texto libre + `resolveUserId(input, users)` que matchea id exacto, nombre exacto, o nombre parcial único antes de llamar al RPC. Si nada matchea, dejar pasar el input crudo para que el servidor sea quien rechace.
- **[2026-05-15]** El catch del handleLogin trataba CUALQUIER error como "Credenciales inválidas", incluyendo errores de red (timeout, fetch failed) → cuando el VPS estaba caído los operadores creían que su PIN estaba mal → solución: distinguir `isNetworkError` (msg incluye fetch/network/timeout/`failed to fetch` o `!navigator.onLine`) y mostrar "No pudimos contactar al servidor" en ese caso. Reservar "Credenciales inválidas" SOLO cuando el servidor respondió rechazando.
- **[2026-04-10]** SearchableSelect requires string values but was passed numeric IDs, causing TypeScript error TS2322 → solución: Always cast IDs or codes to String() when mapping them to options for SearchableSelect
- **[2026-04-10]** Custom dropdown options (SearchableSelect) were transparent and clicks didn't register (no deja elegir) → solución: Used explicit hex colors instead of undefined CSS variables for dropdown background, and changed onClick to onMouseDown with e.preventDefault() on the <li> options to prevent focus loss.

- **[2026-04-09]** Los `<select>` de hacienda usan `value={form.haciendaCode}` como string aunque `haciendaCode` es `number` en el dominio. Convertir con `Number()` solo al consumir, no en el estado del form
- **[2026-04-09]** NO usar `<form>` con `action` ni `method` — solo `onSubmit` con `event.preventDefault()` (es una SPA)
- **[2026-04-09]** Al resetear `haciendaCode`, siempre resetear también `suerte` en la misma operación — de lo contrario queda una suerte huérfana de la hacienda anterior seleccionada
- **[2026-04-09]** El campo `equipmentCode` del operador tiene fallback en cascada: `freeFieldForm.equipmentCode || session.equipmentCode` — mantener ese fallback en el `value` del select para que el equipo asignado al operador aparezca pre-seleccionado
- **[2026-04-09]** `startTransition` se usa en `hydrate()` para actualizaciones de estado no urgentes (maestro, asignaciones, usuarios, equipos) — mantenerlo para no bloquear el render de la UI de carga

## 🔴 Los tres campos que hay que revisar antes de dar un formulario por terminado

Las tres reglas nacieron de reclamos del cliente, no de teoría. Se revisan **campo
por campo** antes de cerrar cualquier formulario nuevo.

### 1. Lista larga → `<SearchableSelect>`, nunca un `<select>` plano

Operarios, insumos, máquinas, suertes, usuarios. Un desplegable con 40 nombres es
inusable en celular. Soporta `frecuente: true` en las opciones de uso diario: solo
esas se ven al abrir, el resto queda tras "⋯ Otros (N)", y al escribir busca en
todas.

### 2. Lista de texto que se repite → `<CampoLista tipo="…">`, que SUGIERE

`components/CampoPlaca.tsx`. Input escribible + `datalist`, con tres fuentes:
`catalogos_valores` del servidor, su espejo en `localStorage` (sigue sugiriendo
**sin señal**) y lo que ya se escribió en ese equipo. Al guardar,
`recordarValor(tipo, v)`.

Lo importante es lo que **no** hace: no bloquea. Antes las placas salían de una
tabla `vehiculos` con su pantalla de alta, y para tanquear un carro nuevo tocaba
darlo de alta primero — en la bomba a las 6 de la mañana eso no es un control, es
un registro que no se hace. Un catálogo que obliga no produce datos limpios.

Tipos vivos: `ESTACION`, `PLACA`, `USO`, `MOTIVO_RECHAZO`. Para placas va
`<CampoPlaca>`, que además normaliza (`abc 123` = `ABC-123` = `ABC123`).
**Agregar una lista nueva NO necesita migración**: basta un `tipo` nuevo en
`LISTAS` de `CatalogosInsumosTab`.

### 3. Lo que se digita va en MAYÚSCULA

`lib/texto.ts` (`aMayus`) + `autoCapitalize="characters"` en el input. Los mismos
datos los escriben cinco personas y "campoalegre" / "CampoAlegre" terminan siendo
dos filas distintas en un reporte. **No tocar fechas, horas ni números.**

### Y además: fecha Y hora en todo registro de entrega

Nunca solo el día. Con la hora se mide el tiempo de respuesta al operario y se
reconstruye la ruta del supervisor. `lib/fechas.ts` (`fmtFechaHora`, `fmtLapso`),
zona fija `America/Bogota` y 24 h — así la hora no depende del reloj de quien mira.
Aplica a pantallas Y a los Excel.

## Un booleano que puede no saberse va NULLABLE

`insumos_solicitudes.engraso` (¿engrasó la máquina?) tiene tres estados: `true`,
`false` y `null` = **no se preguntó**. Un `boolean NOT NULL DEFAULT false` afirma
que ninguna máquina se ha engrasado nunca, que es distinto de no saber — y ahí
caerían todas las filas anteriores a la migración.

Del lado del formulario, el control arranca **sin elegir** (`<SwitchEngraso>`, dos
botones SÍ/NO que se pueden desmarcar). Si viniera en NO por defecto, un descuido
quedaría registrado como un hecho negativo, que es peor que un dato vacío.
