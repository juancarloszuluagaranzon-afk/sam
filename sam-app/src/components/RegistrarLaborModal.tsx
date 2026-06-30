import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import SearchableSelect from './SearchableSelect'
import { registrarLaborRealizada } from '../services/samApi'
import { db } from '../lib/db'
import type { Zone } from '../domain/sam'

const INGENIOS = [
  { id: 'risaralda', nombre: 'Ingenio Risaralda' },
  { id: 'pichichi', nombre: 'Ingenio Pichichi' },
  { id: 'mayaguez', nombre: 'Ingenio Mayagüez' },
  { id: 'san_carlos', nombre: 'Ingenio San Carlos' },
  { id: 'riopaila', nombre: 'Ingenio Riopaila' },
]

interface Props {
  open: boolean
  onClose: () => void
}

const EMPTY = {
  operatorId: '',
  ingenioId: '',
  haciendaCode: '',
  suerte: '',
  labor: '',
  equipmentCode: '',
  cliente: '' as '' | 'ingenios' | 'proveedores',
  horometroInicial: '',
  horometroFinal: '',
  hectareas: '',
  isComplete: false,
}

/**
 * Registro RÁPIDO de una labor YA REALIZADA, que el SUPERVISOR llena por un
 * operario poco afín a la tecnología. Una sola pantalla: operario, ingenio,
 * hacienda, suerte, labor, equipo, horómetro inicial+final, hectáreas y tipo
 * de cliente. Supervisor y zona se toman del supervisor logueado (no se piden).
 * Crea la labor COMPLETADA + APROBADA en un solo paso.
 */
