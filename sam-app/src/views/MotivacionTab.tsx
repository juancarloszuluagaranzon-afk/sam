import { useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { saveMotivacion, uploadMotivacionImagen } from '../services/samApi'
import { Ayuda } from '../components/Ayuda'

/**
 * Pestaña "Motivación" (propietario / administración) — submenú Catálogos.
 *
 * Configura el refuerzo que ve el operario cuando su rendimiento quincenal
 * alcanza el umbral: mensaje + imagen/GIF. Las metas por labor (que alimentan
 * el rendimiento) se editan en Catálogos → Labores.
 * Requiere la migración 20260712120000_rendimiento_operario.
 */
export function MotivacionTab() {
  const { motivacion, setMotivacion, session, busy, setBusy, setError, setInfo } = useAppData()

  const [mensaje, setMensaje] = useState(motivacion.mensaje)
  const [umbral, setUmbral] = useState(String(motivacion.umbral))
  const [metaDiaRef, setMetaDiaRef] = useState(String(motivacion.metaDiaRef))
  const [activo, setActivo] = useState(motivacion.activo)
  const [imagenUrl, setImagenUrl] = useState<string | null>(motivacion.imagenUrl)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const puedeConfigurar = session?.role === 'owner' || session?.role === 'administracion'

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 3 * 1024 * 1024) {
      setError('La imagen/GIF debe pesar menos de 3 MB para que cargue rápido en el campo.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setSubiendo(true)
    setError('')
    try {
      const url = await uploadMotivacionImagen(file)
      setImagenUrl(url)
      setInfo('Imagen cargada. No olvides Guardar.')
    } catch (err) {
      const ex = err as { message?: string }
      setError(`No se pudo subir la imagen. (${ex?.message ?? 'error'})`)
    } finally {
      setSubiendo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function guardar() {
    const u = Number(umbral)
    if (isNaN(u) || u <= 0) { setError('El umbral debe ser un número mayor a 0 (ej. 100).'); return }
    const ref = Number(metaDiaRef)
    if (isNaN(ref) || ref <= 0) { setError('La meta diaria de referencia debe ser un número mayor a 0 (ej. 15).'); return }
    setBusy(true)
    setError('')
    try {
      const saved = await saveMotivacion({ mensaje: mensaje.trim(), umbral: u, metaDiaRef: ref, activo, imagenUrl })
      setMotivacion(saved)
      setInfo('Motivación guardada.')
    } catch (err) {
      const ex = err as { message?: string }
      setError(`No se pudo guardar. (${ex?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  if (!puedeConfigurar) {
    return <section className="panel-card"><p className="muted-text">Solo el dueño o administración puede configurar la motivación.</p></section>
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Motivación del operario</h2>
      </div>
      <Ayuda>
        <p>Mensaje e imagen/GIF que ve el operario cuando su rendimiento de la quincena llega al umbral.
        Las <strong>metas por labor</strong> se ponen en Catálogos → Labores.</p>
      </Ayuda>

      <div className="motiv-grid">
        <div className="motiv-form">
          <label>
            Mensaje de felicitación
            <input type="text" value={mensaje} maxLength={120} onChange={(e) => setMensaje(e.target.value)} disabled={busy} placeholder="¡Vas muy bien! Sigue así 💪" />
          </label>
          <label>
            Umbral de felicitación (% de la meta quincenal)
            <input type="number" min={1} step="1" value={umbral} onChange={(e) => setUmbral(e.target.value)} disabled={busy} />
          </label>
          <label>
            Meta diaria de referencia (ha/día para "buen día")
            <input type="number" min={1} step="any" value={metaDiaRef} onChange={(e) => setMetaDiaRef(e.target.value)} disabled={busy} />
          </label>
          <label className="motiv-check">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} disabled={busy} />
            <span>Mostrar la felicitación a los operarios</span>
          </label>

          <div className="motiv-upload">
            <span className="labor-label">Imagen o GIF (alguien de la empresa)</span>
            <input ref={fileRef} type="file" accept="image/*,image/gif" onChange={(e) => void onFile(e)} disabled={busy || subiendo} style={{ display: 'none' }} />
            <button type="button" className="inline-button" onClick={() => fileRef.current?.click()} disabled={busy || subiendo}>
              {subiendo ? 'Subiendo…' : imagenUrl ? '↻ Cambiar imagen' : '📷 Subir imagen / GIF'}
            </button>
            {imagenUrl && (
              <button type="button" className="inline-button maestro-delete-btn" onClick={() => setImagenUrl(null)} disabled={busy}>
                Quitar
              </button>
            )}
            <p className="subtle-copy" style={{ margin: '4px 0 0', fontSize: '0.76rem' }}>Máximo 3 MB. Un GIF pequeño funciona.</p>
          </div>

          <div className="modal-footer" style={{ marginTop: 8 }}>
            <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy || subiendo}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>

        {/* Vista previa tal cual la ve el operario */}
        <div className="motiv-preview">
          <p className="subtle-copy" style={{ margin: '0 0 8px' }}>Vista previa</p>
          <div className="rendimiento-card rendimiento-card--top">
            <div className="rendimiento-card__head">
              <div>
                <p className="rendimiento-card__eyebrow">Tu rendimiento · quincena</p>
                <div className="rendimiento-card__pct">{umbral || 100}%</div>
                <p className="rendimiento-card__sub">¡Vas por encima de la meta! 🔥</p>
              </div>
            </div>
            <div className="rendimiento-card__bar"><span style={{ width: '100%' }} /></div>
            <div className="rendimiento-dia">
              <div className="rendimiento-dia__item rendimiento-dia__item--ok">
                <span className="rendimiento-dia__label">Promedio por día</span>
                <strong>18 ha</strong>
                <span className="rendimiento-dia__tag">✓ Muy bien (meta {metaDiaRef || 15})</span>
              </div>
              <div className="rendimiento-dia__item rendimiento-dia__item--ok">
                <span className="rendimiento-dia__label">Último día · lun</span>
                <strong>20 ha</strong>
                <span className="rendimiento-dia__tag">🎉 ¡Terminaste muy bien!</span>
              </div>
            </div>
            <div className="rendimiento-hit">
              {imagenUrl && <img src={imagenUrl} alt="" className="rendimiento-hit__img" />}
              <p className="rendimiento-hit__msg">{mensaje || '¡Vas muy bien! Sigue así 💪'}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default MotivacionTab
