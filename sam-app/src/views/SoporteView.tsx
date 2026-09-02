import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { fmtFechaHora, fmtLapso } from '../lib/fechas'
import {
  loadBandejaCasos, loadMensajes, enviarMensaje, cambiarEstado,
  SEVERIDAD_LABEL, SEVERIDAD_ICONO, ESTADO_LABEL,
  type Caso, type MensajeCaso, type EstadoCaso,
} from '../services/soporteApi'

/**
 * La bandeja de quien atiende.
 *
 * 🔴 **El orden es la única promesa que el módulo le hace al operario.** No hay
 * notificaciones push, así que no se puede prometer «respondemos en una hora».
 * Lo que sí se cumple es que quien está PARADO aparece de primero, aunque haya
 * reportado después. Esa promesa vive aquí, en el orden de la lista, no en un
 * texto de ayuda.
 *
 * 🔴 **No hay notas internas.** El login de este proyecto es una función de base
 * de datos, no Supabase Auth: no existe `auth.uid()` sobre el cual construir una
 * regla que de verdad esconda una nota. Una nota «interna» que cualquiera puede
 * leer con la llave pública es peor que no tenerla — hace creer que hay privacidad
 * donde no la hay. Todo lo que se escriba aquí lo puede ver el operario.
 */

const RAZONES_CIERRE: { valor: string; label: string }[] = [
  { valor: 'resuelto', label: 'Se corrigió' },
  { valor: 'no_era_falla', label: 'No era una falla' },
  { valor: 'no_se_pudo_repetir', label: 'No se pudo repetir' },
  { valor: 'no_es_de_la_app', label: 'No es de la app' },
  { valor: 'quedo_anotada', label: 'Queda anotada para después' },
  { valor: 'sin_respuesta', label: 'No respondió' },
]