export function RegistrarLaborModal({ open, onClose }: Props) {
  const {
    session, users, operators, equipment, sortedEquipment, maestro, activeLabores,
    setAssignments, isOnline, busy, setBusy, setError, setInfo, error,
  } = useAppData()

  const [form, setForm] = useState(EMPTY)

  const miZona = useMemo(() => users.find((u) => u.id === session?.id)?.zona ?? '', [users, session?.id])

  const operatorOptions = useMemo(
    () => operators.map((o) => ({ value: o.id, label: o.name })),
    [operators],
  )
  const equipmentOptions = useMemo(
    () => (sortedEquipment ?? equipment).map((e) => ({ value: e.code, label: e.name })),
    [sortedEquipment, equipment],
  )
  const laborOptions = useMemo(() => activeLabores.map((l) => ({ value: l, label: l })), [activeLabores])

  const haciendaOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of maestro) {
      if (form.ingenioId && r.ingenio_id !== form.ingenioId) continue
      if (!m.has(r.haciendaCode)) m.set(r.haciendaCode, r.haciendaName)
    }
    return Array.from(m.entries())
      .map(([code, name]) => ({ value: code, label: `${code} · ${name}` }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [maestro, form.ingenioId])

  const suerteOptions = useMemo(() => {
    if (!form.haciendaCode) return []
    return maestro
      .filter((r) => r.haciendaCode === form.haciendaCode && (!form.ingenioId || r.ingenio_id === form.ingenioId))
      .map((r) => ({ value: r.suerte, label: r.suerte }))
      .sort((a, b) => a.value.localeCompare(b.value))
  }, [maestro, form.haciendaCode, form.ingenioId])

  // Área de la suerte seleccionada (del maestro) → default de "hectáreas".
  const suerteArea = useMemo(() => {
    if (!form.suerte) return null
    const row = maestro.find(
      (r) => r.ingenio_id === form.ingenioId && r.haciendaCode === form.haciendaCode && r.suerte === form.suerte,
    )
    return row ? row.area : null
  }, [maestro, form.ingenioId, form.haciendaCode, form.suerte])

  function set<K extends keyof typeof EMPTY>(field: K, value: (typeof EMPTY)[K]) {
    setForm((f) => {
      if (field === 'ingenioId') return { ...f, ingenioId: value as string, haciendaCode: '', suerte: '', hectareas: '', isComplete: false }
      if (field === 'haciendaCode') return { ...f, haciendaCode: value as string, suerte: '', hectareas: '', isComplete: false }
      if (field === 'suerte') {
        const sue = value as string
        // Al elegir la suerte NO se asume el 100%: el toggle queda apagado y las
        // hectáreas vacías para que el supervisor las ingrese (o active el 100%).
        // El área de la suerte se muestra siempre como referencia.
        return {
          ...f,
          suerte: sue,
          hectareas: '',
          isComplete: false,
        }
      }
      if (field === 'operatorId') {
        const op = operators.find((o) => o.id === value)
        // Auto-rellena el equipo con el del operario si aún no se eligió uno.
        return { ...f, operatorId: value as string, equipmentCode: f.equipmentCode || op?.equipmentCode || '' }
      }
      return { ...f, [field]: value }
    })
  }

  function toggleComplete() {
    setForm((f) => {
      const next = !f.isComplete
      // Encender 100% → hectáreas = área de la suerte. Apagar → editable.
      return next && suerteArea != null
        ? { ...f, isComplete: true, hectareas: suerteArea.toFixed(2) }
        : { ...f, isComplete: next }
    })
  }

  function reset() {
    setForm(EMPTY)
    setError('')
  }
  function closeAll() {
    if (busy) return
    reset()
    onClose()
  }

  async function submit() {
    if (!session) return
    const op = operators.find((o) => o.id === form.operatorId)
    if (!op) return setError('Selecciona el operario.')
    if (!form.ingenioId) return setError('Selecciona el ingenio.')
    const mrow = maestro.find(
      (r) => r.ingenio_id === form.ingenioId && r.haciendaCode === form.haciendaCode && r.suerte === form.suerte,
    )
    if (!form.haciendaCode || !form.suerte || !mrow) return setError('Selecciona hacienda y suerte.')
    if (!form.labor) return setError('Selecciona la labor realizada.')
    const eq = equipment.find((e) => e.code === form.equipmentCode)
    if (!eq) return setError('Selecciona el equipo.')
    if (form.cliente !== 'ingenios' && form.cliente !== 'proveedores') return setError('Selecciona el tipo de cliente.')
    const area = Number(form.hectareas)
    if (!area || isNaN(area) || area <= 0) return setError('Ingresa las hectáreas realizadas (> 0).')
    const hi = form.horometroInicial.trim() === '' ? null : Number(form.horometroInicial)
    const hf = form.horometroFinal.trim() === '' ? null : Number(form.horometroFinal)
    if (hi !== null && isNaN(hi)) return setError('Horómetro inicial inválido.')
    if (hf !== null && isNaN(hf)) return setError('Horómetro final inválido.')
    if (hi !== null && hf !== null && hf < hi) return setError('El horómetro final no puede ser menor al inicial.')
    if (!isOnline) return setError('Necesitas conexión para registrar la labor.')

    setBusy(true)
    setError('')
    try {
      const created = await registrarLaborRealizada({
        haciendaCode: mrow.haciendaCode,
        haciendaName: mrow.haciendaName,
        suerte: mrow.suerte,
        labor: form.labor,
        operatorId: op.id,
        operatorName: op.name,
        supervisorId: session.id,
        supervisorName: session.name,
        equipmentCode: eq.code,
        equipmentName: eq.name,
        area,
        horometroInicial: hi,
        horometroFinal: hf,
        cliente: form.cliente,
        zone: miZona === 'NORTE' || miZona === 'SUR' ? (miZona as Zone) : null,
      })
      setAssignments((prev) => [created, ...prev])
      try { await db.assignments.put(created) } catch { /* sin cache */ }
      setInfo(`Labor registrada: ${created.labor} en ${created.haciendaName} ${created.suerte} (${area.toFixed(2)} ha) para ${op.name}.`)
      reset()
      onClose()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar la labor. (${e?.message ?? 'error'}) — verifica conexión y/o avisa al admin.`)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay open new-suerte-overlay" onClick={closeAll}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 'min(480px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}
      >
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Registro rápido</p>
            <h3>Registrar labor realizada</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={closeAll} disabled={busy} aria-label="Cerrar">
            &#x2715;
          </button>
        </div>

        <p className="subtle-copy" style={{ marginTop: 0 }}>
          Para anotar lo que hizo un operario. Supervisor <strong>{session?.name}</strong>
          {miZona ? <> · Zona <strong>{miZona === 'NORTE' ? 'Norte' : miZona === 'SUR' ? 'Sur' : miZona}</strong></> : null}
          {' '}se asignan automáticamente.
        </p>

        <label className="field">
          <span>Operario</span>
          <SearchableSelect
            value={form.operatorId}
            onChange={(v) => set('operatorId', v)}
            options={operatorOptions}
            placeholder="Buscar operario…"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Tipo de cliente</span>
            <select value={form.cliente} onChange={(e) => set('cliente', e.target.value as typeof EMPTY.cliente)} disabled={busy}>
              <option value="">Selecciona…</option>
              <option value="ingenios">Ingenios</option>
              <option value="proveedores">Proveedores</option>
            </select>
          </label>
          <label className="field">
            <span>Ingenio</span>
            <select value={form.ingenioId} onChange={(e) => set('ingenioId', e.target.value)} disabled={busy}>
              <option value="">Selecciona…</option>
              {INGENIOS.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Hacienda</span>
          <SearchableSelect
            value={form.haciendaCode}
            onChange={(v) => set('haciendaCode', v)}
            options={haciendaOptions}
            placeholder={form.ingenioId ? 'Buscar hacienda…' : 'Elige primero el ingenio'}
          />
        </label>

        <label className="field">
          <span>Suerte</span>
          <SearchableSelect
            value={form.suerte}
            onChange={(v) => set('suerte', v)}
            options={suerteOptions}
            placeholder={form.haciendaCode ? 'Buscar suerte…' : 'Elige primero la hacienda'}
          />
        </label>

        {suerteArea != null && (
          <div
            className="suerte-area-info"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              marginTop: -4,
              borderRadius: 10,
              background: 'rgba(30,77,26,0.12)',
              border: '1px solid rgba(30,77,26,0.25)',
            }}
          >
            <span className="complete-toggle-label">Área de la suerte</span>
            <strong>{suerteArea.toFixed(2)} ha</strong>
          </div>
        )}

        <label className="field">
          <span>Labor realizada</span>
          <SearchableSelect
            value={form.labor}
            onChange={(v) => set('labor', v)}
            options={laborOptions}
            placeholder="Buscar labor…"
          />
        </label>

        <label className="field">
          <span>Equipo</span>
          <SearchableSelect
            value={form.equipmentCode}
            onChange={(v) => set('equipmentCode', v)}
            options={equipmentOptions}
            placeholder="Buscar equipo…"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Horómetro inicial</span>
            <input type="number" inputMode="decimal" step="0.1" value={form.horometroInicial}
              onChange={(e) => set('horometroInicial', e.target.value)} disabled={busy} placeholder="opcional" />
          </label>
          <label className="field">
            <span>Horómetro final</span>
            <input type="number" inputMode="decimal" step="0.1" value={form.horometroFinal}
              onChange={(e) => set('horometroFinal', e.target.value)} disabled={busy} placeholder="opcional" />
          </label>
        </div>

        {suerteArea != null && (
          <div className="complete-toggle-row" style={{ marginTop: 4 }}>
            <div>
              <span className="complete-toggle-label">Hizo el 100% de la suerte</span>
              <span className="complete-toggle-hint">
                {form.isComplete
                  ? `Se registran las ${suerteArea.toFixed(2)} ha completas`
                  : `Actívalo si hizo toda la suerte (${suerteArea.toFixed(2)} ha)`}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.isComplete}
              className={`toggle-switch ${form.isComplete ? 'on' : ''}`}
              onClick={toggleComplete}
              disabled={busy}
            >
              <span className="toggle-thumb" />
            </button>
          </div>
        )}

        <label className="field">
          <span>Hectáreas realizadas</span>
          <input type="number" inputMode="decimal" min={0.01} step="0.01" value={form.hectareas}
            onChange={(e) => set('hectareas', e.target.value)}
            disabled={busy || (form.isComplete && suerteArea != null)} />
        </label>

        {error && <div className="feedback error">{error}</div>}

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={closeAll} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Registrando…' : 'Registrar labor'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RegistrarLaborModal
