import { useEffect, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadVehiculos, createVehiculo, updateVehiculo } from '../services/samApi'
import type { Vehiculo } from '../domain/sam'

/**
 * Catálogo de placas. Existe para que nadie escriba la placa a mano en el
 * tanqueo y terminemos con "WGY123", "wgy 123" y "WGY-123" como tres vehículos
 * distintos. Las marcadas como frecuentes son las que salen de entrada en el
 * selector; el resto queda tras "Otros".
 */
export function VehiculosTab() {
  const { busy, setBusy, setError, setInfo } = useAppData()

  const [items, setItems] = useState<Vehiculo[]>([])
  const [cargando, setCargando] = useState(true)
  const [placa, setPlaca] = useState('')
  const [descripcion, setDescripcion] = useState('')

  async function refresh() {
    setCargando(true)
    try { setItems(await loadVehiculos()) } finally { setCargando(false) }
  }
  useEffect(() => { void refresh() }, [])

  async function crear() {
    const p = placa.trim().toUpperCase()
    if (!p) { setError('Escribe la placa.'); return }
    if (items.some((v) => v.placa === p)) { setError('Esa placa ya está en el listado.'); return }
    setBusy(true); setError('')
    try {
      await createVehiculo({ placa: p, descripcion: descripcion.trim() || undefined, frecuente: true })
      setInfo(`Placa ${p} agregada.`)
      setPlaca(''); setDescripcion('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo agregar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function alternar(v: Vehiculo, campo: 'frecuente' | 'activo') {
    setBusy(true); setError('')
    try {
      await updateVehiculo(v.id, { [campo]: !v[campo] })
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo actualizar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <h2>🚗 Placas de vehículos</h2>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Las placas que aparecen al registrar un tanqueo de vehículo. Marca como
        <strong> frecuente</strong> las de uso diario: esas salen de entrada, el resto queda tras “Otros”.
      </p>

      <div className="flota-grid" style={{ marginTop: 10 }}>
        <label>Placa
          <input
            type="text" value={placa}
            onChange={(e) => setPlaca(e.target.value.toUpperCase())}
            placeholder="WGY123" disabled={busy}
          />
        </label>
        <label>Descripción <span className="field-optional">(opcional)</span>
          <input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Camioneta supervisor" disabled={busy} />
        </label>
      </div>
      <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="primary-button" style={{ width: 'auto', flex: '0 0 auto' }} onClick={() => void crear()} disabled={busy}>
          + Agregar placa
        </button>
      </div>

      {cargando ? (
        <p className="muted-text">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="muted-text">Todavía no hay placas registradas.</p>
      ) : (
        <div className="inv-list" style={{ marginTop: 12 }}>
          {items.map((v) => (
            <div key={v.id} className="inv-row">
              <div className="inv-row__main">
                <strong>{v.placa}</strong>
                {v.frecuente && <span className="inv-cat inv-cat--comb">★ Frecuente</span>}
                {v.descripcion && <span className="subtle-copy">{v.descripcion}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="inline-button" onClick={() => void alternar(v, 'frecuente')} disabled={busy}>
                  {v.frecuente ? 'Quitar de frecuentes' : 'Marcar frecuente'}
                </button>
                <button type="button" className="inline-button" onClick={() => void alternar(v, 'activo')} disabled={busy}>
                  Quitar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default VehiculosTab
