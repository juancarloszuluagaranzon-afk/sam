import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { compararEquipos, moverElemento, registrarOrdenEquipos } from '../lib/ordenEquipos'
import { guardarOrdenEquipos, loadEquipmentTodos } from '../services/samApi'
import './olaReunion.css'

type EquipoOrden = { code: string; name: string }

export function OrdenMaquinasModal({ usuarioId, onClose, onGuardado }: {
  usuarioId: string
  onClose: () => void
  onGuardado: () => void
}) {
  const { setInfo } = useAppData()
  const [equipos, setEquipos] = useState<EquipoOrden[]>([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [errorLocal, setErrorLocal] = useState('')
  const [original, setOriginal] = useState<string[]>([])
  useEffect(() => {
    let vivo = true
    loadEquipmentTodos().then((lista) => {
      if (!vivo) return
      const activas = lista.filter((e) => e.active).sort((a, b) => compararEquipos(a.code, b.code))
        .map((e) => ({ code: e.code, name: e.name }))
      setEquipos(activas)
      setOriginal(activas.map((e) => e.code))
    }).catch((e: Error) => { if (vivo) setErrorLocal(e.message) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [])
  const cambiado = useMemo(() => equipos.some((e, i) => original[i] !== e.code), [equipos, original])
  function mover(desde: number, hacia: number) { setEquipos((lista) => moverElemento(lista, desde, hacia)) }
  async function guardar() {
    setGuardando(true); setErrorLocal('')
    try {
      await guardarOrdenEquipos(equipos.map((e) => e.code), usuarioId)
      registrarOrdenEquipos(equipos.map((e, i) => ({ code: e.code, orden: i + 1 })))
      setInfo('Orden guardado.')
      onGuardado()
      onClose()
    } catch (e) { setErrorLocal((e as Error).message || 'No se pudo guardar el orden.') }
    finally { setGuardando(false) }
  }
  return <div className="modal-overlay open" onClick={() => { if (!guardando) onClose() }}>
    <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(560px, calc(100vw - 24px))' }}>
      <div className="labor-detail-header pieza-cab">
        <div><p className="eyebrow">Informes</p><h3>Orden de las máquinas</h3></div>
        <button type="button" className="modal-close-btn" aria-label="Cerrar" disabled={guardando} onClick={onClose}>×</button>
      </div>
      <p>El orden que dejes aquí es el que siguen los informes. Una máquina nueva entra al final y la subes donde corresponda.</p>
      {cargando && <p className="muted-text">Cargando…</p>}
      {errorLocal && <p role="alert" className="ola-error">{errorLocal}</p>}
      {!cargando && <ol className="ola-orden-lista">{equipos.map((e, i) => <li className="ola-orden-fila" key={e.code}>
        <strong>{i + 1}.</strong><span className="ola-orden-datos"><strong>{e.code}</strong><br />{e.name}</span>
        <span className="ola-orden-flechas">
          <button type="button" className="inline-button" disabled={guardando || i === 0} aria-label={`Subir ${e.code}`} onClick={() => mover(i, i - 1)}>↑</button>
          <button type="button" className="inline-button" disabled={guardando || i === equipos.length - 1} aria-label={`Bajar ${e.code}`} onClick={() => mover(i, i + 1)}>↓</button>
        </span>
      </li>)}</ol>}
      {cambiado && <p style={{ color: 'var(--color-status-progress)' }}>Sin guardar</p>}
      <div className="modal-footer pieza-pie">
        <button type="button" className="inline-button" disabled={guardando} onClick={onClose}>Cancelar</button>
        <button type="button" className="primary-button" disabled={guardando || cargando || !cambiado} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar orden'}</button>
      </div>
    </div>
  </div>
}