export function SoporteView() {
  const { session, setError, setInfo } = useAppData()
  const [casos, setCasos] = useState<Caso[]>([])
  const [cargando, setCargando] = useState(true)
  const [busca, setBusca] = useState('')
  const [verCerrados, setVerCerrados] = useState(false)
  const [abierto, setAbierto] = useState<Caso | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setCasos(await loadBandejaCasos(verCerrados))
    } catch {
      setError('No se pudo cargar la bandeja.')
    } finally { setCargando(false) }
  }, [verCerrados, setError])
  useEffect(() => { void cargar() }, [cargar])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return casos
    return casos.filter((c) =>
      `${c.folio} ${c.creadoPorNombre ?? ''} ${c.texto ?? ''} ${c.pantalla ?? ''}`
        .toLowerCase().includes(q))
  }, [casos, busca])

  const abiertos = casos.filter((c) => c.estado !== 'resuelto' && c.estado !== 'cerrado')
  const parados = abiertos.filter((c) => c.severidadEfectiva === 'parado')

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>🎧 Casos de soporte</h2>
        <button type="button" className="inline-button" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? 'Cargando…' : '↻ Actualizar'}
        </button>
      </div>

      <Ayuda>
        <p>
          Lo que reporta la gente de campo sobre la aplicación. <strong>La lista viene
          ordenada por quién está más varado</strong>, no por quién reportó primero: el
          que no puede seguir trabajando va arriba aunque haya escrito después.
        </p>
        <p>
          🔴 <strong>Todo lo que escriba aquí lo ve el operario.</strong> No hay notas
          internas, y no es un olvido: no habría forma real de esconderlas, y una nota
          «privada» que sí se puede leer es peor que no tenerla.
        </p>
      </Ayuda>

      <div className="dash-kpis" style={{ marginTop: 12 }}>
        <div className="dash-kpi">
          <strong>{abiertos.length}</strong><span>sin resolver</span>
        </div>
        <div className={`dash-kpi${parados.length > 0 ? ' dash-kpi--alerta' : ''}`}>
          <strong>{parados.length}</strong><span>gente parada</span>
        </div>
        <div className="dash-kpi">
          <strong>{casos.filter((c) => c.estado === 'resuelto').length}</strong>
          <span>esperan su visto bueno</span>
        </div>
      </div>

      <div className="dash-filtros" style={{ marginTop: 12 }}>
        <input type="search" className="user-search-input" placeholder="Buscar por folio, nombre o texto…"
               value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="soporte-check">
          <input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} />
          Ver también los cerrados
        </label>
      </div>

      {cargando && <p className="muted-text">Cargando casos…</p>}
      {!cargando && lista.length === 0 && (
        <p className="dash-vacio">
          {busca ? 'Ningún caso coincide con la búsqueda.' : 'No hay casos abiertos. Buen día.'}
        </p>
      )}

      <div className="inv-list" style={{ marginTop: 12 }}>
        {lista.map((c) => (
          <button key={c.id} type="button" className={`caso-fila caso-fila--${c.severidadEfectiva}`}
                  onClick={() => setAbierto(c)}>
            <div className="caso-fila__main">
              <div className="caso-fila__head">
                <span aria-hidden>{SEVERIDAD_ICONO[c.severidadEfectiva]}</span>
                <strong>{c.creadoPorNombre ?? c.creadoPor}</strong>
                <span className="caso-fila__folio">{c.folio}</span>
              </div>
              <p className="caso-fila__txt">
                {c.texto || (c.pantalla ? `Sin texto · desde ${c.pantalla}` : 'Sin texto todavía')}
              </p>
              <p className="caso-fila__pie">
                {fmtFechaHora(c.creadoEnDispositivo)}
                {' · lleva '}{fmtLapso(c.creadoEnDispositivo, new Date().toISOString())}
                {c.tipo === 'peticion' && ' · 💡 idea'}
                {c.origen !== 'app' && ` · llegó por ${c.origen}`}
              </p>
            </div>
            <span className={`status-pill ${c.estado === 'resuelto' ? 'green'
              : c.estado === 'falta_dato' ? 'amber' : ''}`}>
              {ESTADO_LABEL[c.estado]}
            </span>
          </button>
        ))}
      </div>

      {abierto && (
        <DetalleCaso
          caso={abierto}
          onCerrar={() => setAbierto(null)}
          onCambio={() => { void cargar() }}
          actorId={session?.id ?? ''}
          actorNombre={session?.name ?? ''}
          actorRol={session?.role ?? ''}
          avisar={setInfo}
          fallar={setError}
        />
      )}
    </section>
  )
}

