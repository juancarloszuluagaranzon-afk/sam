import { useEffect, useRef, useState } from 'react'
import type { MapaConfig } from '../domain/sam'
import { updateMapa } from '../services/samApi'
import { estadoCartografia, subirCartografia } from '../services/fieldmapsApi'

/**
 * Formulario de mapa — subir PDF (experiencia Avenza).
 *
 * AGREGAR: sube el GeoPDF y **cierra de una** (no bloquea). El plano se procesa
 * en segundo plano y aparece solo en Catálogos → Mapas → "Listos para agregar"
 * cuando termina — nunca dejas al usuario mirando una barra congelada.
 *
 * REEMPLAZAR: como sí hay que actualizar un mapa existente con la cartografía
 * nueva, espera a que termine el procesamiento (con el worker acotado ya son
 * pocos minutos) y actualiza el mapa en su sitio.
 */
export function MapaFormModal({
  open,
  onClose,
  editar,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** Si viene, REEMPLAZA la cartografía de este mapa (mismo id y nombre). */
  editar?: MapaConfig | null
  /** Se mantiene por compatibilidad con las llamadas existentes. */
  mapas?: MapaConfig[]
  /** 'procesando' = subido, procesándose en segundo plano (agregar). */
  onSaved: (accion: 'creado' | 'reemplazado' | 'procesando', nombre: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [pdf, setPdf] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fase, setFase] = useState<'idle' | 'subiendo' | 'procesando'>('idle')
  const [minutos, setMinutos] = useState(0)
  const pollRef = useRef<number | null>(null)
  const cronoRef = useRef<number | null>(null)

  function pararSondeo() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (cronoRef.current) { clearInterval(cronoRef.current); cronoRef.current = null }
  }
  useEffect(() => pararSondeo, [])

  useEffect(() => {
    if (!open) return
    setError('')
    setPdf(null); setFase('idle'); setMinutos(0); pararSondeo()
    setNombre(editar ? editar.nombre : '')
  }, [open, editar])

  async function subir() {
    if (!pdf) { setError('Elige el archivo PDF del plano.'); return }
    const nom = nombre.trim() || pdf.name.replace(/\.pdf$/i, '')
    setBusy(true); setError(''); setFase('subiendo'); setMinutos(0)
    try {
      const mapId = await subirCartografia(pdf, nom)

      // AGREGAR: no bloquear. Se procesa en segundo plano; aparecerá en
      // "Listos para agregar". El usuario puede cerrar y seguir trabajando.
      if (!editar) {
        onSaved('procesando', nom)
        onClose()
        return
      }

      // REEMPLAZAR: esperar a que termine y actualizar el mapa existente.
      setFase('procesando')
      cronoRef.current = window.setInterval(() => setMinutos((m) => m + 1), 60_000)
      const cfg = await new Promise<Awaited<ReturnType<typeof estadoCartografia>>>((resolve, reject) => {
        pollRef.current = window.setInterval(() => {
          void estadoCartografia(mapId)
            .then((st) => {
              if (st.status === 'ready' && st.tilesBase && st.bounds) { pararSondeo(); resolve(st) }
              else if (st.status === 'failed') { pararSondeo(); reject(new Error(st.error || 'El procesador no pudo leer el PDF.')) }
            })
            .catch(() => { /* reintenta */ })
        }, 8000)
      })
      await updateMapa(editar.id, {
        nombre: nom, tilesBase: cfg.tilesBase!, bounds: cfg.bounds!,
        minzoom: cfg.minzoom ?? 10, maxzoom: cfg.maxzoom ?? 16,
      })
      onSaved('reemplazado', nom)
      onClose()
    } catch (err) {
      const e = err as { message?: string }
      setError(e?.message ?? 'No se pudo procesar el PDF.')
    } finally {
      pararSondeo()
      setFase('idle')
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div><p className="eyebrow">Mapas</p><h3>{editar ? 'Reemplazar cartografía' : 'Agregar mapa'}</h3></div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Cerrar">&#x2715;</button>
        </div>

        {editar ? (
          <p className="subtle-copy" style={{ marginTop: 0, color: '#92610a' }}>
            Estás reemplazando la cartografía de <strong>{editar.nombre}</strong>. Los equipos con la
            versión anterior descargada verán "🔄 volver a descargar". Deja esta ventana abierta
            mientras se procesa.
          </p>
        ) : (
          <p className="subtle-copy" style={{ marginTop: 0 }}>
            Elige el plano en PDF (georreferenciado). Se procesa <strong>en segundo plano</strong> —
            no tienes que esperar: al terminar aparece en <strong>“Listos para agregar”</strong> (unos minutos).
          </p>
        )}

        <label>
          Nombre <span className="field-optional">(si lo dejas vacío se usa el del archivo)</span>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej. CARTOGRAFIA AGOSTO" disabled={busy} />
        </label>
        <label>
          Archivo PDF del plano
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(e) => { setPdf(e.target.files?.[0] ?? null); setError('') }}
          />
        </label>
        {pdf && <p className="subtle-copy" style={{ margin: '4px 0 0' }}>{pdf.name} · {(pdf.size / 1048576).toFixed(1)} MB</p>}

        {fase !== 'idle' && (
          <div className="mapa-proceso">
            <div className="mapa-proceso__bar"><span /></div>
            <p>
              {fase === 'subiendo'
                ? 'Subiendo el PDF…'
                : `Procesando la cartografía… ${minutos > 0 ? `(${minutos} min)` : ''}`}
            </p>
            {editar && (
              <p className="subtle-copy" style={{ margin: 0 }}>No cierres esta ventana mientras se reemplaza.</p>
            )}
          </div>
        )}
        {error && <p className="subtle-copy" style={{ color: '#b3261e', margin: '6px 0 0' }}>{error}</p>}

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void subir()} disabled={busy || !pdf}>
            {busy ? (editar ? 'Procesando…' : 'Subiendo…') : editar ? 'Subir y reemplazar' : 'Subir plano'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MapaFormModal
