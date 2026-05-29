import { useEffect, useState, type FormEvent } from 'react'
import type { MaestroRow } from '../domain/sam'
import { createMaestroRow } from '../services/samApi'

interface Props {
  open: boolean
  onClose: () => void
  /** Operario / supervisor que esta creando la suerte (para audit trail). */
  createdBy: string
  /** Lista de haciendas conocidas para que el usuario elija o escriba una nueva. */
  haciendas: { code: string; name: string }[]
  /** Lista de ingenios soportados (los IDs canonicos del sistema). */
  ingenios: { id: string; nombre: string }[]
  /** Maestro completo para detectar duplicados en cliente antes de pegarle a la API. */
  maestro: MaestroRow[]
  /** Pre-llenado opcional desde el form padre para minimizar tecleo. */
  prefillHaciendaCode?: string
  prefillIngenioId?: string
  /** Al exito, el componente padre puede auto-seleccionar la nueva suerte. */
  onCreated: (row: MaestroRow) => void
}

/**
 * Modal compacto para crear una suerte que aun no esta en el maestro
 * oficial. Lo abren el supervisor (form de Asignar) y el operario
 * (form de Tomar suerte en campo) cuando una suerte real del campo
 * no aparece en el dropdown.
 *
 * La fila se inserta en `maestro_risaralda` con `creado_manual=true`
 * para que un owner pueda revisarla luego y conciliar con el catalogo
 * del ingenio.
 */
export function NewSuerteModal({
  open,
  onClose,
  createdBy,
  haciendas,
  ingenios,
  maestro,
  prefillHaciendaCode,
  prefillIngenioId,
  onCreated,
}: Props) {
  const [haciendaCode, setHaciendaCode] = useState('')
  const [haciendaName, setHaciendaName] = useState('')
  const [suerte, setSuerte] = useState('')
  const [areaStr, setAreaStr] = useState('')
  const [ingenioId, setIngenioId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Cada vez que se abre el modal, reinicia campos y pre-llena lo que
  // el padre haya pasado. Si la hacienda pre-llenada existe en el
  // catalogo, tambien rellena su nombre para que el usuario no la teclee.
  useEffect(() => {
    if (!open) return
    setError('')
    setBusy(false)
    setSuerte('')
    setAreaStr('')
    setIngenioId(prefillIngenioId ?? '')
    if (prefillHaciendaCode) {
      const hacienda = haciendas.find((h) => h.code === prefillHaciendaCode)
      setHaciendaCode(prefillHaciendaCode)
      setHaciendaName(hacienda?.name ?? '')
    } else {
      setHaciendaCode('')
      setHaciendaName('')
    }
  }, [open, prefillHaciendaCode, prefillIngenioId, haciendas])

  // Cuando el usuario cambia la hacienda manualmente desde el select,
  // pre-llenamos su nombre. Si escribe una hacienda nueva, el nombre
  // queda vacio para que la complete.
  function handleHaciendaChange(code: string) {
    setHaciendaCode(code)
    const hacienda = haciendas.find((h) => h.code === code)
    setHaciendaName(hacienda?.name ?? '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const trimmedHaciendaCode = haciendaCode.trim()
    const trimmedHaciendaName = haciendaName.trim()
    const trimmedSuerte = suerte.trim()
    const areaValue = Number(areaStr)

    if (!trimmedHaciendaCode || !trimmedHaciendaName || !trimmedSuerte || !ingenioId) {
      setError('Completa hacienda, suerte e ingenio.')
      return
    }
    if (!areaValue || isNaN(areaValue) || areaValue <= 0) {
      setError('Ingresa un area valida en hectareas.')
      return
    }

    // Defensa en cliente contra duplicados antes de pegarle al servidor
    // (mejor UX que el 23505 de Postgres). Si por sync race condition
    // dos clientes la crean al mismo tiempo, el server-side unique constraint
    // bloquea el segundo y el catch traduce el error.
    const dup = maestro.some(
      (row) =>
        row.haciendaCode === trimmedHaciendaCode &&
        row.suerte === trimmedSuerte &&
        row.ingenio_id === ingenioId,
    )
    if (dup) {
      setError(
        `Esa suerte ya existe en el maestro de ${ingenios.find((i) => i.id === ingenioId)?.nombre ?? ingenioId}. Cierra este modal y selecciónala.`,
      )
      return
    }

    setBusy(true)
    try {
      const row = await createMaestroRow({
        haciendaCode: trimmedHaciendaCode,
        haciendaName: trimmedHaciendaName,
        suerte: trimmedSuerte,
        area: areaValue,
        ingenio_id: ingenioId,
        createdBy,
      })
      onCreated(row)
      onClose()
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE') {
        setError(
          'Otro usuario ya creo esa suerte. Cierra este modal y selecciónala del listado.',
        )
      } else {
        setError('No se pudo crear la suerte. Verifica conexion e intenta de nuevo.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        e.stopPropagation()
        if (!busy) onClose()
      }}
    >
      <div
        className="modal-card new-suerte-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Maestro de suertes</p>
            <h3>Nueva suerte</h3>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
          >
            &#x2715;
          </button>
        </div>

        <p className="subtle-copy" style={{ marginTop: 0 }}>
          Solo usar cuando la suerte real del campo no aparece en el
          listado oficial. Queda marcada como creada manualmente para
          revision posterior.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Ingenio
            <select
              value={ingenioId}
              onChange={(e) => setIngenioId(e.target.value)}
              disabled={busy}
            >
              <option value="">Seleccionar ingenio</option>
              {ingenios.map((ing) => (
                <option key={ing.id} value={ing.id}>{ing.nombre}</option>
              ))}
            </select>
          </label>

          <label>
            Codigo de hacienda
            <input
              type="text"
              value={haciendaCode}
              onChange={(e) => handleHaciendaChange(e.target.value)}
              placeholder="Ej: 105"
              disabled={busy}
              list="hacienda-codes-datalist"
            />
            <datalist id="hacienda-codes-datalist">
              {haciendas.map((h) => (
                <option key={h.code} value={h.code}>{h.name}</option>
              ))}
            </datalist>
          </label>

          <label>
            Nombre de la hacienda
            <input
              type="text"
              value={haciendaName}
              onChange={(e) => setHaciendaName(e.target.value)}
              placeholder="Ej: SAN MIGUEL"
              disabled={busy}
            />
          </label>

          <label>
            Numero de suerte
            <input
              type="text"
              value={suerte}
              onChange={(e) => setSuerte(e.target.value)}
              placeholder="Ej: 0042"
              disabled={busy}
              maxLength={20}
            />
          </label>

          <label>
            Area neta (hectareas)
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={areaStr}
              onChange={(e) => setAreaStr(e.target.value)}
              placeholder="Ej: 14.51"
              disabled={busy}
            />
          </label>

          {error && <div className="feedback error">{error}</div>}

          <div className="modal-footer">
            <button
              type="button"
              className="inline-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy}
            >
              {busy ? 'Creando...' : 'Crear suerte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