/** El caso abierto: la conversación y lo que se puede hacer con él. */
function DetalleCaso({ caso, onCerrar, onCambio, actorId, actorNombre, actorRol, avisar, fallar }: {
  caso: Caso
  onCerrar: () => void
  onCambio: () => void
  actorId: string
  actorNombre: string
  actorRol: string
  avisar: (s: string) => void
  fallar: (s: string) => void
}) {
  const [mensajes, setMensajes] = useState<MensajeCaso[]>([])
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [razon, setRazon] = useState('resuelto')

  const cargar = useCallback(async () => {
    try { setMensajes(await loadMensajes(caso.id)) } catch { /* se queda vacío */ }
  }, [caso.id])
  useEffect(() => { void cargar() }, [cargar])

  async function responder() {
    if (!texto.trim() || ocupado) return
    setOcupado(true)
    try {
      await enviarMensaje({
        casoId: caso.id, autor: actorId, nombre: actorNombre, rol: actorRol,
        texto: texto.trim(), creadoEnDispositivo: new Date().toISOString(),
      })
      setTexto('')
      await cargar()
      onCambio()
    } catch (e) {
      fallar((e as { message?: string })?.message ?? 'No se pudo responder')
    } finally { setOcupado(false) }
  }

  async function mover(estado: EstadoCaso, razonCierre?: string) {
    setOcupado(true)
    try {
      await cambiarEstado({ casoId: caso.id, estado, actor: actorId, razonCierre })
      avisar(estado === 'resuelto' ? 'Marcado como resuelto. El operario tiene que confirmar.'
        : `Caso ${ESTADO_LABEL[estado].toLowerCase()}.`)
      setCerrando(false)
      onCambio()
      onCerrar()
    } catch (e) {
      fallar((e as { message?: string })?.message ?? 'No se pudo cambiar el estado')
    } finally { setOcupado(false) }
  }

  return (
    <div className="modal-overlay open" onClick={onCerrar}>
      <div className="modal-card modal-card--alto" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">{caso.folio}</p>
            <h3>{caso.creadoPorNombre ?? caso.creadoPor}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <p className="caso-detalle__sev">
          {SEVERIDAD_ICONO[caso.severidadEfectiva]} {SEVERIDAD_LABEL[caso.severidadEfectiva]}
          {' · '}<span className="status-pill">{ESTADO_LABEL[caso.estado]}</span>
        </p>
        <p className="subtle-copy">
          Reportado {fmtFechaHora(caso.creadoEnDispositivo)}
          {caso.pantalla && ` · desde ${caso.pantalla}`}
          {caso.horasPrimeraRespuesta != null && ` · primera respuesta a las ${caso.horasPrimeraRespuesta} h hábiles`}
        </p>
        {caso.errorMensaje && (
          <pre className="caso-error">{caso.errorMensaje}</pre>
        )}

        <div className="caso-hilo">
          {caso.texto && (
            <div className="caso-msg caso-msg--suyo">
              <p>{caso.texto}</p>
              <small>{caso.creadoPorNombre} · {fmtFechaHora(caso.creadoEnDispositivo)}</small>
            </div>
          )}
          {mensajes.map((m) => (
            <div key={m.id} className={`caso-msg${m.esSistema ? ' caso-msg--sistema'
              : m.autor === caso.creadoPor ? ' caso-msg--suyo' : ' caso-msg--mio'}`}>
              {m.texto && <p>{m.texto}</p>}
              {m.fotoUrl && <img src={m.fotoUrl} alt="adjunto" className="caso-msg__foto" />}
              <small>
                {m.esSistema ? 'Sistema' : (m.nombre ?? m.autor)} · {fmtFechaHora(m.recibidoEnServidor)}
              </small>
            </div>
          ))}
          {mensajes.length === 0 && !caso.texto && (
            <p className="subtle-copy">
              Todavía no ha escrito nada. Reportó con un toque, que es lo que se le pidió:
              pregúntele usted qué pasó.
            </p>
          )}
        </div>

        {caso.estado !== 'cerrado' && (
          <>
            <label>
              <span>Responderle</span>
              <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)}
                        placeholder="Lo que le va a llegar al operario…" disabled={ocupado} />
            </label>
            <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="primary-button" onClick={() => void responder()}
                      disabled={ocupado || !texto.trim()}>
                Responder
              </button>
              {caso.estado === 'nuevo' && (
                <button type="button" className="inline-button" onClick={() => void mover('revisando')} disabled={ocupado}>
                  Lo estoy revisando
                </button>
              )}
              <button type="button" className="inline-button" onClick={() => void mover('falta_dato')} disabled={ocupado}>
                Pedirle un dato
              </button>
              {caso.estado !== 'resuelto' && (
                <button type="button" className="inline-button" onClick={() => setCerrando(true)} disabled={ocupado}>
                  Resuelto
                </button>
              )}
            </div>
          </>
        )}

        {cerrando && (
          <div className="caso-cierre">
            <p className="eyebrow">¿Cómo quedó?</p>
            {/* La razón de cierre no es burocracia: sin ella, «cerrado» mezcla el
                que se corrigió con el que nadie pudo repetir, y el tablero deja
                de distinguir un soporte que resuelve de uno que archiva. */}
            <select value={razon} onChange={(e) => setRazon(e.target.value)} className="base-input">
              {RAZONES_CIERRE.map((r) => <option key={r.valor} value={r.valor}>{r.label}</option>)}
            </select>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setCerrando(false)}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void mover('resuelto', razon)} disabled={ocupado}>
                Marcar resuelto
              </button>
            </div>
            <p className="subtle-copy">
              Queda esperando el visto bueno del operario. Él es quien sabe si de verdad
              se arregló.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default SoporteView
