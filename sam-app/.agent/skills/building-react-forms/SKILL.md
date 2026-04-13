---
name: building-react-forms
description: >
  Patrones de formularios React en SAM. Úsala cuando crees o modifiques
  formularios, estados de formulario, validaciones, o cuando el usuario mencione
  "form", "formulario", "input", "select", "estado del form", "draft",
  "AssignmentFormState" o "handleSubmit".
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
- **[2026-04-10]** SearchableSelect requires string values but was passed numeric IDs, causing TypeScript error TS2322 → solución: Always cast IDs or codes to String() when mapping them to options for SearchableSelect
- **[2026-04-10]** Custom dropdown options (SearchableSelect) were transparent and clicks didn't register (no deja elegir) → solución: Used explicit hex colors instead of undefined CSS variables for dropdown background, and changed onClick to onMouseDown with e.preventDefault() on the <li> options to prevent focus loss.

- **[2026-04-09]** Los `<select>` de hacienda usan `value={form.haciendaCode}` como string aunque `haciendaCode` es `number` en el dominio. Convertir con `Number()` solo al consumir, no en el estado del form
- **[2026-04-09]** NO usar `<form>` con `action` ni `method` — solo `onSubmit` con `event.preventDefault()` (es una SPA)
- **[2026-04-09]** Al resetear `haciendaCode`, siempre resetear también `suerte` en la misma operación — de lo contrario queda una suerte huérfana de la hacienda anterior seleccionada
- **[2026-04-09]** El campo `equipmentCode` del operador tiene fallback en cascada: `freeFieldForm.equipmentCode || session.equipmentCode` — mantener ese fallback en el `value` del select para que el equipo asignado al operador aparezca pre-seleccionado
- **[2026-04-09]** `startTransition` se usa en `hydrate()` para actualizaciones de estado no urgentes (maestro, asignaciones, usuarios, equipos) — mantenerlo para no bloquear el render de la UI de carga
