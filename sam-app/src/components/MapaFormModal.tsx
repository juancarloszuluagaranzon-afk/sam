import { useEffect, useRef, useState } from 'react'
import type { MapaConfig } from '../domain/sam'
import { createMapa, updateMapa } from '../services/samApi'
import { estadoCartografia, subirCartografia } from '../services/fieldmapsApi'

/**
 * Formulario de mapa — SOLO subir PDF (experiencia Avenza): eliges el GeoPDF y
 * la app hace TODO — lo manda a procesar, espera los tiles y registra el mapa
 * con su área y zooms automáticamente. Compartido entre el visor (botón
 * "+ Agregar mapa") y Catálogos → Mapas. Sirve tanto para AGREGAR como para
 * REEMPLAZAR la cartografía (cuando cambia el plano, subes el PDF nuevo).
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
  onSaved: (accion: 'creado' | 'reemplazado', nombre: string) => void
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

  /**
   * Sube el GeoPDF, espera a que el procesador genere los tiles y registra el
   * mapa con el área y los zooms que devuelve — sin que nadie copie nada.
   */
  async function subirYRegistrar() {
    if (!pdf) { setError('Elige el archivo PDF del plano.'); return }
    const nom = nombre.trim() || pdf.name.replace(/\.pdf$/i, '')
    setBusy(true); setError(''); setFase('subiendo'); setMinutos(0)
    try {
      const mapId = await subirCartografia(pdf, nom)
      setFase('procesando')
      cronoRef.current = window.setInterval(() => setMinutos((m) => m + 1), 60_000)

      // Sondeo hasta que el worker termine (tarda minutos según el PDF).
      const cfg = await new Promise<Awaited<ReturnType<typeof estadoCartografia>>>((resolve, reject) => {
        pollRef.current = window.setInterval(() => {
          void estadoCartografia(mapId)
            .then((st) => {
              if (st.status === 'ready' && st.tilesBase && st.bounds) { pararSondeo(); resolve(st) }
              else if (st.status === 'failed') { pararSondeo(); reject(new Error(st.error || 'El procesador no pudo leer el PDF.')) }
            })
            .catch(() => { /* reintenta en el siguiente ciclo */ })
        }, 8000)
      })

      if (editar) {
        await updateMapa(editar.id, {
          nombre: nom, tilesBase: cfg.tilesBase!, bounds: cfg.bounds!,
          minzoom: cfg.minzoom ?? 10, maxzoom: cfg.maxzoom ?? 16,
        })
        onSaved('reemplazado', nom)
      } else {
        await createMapa({
          nombre: nom, tilesBase: cfg.tilesBase!, bounds: cfg.bounds!,
          minzoom: cfg.minzoom ?? 10, maxzoom: cfg.maxzoom ?? 16,
        })
        onSaved('creado', nom)
      }
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

        {editar && (
          <p className="subtle-copy" style={{ marginTop: 0, color: '#92610a' }}>
            Estás reemplazando la cartografía de <strong>{editar.nombre}</strong>. Los equipos con la
            versión anterior descargada verán "🔄 volver a descargar".
          </p>
        )}

        <p className="subtle-copy" style={{ marginTop: 0 }}>
          Elige el plano en PDF (georreferenciado) y la app hace el resto: lo procesa y lo deja
          listo en el visor con su área y sus zooms. <strong>Tarda varios minutos</strong> —
          deja esta ventana abierta.
        </p>

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
            <p className="subtle-copy" style={{ margin: 0 }}>
              No cierres esta ventana. Al terminar, el mapa queda listo para todos.
            </p>
          </div>
        )}
        {error && <p className="subtle-copy" style={{ color: '#b3261e', margin: '6px 0 0' }}>{error}</p>}

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void subirYRegistrar()} disabled={busy || !pdf}>
            {busy ? 'Procesando…' : editar ? 'Subir y reemplazar' : 'Subir y crear mapa'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MapaFormModal
