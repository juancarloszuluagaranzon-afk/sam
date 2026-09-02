import { useCallback, useEffect, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { fmtFechaHora } from '../lib/fechas'
import { subirOGuardarFoto } from '../lib/outboxInsumos'
import { uploadEvidencia } from '../services/samApi'
import { FotoEvidencia } from '../components/FotoEvidencia'
import {
  loadMisCasos, loadMensajes, enviarMensaje, confirmarCaso,
  SEVERIDAD_ICONO, ESTADO_LABEL,
  type Caso, type MensajeCaso,
} from '../services/soporteApi'

/**
 * «Mis reportes» — lo que el operario ve de sus propios casos.
 *
 * 🔴 **Existe para que el reporte no se sienta como un buzón sin fondo.** Ese es
 * el motivo real por el que la gente prefiere el WhatsApp: por WhatsApp ve que
 * el mensaje llegó y que alguien lo leyó. Un formulario que se traga el reporte
 * y no vuelve a decir nada pierde contra eso todas las veces.
 *
 * Aquí se agrega lo opcional —la foto, el texto— DESPUÉS de que el caso ya
 * existe. Pedirlo antes es lo que hace que la gente abandone el formulario.
 */
export function MisCasosView({ onReportar }: { onReportar: () => void }) {
  const { session, setError, setInfo } = useAppData()
  const [casos, setCasos] = useState<Caso[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState<Caso | null>(null)

  const cargar = useCallback(async () => {
    if (!session) return
    setCargando(true)
    try {
      setCasos(await loadMisCasos(session.id))
    } catch {
      // Sin señal se queda con lo que haya: no se borra lo que ya se vio.
    } finally { setCargando(false) }
  }, [session])
  useEffect(() => { void cargar() }, [cargar])

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Mis reportes</h2>
        <button type="button" className="primary-button" onClick={onReportar}>
          + Reportar
        </button>
      </div>

      {cargando && <p className="muted-text">Cargando…</p>}

      {!cargando && casos.length === 0 && (
        <p className="dash-vacio">
          No has reportado nada. Si algo de la app no te sirve, repórtalo — es de un
          toque.
        </p>
      )}

      <div className="inv-list">
        {casos.map((c) => (
          <button key={c.id} type="button" className="caso-fila" onClick={() => setAbierto(c)}>
            <div className="caso-fila__main">
              <div className="caso-fila__head">
                <span aria-hidden>{SEVERIDAD_ICONO[c.severidadEfectiva]}</span>
                <span className="caso-fila__folio">{c.folio}</span>
              </div>
              <p className="caso-fila__txt">{c.texto || 'Sin texto'}</p>
              <p className="caso-fila__pie">{fmtFechaHora(c.creadoEnDispositivo)}</p>
            </div>
            <span className={`status-pill ${c.estado === 'resuelto' ? 'green'
              : c.estado === 'falta_dato' ? 'amber' : ''}`}>
              {ESTADO_LABEL[c.estado]}
            </span>
          </button>
        ))}
      </div>

      {abierto && (
        <MiCaso caso={abierto} onCerrar={() => setAbierto(null)} onCambio={() => void cargar()}
                avisar={setInfo} fallar={setError} />
      )}
    </section>
  )
}

function MiCaso({ caso, onCerrar, onCambio, avisar, fallar }: {
  caso: Caso
  onCerrar: () => void
  onCambio: () => void
  avisar: (s: string) => void
  fallar: (s: string) => void
}) {
  const { session } = useAppData()
  const [mensajes, setMensajes] = useState<MensajeCaso[]>([])
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [subiendo, setSubiendo] = useState(false)

  const cargar = useCallback(async () => {
    try { setMensajes(await loadMensajes(caso.id)) } catch { /* sin señal */ }
  }, [caso.id])
  useEffect(() => { void cargar() }, [cargar])

  async function mandar(fotoUrl?: string) {
    if (!session || ocupado) return
    if (!texto.trim() && !fotoUrl) return
    setOcupado(true)
    try {
      await enviarMensaje({
        casoId: caso.id, autor: session.id, nombre: session.name, rol: session.role,
        texto: texto.trim() || undefined, fotoUrl,
        creadoEnDispositivo: new Date().toISOString(),
      })
      setTexto('')
      await cargar()
      onCambio()
    } catch {
      fallar('No se pudo mandar. Revisa la señal.')
    } finally { setOcupado(false) }
  }

  async function confirmar(quedoBien: boolean) {
    if (!session) return
    setOcupado(true)
    try {
      await confirmarCaso(caso.id, session.id, quedoBien)
      avisar(quedoBien ? 'Gracias. El caso queda cerrado.' : 'Listo, lo volvemos a mirar.')
      onCambio()
      onCerrar()
    } catch {
      fallar('No se pudo confirmar. Revisa la señal.')
    } finally { setOcupado(false) }
  }

  return (
    <div className="modal-overlay open" onClick={onCerrar}>
      <div className="modal-card modal-card--alto" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Tu reporte</p>
            <h3>{caso.folio}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <p className="caso-detalle__sev">
          <span className="status-pill">{ESTADO_LABEL[caso.estado]}</span>
        </p>

        <div className="caso-hilo">
          {caso.texto && (
            <div className="caso-msg caso-msg--mio">
              <p>{caso.texto}</p>
              <small>{fmtFechaHora(caso.creadoEnDispositivo)}</small>
            </div>
          )}
          {mensajes.map((m) => (
            <div key={m.id} className={`caso-msg${m.esSistema ? ' caso-msg--sistema'
              : m.autor === session?.id ? ' caso-msg--mio' : ' caso-msg--suyo'}`}>
              {m.texto && <p>{m.texto}</p>}
              {m.fotoUrl && <FotoEvidencia url={m.fotoUrl} alt="adjunto al caso" tam={120} />}
              <small>
                {m.esSistema ? 'Sistema' : (m.nombre ?? 'Soporte')} · {fmtFechaHora(m.recibidoEnServidor)}
              </small>
            </div>
          ))}
        </div>

        {caso.estado === 'resuelto' && (
          <div className="caso-confirmar">
            <p><strong>Soporte dice que ya quedó. ¿Es cierto?</strong></p>
            <div className="modal-footer">
              <button type="button" className="primary-button" onClick={() => void confirmar(true)} disabled={ocupado}>
                ✅ Ya quedó
              </button>
              <button type="button" className="inline-button" onClick={() => void confirmar(false)} disabled={ocupado}>
                🔁 Sigue pasando
              </button>
            </div>
          </div>
        )}

        {caso.estado !== 'cerrado' && (
          <>
            <label>
              <span>Cuéntanos más <span className="field-optional">(si quieres)</span></span>
              <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)}
                        placeholder="Qué estabas haciendo cuando falló…" disabled={ocupado} />
            </label>
            <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
              <label className="inline-button" style={{ cursor: 'pointer' }}>
                {subiendo ? 'Guardando…' : '📷 Adjuntar foto o captura'}
                {/* Sin `capture`: así el celular ofrece cámara Y galería, y por la
                    galería entra la captura de pantalla — que para una falla de la
                    app dice más que una foto del tractor.

                    🔴 Va por `subirOGuardarFoto`: sin señal la foto se guarda en el
                    equipo con un marcador `local://` y sube sola después. Una falla
                    se fotografía justo donde no hay señal. */}
                <input type="file" accept="image/*" hidden disabled={subiendo || ocupado}
                       onChange={async (e) => {
                         const f = e.target.files?.[0]
                         if (!f) return
                         setSubiendo(true)
                         try {
                           const { url } = await subirOGuardarFoto(caso.id, f, 0, uploadEvidencia)
                           await mandar(url)
                         } catch {
                           fallar('No se pudo adjuntar la foto.')
                         } finally {
                           setSubiendo(false)
                           e.target.value = ''
                         }
                       }} />
              </label>
              <button type="button" className="primary-button" onClick={() => void mandar()}
                      disabled={ocupado || !texto.trim()}>
                Mandar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default MisCasosView
