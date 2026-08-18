import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import {
  actualizarNovedadTipo, crearNovedadTipo, eliminarNovedadTipo,
  loadNovedadTipos, usoDeNovedades, type NovedadTipoCat,
} from '../services/novedadTiposApi'

/**
 * Los códigos que se pueden marcar en la Planilla.
 *
 * Antes eran quince escritos en el código y agregar uno pedía un despliegue.
 * Ahora administración crea los que necesite.
 *
 * **Lo que la pantalla protege:** un código que ya tiene días marcados NO se
 * borra, se desactiva. Borrarlo dejaría las celdas de los meses pasados sin
 * forma de saber qué significaban — y esa planilla es la base de la nómina.
 */

/** Los mismos tonos del resto del app, para que la planilla no se vuelva un arcoíris. */
const COLORES = [
  { hex: '#2a4a8c', nombre: 'Azul' },
  { hex: '#155b30', nombre: 'Verde' },
  { hex: '#8a5a00', nombre: 'Ámbar' },
  { hex: '#6b4500', nombre: 'Café' },
  { hex: '#7d2e2e', nombre: 'Vino' },
  { hex: '#b3261e', nombre: 'Rojo' },
  { hex: '#4a5040', nombre: 'Gris' },
]

export function NovedadTiposTab() {
  const { busy, setBusy, setError, setInfo } = useAppData()

  const [tipos, setTipos] = useState<NovedadTipoCat[]>([])
  const [uso, setUso] = useState<Map<string, number>>(new Map())
  const [cargando, setCargando] = useState(true)

  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nCodigo, setNCodigo] = useState('')
  const [nNombre, setNNombre] = useState('')
  const [nColor, setNColor] = useState(COLORES[0].hex)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [t, u] = await Promise.all([loadNovedadTipos(), usoDeNovedades()])
      setTipos(t); setUso(u)
    } finally { setCargando(false) }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const siguienteOrden = useMemo(
    () => Math.max(0, ...tipos.filter((t) => t.orden < 900).map((t) => t.orden)) + 10,
    [tipos],
  )

  async function crear() {
    setBusy(true); setError('')
    try {
      await crearNovedadTipo({
        codigo: nCodigo, nombre: nNombre, color: nColor, orden: siguienteOrden,
      })
      setInfo(`Novedad ${nCodigo.toUpperCase()} creada. Ya aparece en la Planilla.`)
      setNuevoOpen(false); setNCodigo(''); setNNombre('')
      void cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear')
    } finally { setBusy(false) }
  }

  async function alternar(t: NovedadTipoCat) {
    setBusy(true); setError('')
    try {
      await actualizarNovedadTipo(t.codigo, { activo: !t.activo })
      setInfo(t.activo
        ? `${t.codigo} desactivada. Deja de ofrecerse, pero lo ya marcado se conserva.`
        : `${t.codigo} activada.`)
      void cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar')
    } finally { setBusy(false) }
  }

  async function cambiarColor(t: NovedadTipoCat, hex: string) {
    setBusy(true); setError('')
    try {
      await actualizarNovedadTipo(t.codigo, { color: hex })
      void cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el color')
    } finally { setBusy(false) }
  }

  async function borrar(t: NovedadTipoCat) {
    setBusy(true); setError('')
    try {
      await eliminarNovedadTipo(t.codigo)
      setInfo(`${t.codigo} eliminada.`)
      void cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar')
    } finally { setBusy(false) }
  }

  return (
    <section className="panel">
      <div className="panel-title split">
        <h2>🏷️ Novedades de la planilla</h2>
        <button type="button" className="primary-button" onClick={() => setNuevoOpen(true)}>
          ＋ Nueva novedad
        </button>
      </div>

      <Ayuda>
        <p>
          Los códigos que se pueden marcar en la Planilla cuando un operario no
          estuvo produciendo: vacaciones, taller, lluvia, lo que haga falta.
          Crea los que necesites.
        </p>
        <p>
          <strong>Una novedad que ya se usó no se borra, se desactiva.</strong> Deja de
          aparecer como botón, pero los días que ya están marcados con ella se siguen
          viendo — si se borrara, la planilla de meses pasados quedaría con celdas
          que nadie sabe qué significan.
        </p>
      </Ayuda>

      {cargando ? <p className="muted-text">Cargando…</p> : (
        <div className="nov-tabla">
          <div className="nov-fila nov-fila--cab">
            <span>Código</span><span>Qué significa</span><span>Color</span>
            <span>Días marcados</span><span></span>
          </div>
          {tipos.map((t) => {
            const veces = uso.get(t.codigo) ?? 0
            return (
              <div key={t.codigo} className={`nov-fila${t.activo ? '' : ' nov-fila--off'}`}>
                <span className="nov-codigo" style={{ color: t.color }}>{t.codigo}</span>
                <span>
                  {t.nombre}
                  {!t.activo && <small> · desactivada</small>}
                </span>
                <span className="nov-colores">
                  {COLORES.map((c) => (
                    <button key={c.hex} type="button" title={c.nombre} disabled={busy}
                            className={`nov-color${t.color === c.hex ? ' is-sel' : ''}`}
                            style={{ background: c.hex }}
                            onClick={() => void cambiarColor(t, c.hex)} />
                  ))}
                </span>
                <span className="nov-uso">{veces > 0 ? veces : '—'}</span>
                <span className="nov-acciones">
                  <button type="button" className="inline-button" disabled={busy}
                          onClick={() => void alternar(t)}>
                    {t.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  {/* Solo se ofrece borrar lo que nadie usó: con historia, la
                      única salida sana es desactivar. */}
                  {veces === 0 && !t.delSistema && (
                    <button type="button" className="link-danger" disabled={busy}
                            onClick={() => void borrar(t)}>Eliminar</button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {nuevoOpen && (
        <div className="modal-overlay open" onClick={() => setNuevoOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}
               style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Planilla</p><h3>＋ Nueva novedad</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevoOpen(false)}>✕</button>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Código <span className="field-optional">(1 a 3 letras)</span></span>
                <input type="text" maxLength={3} autoCapitalize="characters" autoFocus
                       value={nCodigo}
                       onChange={(e) => setNCodigo(e.target.value.toUpperCase().replace(/\s/g, ''))}
                       placeholder="Ej: CM" style={{ textTransform: 'uppercase' }} />
              </label>
              <label className="field">
                <span>Qué significa</span>
                <input type="text" value={nNombre} onChange={(e) => setNNombre(e.target.value)}
                       placeholder="Ej: Comisión" />
              </label>
            </div>

            <p className="ins-res__lbl" style={{ marginTop: 10 }}>Color en la planilla</p>
            <div className="nov-colores nov-colores--grande">
              {COLORES.map((c) => (
                <button key={c.hex} type="button" title={c.nombre}
                        className={`nov-color${nColor === c.hex ? ' is-sel' : ''}`}
                        style={{ background: c.hex }} onClick={() => setNColor(c.hex)} />
              ))}
            </div>

            <p className="subtle-copy" style={{ marginTop: 12 }}>
              Así se va a ver en la celda:{' '}
              <strong style={{ color: nColor }}>{nCodigo || '??'}</strong>
            </p>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setNuevoOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="primary-button" disabled={busy || !nCodigo || !nNombre}
                      onClick={() => void crear()}>Crear novedad</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default NovedadTiposTab
