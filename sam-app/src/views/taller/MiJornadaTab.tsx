import { useCallback, useEffect, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { Ayuda } from '../../components/Ayuda'
import { CamaraRostro, type ResultadoCamara } from '../../components/CamaraRostro'
import { fmtFechaHora } from '../../lib/fechas'
import { hayHuella, registrarHuella, verificarHuella, apodoDelAparato, ubicacion, mensajeDeError } from '../../lib/biometria'
import {
  loadCredenciales, registrarCredencial, ultimaMarcacion, loadMarcaciones,
  marcarOEncolar, sincronizarMarcaciones, pendientesEnCola, loadMiRostro, enrolarRostro,
  loadConsentimiento, revocarRostro,
  type Credencial, type MarcacionFila, type RostroRegistrado, type Consentimiento,
} from '../../services/asistenciaApi'
import { emparejar, clasificar, hhmm, enBogota } from '../../lib/horasExtra'

/**
 * Mi jornada — el mecánico marca su entrada y su salida.
 *
 * 🔴 **Con la CARA** desde el 18-sep-2026: «los dedos normalmente están
 * sucios». Selfie con prueba de vida en el celular propio; la compara el
 * servidor (`taller_marcar`). La huella queda como segunda opción.
 *
 * 🔴 **Un botón, no un formulario.** La persona llega a las seis de la mañana
 * con las manos ocupadas: la pantalla dice en qué estado está y ofrece una sola
 * acción. La hora, la ubicación y el aparato los pone el sistema.
 *
 * 🔴 **Nunca se bloquea la marcación.** Sin señal se encola; sin GPS se guarda
 * sin ubicación; si la cara no se reconoce, se puede dejar para que la revise
 * el jefe. Lo que el celular no puede probar NO se paga solo: queda «por
 * revisar» (regla traída de AgroControl, su 0049). Un control que impide
 * registrar el trabajo hecho no controla nada: hace que se apunte en un cuaderno.
 */
export function MiJornadaTab() {
  const { session, setError, setInfo } = useAppData()
  const yo = session?.id ?? ''

  const [soporta, setSoporta] = useState<boolean | null>(null)
  const [credenciales, setCredenciales] = useState<Credencial[]>([])
  const [rostro, setRostro] = useState<RostroRegistrado | null>(null)
  const [ultima, setUltima] = useState<MarcacionFila | null>(null)
  const [hoy, setHoy] = useState<MarcacionFila[]>([])
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState('')
  const [pendientes, setPendientes] = useState(0)
  /** La autorización que se está mostrando (la entrega el servidor). */
  const [autorizacion, setAutorizacion] = useState<Consentimiento | null>(null)
  const [camara, setCamara] = useState<'registrar' | 'marcar' | null>(null)
  /** La cara no coincidió: se guarda la toma para ofrecer «que lo revise el jefe». */
  const [noCoincide, setNoCoincide] = useState<ResultadoCamara | null>(null)

  const refrescar = useCallback(async () => {
    if (!yo) return
    setCargando(true)
    try {
      const dia = enBogota(new Date().toISOString()).dia
      const [cr, ro, ul, ms] = await Promise.all([
        loadCredenciales(yo),
        loadMiRostro(yo),
        ultimaMarcacion(yo),
        loadMarcaciones({ usuarioId: yo, desde: `${dia}T00:00:00-05:00`, limit: 50 }),
      ])
      setCredenciales(cr); setRostro(ro); setUltima(ul); setHoy(ms)
    } finally {
      setCargando(false)
      setPendientes(pendientesEnCola())
    }
  }, [yo])

  useEffect(() => { void hayHuella().then(setSoporta) }, [])
  useEffect(() => { void refrescar() }, [refrescar])

  // Lo que quedó sin señal sube solo en cuanto vuelve la conexión.
  useEffect(() => {
    const intentar = async () => {
      const r = await sincronizarMarcaciones()
      if (r.subidas > 0) { setInfo(`Subieron ${r.subidas} marcación(es) que estaban guardadas.`); void refrescar() }
      setPendientes(r.quedan)
    }
    void intentar()
    window.addEventListener('online', intentar)
    return () => window.removeEventListener('online', intentar)
  }, [refrescar, setInfo])

  const adentro = ultima?.tipo === 'ENTRADA'
  const proximo: 'ENTRADA' | 'SALIDA' = adentro ? 'SALIDA' : 'ENTRADA'
  const tieneCara = !!rostro && rostro.estado !== 'RECHAZADO'
  const tieneHuella = credenciales.length > 0 && soporta === true

  /** Lo trabajado hoy: solo lo que ya cuenta (lo «por revisar» espera al jefe). */
  const cuentan = hoy.filter((m) => !m.requiereRevision)
  const porRevisar = hoy.filter((m) => m.requiereRevision).length
  const { sesiones, sueltas } = emparejar(cuentan)
  const minutosHoy = clasificar(sesiones).reduce((t, d) => t + d.totalMinutos, 0)

  /* ── Registrar la cara ─────────────────────────────────────────────────── */
  /** La versión que la persona LEYÓ y aceptó: la manda de vuelta tal cual. */
  const [versionAceptada, setVersionAceptada] = useState('')

  async function abrirAutorizacion() {
    setOcupado('Cargando la autorización…')
    try {
      setAutorizacion(await loadConsentimiento())
    } catch {
      setError('Para registrar la cara hace falta señal. Intenta cuando tengas conexión.')
    } finally { setOcupado('') }
  }

  async function retirarAutorizacion() {
    if (!window.confirm('¿Retirar tu autorización? Se borra tu cara registrada y vuelves a marcar con la huella o por revisión del jefe.')) return
    setOcupado('Borrando tu cara…')
    try {
      await revocarRostro(yo)
      setInfo('Listo: tu cara se borró. Puedes volver a registrarla cuando quieras.')
      await refrescar()
    } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado('') }
  }

  async function guardarCara(r: ResultadoCamara) {
    setCamara(null)
    setOcupado('Guardando tu cara…')
    try {
      await enrolarRostro({
        usuarioId: yo, descriptores: r.descriptores, foto: r.foto,
        consentimiento: true, version: versionAceptada,
      })
      setInfo('Cara registrada. El jefe de taller la aprueba; mientras tanto tus marcaciones quedan por revisar.')
      await refrescar()
    } catch (e) {
      const m = (e as { message?: string })?.message ?? ''
      // Los rechazos del servidor traen «CODIGO: explicación»: se muestra la explicación.
      const conocido = /(ROSTRO_DUPLICADO|MUESTRAS_IDENTICAS|MUESTRAS_DISPERSAS|FOTO_INVALIDA|CONSENTIMIENTO_DESACTUALIZADO|SIN_CONSENTIMIENTO):\s*(.*)$/.exec(m)
      setError(conocido
        ? `⚠ ${conocido[2]}`
        : m.includes('fetch') || !navigator.onLine
          ? 'Para registrar la cara hace falta señal. Intenta cuando tengas conexión.'
          : mensajeDeError(e))
    } finally { setOcupado('') }
  }

  /* ── Marcar ────────────────────────────────────────────────────────────── */
  async function enviar(opts: {
    metodo: 'ROSTRO' | 'HUELLA' | 'PIN'
    toma?: ResultadoCamara | null
    foto?: string | null
    credencialId?: string | null
    forzarRevision?: boolean
  }) {
    setOcupado('Buscando la ubicación…')
    const pos = await ubicacion()
    setOcupado('Registrando…')
    const r = await marcarOEncolar({
      id: crypto.randomUUID(),
      usuarioId: yo,
      tipo: proximo,
      ocurrioEn: new Date().toISOString(),
      metodo: opts.metodo,
      credencialId: opts.credencialId ?? null,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      precisionM: pos?.precision ?? null,
      dispositivo: apodoDelAparato(),
      descriptor: opts.toma?.descriptores[0] ?? null,
      fotoMini: opts.toma?.foto ?? opts.foto ?? null,
      pruebasVida: opts.toma?.pruebas ?? null,
      forzarRevision: opts.forzarRevision ?? false,
    })
    const que = proximo === 'ENTRADA' ? 'Entrada' : 'Salida'
    if (!r.enviada) {
      setInfo('Sin señal: quedó guardada en el teléfono y sube sola. La hora es la de ahora, no la del envío.')
    } else if (r.respuesta?.resultado === 'NO_COINCIDE') {
      // No se registró: se ofrece intentar otra vez o dejarla para el jefe.
      setNoCoincide(opts.toma ?? null)
      return
    } else if (r.respuesta?.resultado === 'POR_REVISAR') {
      setInfo(`${que} registrada, POR REVISAR: ${r.respuesta.revisionMotivo ?? 'la revisa el jefe'}. Cuenta cuando el jefe la acepte.`)
    } else {
      setInfo(`${que} registrada.`)
    }
    setNoCoincide(null)
    await refrescar()
  }

  async function conCara(toma: ResultadoCamara) {
    setCamara(null)
    try { await enviar({ metodo: 'ROSTRO', toma }) } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado('') }
  }

  async function sinCara(foto: string | null) {
    setCamara(null)
    try { await enviar({ metodo: 'ROSTRO', foto, forzarRevision: true }) } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado('') }
  }

  async function conHuella() {
    setOcupado('Pidiendo la huella…')
    try {
      const credencialId = await verificarHuella(credenciales.map((c) => c.id))
      await enviar({ metodo: 'HUELLA', credencialId })
    } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado('') }
  }

  async function sinVerificar() {
    try { await enviar({ metodo: 'PIN' }) } catch (e) { setError(mensajeDeError(e)) } finally { setOcupado('') }
  }

  async function registrarMiHuella() {
    setOcupado('Pidiendo la huella…')
    try {
      const { credencialId, llavePublica } = await registrarHuella(yo, session?.name ?? yo)
      await registrarCredencial({ credencialId, usuarioId: yo, apodo: apodoDelAparato(), llavePublica })
      setInfo('Huella registrada en este teléfono.')
      await refrescar()
    } catch (e) {
      setError(mensajeDeError(e))
    } finally { setOcupado('') }
  }

  if (!yo) return <p className="dash-vacio">Entra con tu usuario para marcar.</p>

  return (
    <section className="panel-card mov">
      <div className="panel-title split">
        <h2>Mi jornada</h2>
        <Ayuda>
          <p>Marca tu <strong>entrada</strong> al llegar y tu <strong>salida</strong> al irte, con una foto de tu cara.</p>
          <p>
            La cámara te pide <strong>parpadear y girar un poco la cabeza</strong> (así sabe que eres tú y no una foto)
            y toma la foto sola. La hora, la ubicación y el aparato los pone el sistema.
          </p>
          <p>
            Si no te reconoce, puedes marcar igual: queda <strong>por revisar</strong> y cuenta cuando el jefe la acepte.
            <strong> Sin señal también funciona</strong>: queda guardada y sube sola.
          </p>
        </Ayuda>
      </div>

      {pendientes > 0 && (
        <p className="mov-alerta">⏳ {pendientes} marcación(es) esperando señal. Suben solas; no vuelvas a marcar.</p>
      )}

      {/* El estado, antes que el botón: primero saber cómo estoy. */}
      <div className={`dash-galha${adentro ? '' : ' is-fuera'}`} style={adentro ? undefined : { background: 'var(--color-ink-mid, #5a5f57)' }}>
        <span className="dash-galha__num">{adentro ? 'ADENTRO' : 'AFUERA'}</span>
        <span className="dash-galha__sub">
          {ultima
            ? `Última marcación: ${ultima.tipo === 'ENTRADA' ? 'entrada' : 'salida'} el ${fmtFechaHora(ultima.marcadoEn)}`
            : 'Todavía no has marcado nunca.'}
        </span>
      </div>

      {(minutosHoy > 0 || porRevisar > 0) && (
        <p className="dash-galha__nota">
          {minutosHoy > 0 && <>Hoy llevas <strong>{hhmm(minutosHoy)}</strong> horas{adentro && ' (sigue corriendo)'}. </>}
          {porRevisar > 0 && <>⏳ {porRevisar} marcación(es) por revisar: cuentan cuando el jefe las acepte. </>}
          {sueltas.length > 0 && '⚠ Hay una marcación sin pareja: avisa al jefe de taller.'}
        </p>
      )}

      {/* Registrar la cara: una sola vez. */}
      {!cargando && !tieneCara && (
        <div className="flota-comprobante" style={{ marginTop: 12 }}>
          <span className="flota-comprobante__lbl">📷 Primero registra tu cara</span>
          <p className="subtle-copy" style={{ marginTop: 0 }}>
            {rostro?.estado === 'RECHAZADO'
              ? `El jefe no aprobó tu registro${rostro.motivo ? ` (${rostro.motivo})` : ''}. Hazlo de nuevo, con buena luz y solo tú frente a la cámara.`
              : 'Se hace una sola vez. Toma unos segundos: parpadear, girar la cabeza y quedarte quieto.'}
          </p>
          <button type="button" className="primary-button" onClick={() => void abrirAutorizacion()} disabled={!!ocupado}>
            {ocupado || 'Registrar mi cara'}
          </button>
        </div>
      )}
      {rostro?.estado === 'PENDIENTE' && (
        <p className="mov-alerta">⏳ Tu cara está esperando la aprobación del jefe de taller. Puedes marcar: quedan por revisar hasta que la apruebe.</p>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="primary-button"
          style={{ width: '100%', minHeight: 72, fontSize: '1.15rem' }}
          disabled={!!ocupado || cargando}
          onClick={() => (tieneCara ? setCamara('marcar') : void sinVerificar())}
        >
          {ocupado || `${proximo === 'ENTRADA' ? '🟢 Marcar ENTRADA' : '🔴 Marcar SALIDA'}${tieneCara ? ' con la cara' : ''}`}
        </button>
        {!tieneCara && !cargando && (
          <p className="subtle-copy">Sin la cara registrada, la marcación queda por revisar.</p>
        )}
        {tieneHuella && (
          <button type="button" className="inline-button" style={{ width: '100%', marginTop: 8 }} disabled={!!ocupado} onClick={() => void conHuella()}>
            Marcar con huella
          </button>
        )}
        {!tieneHuella && soporta && credenciales.length === 0 && tieneCara && (
          <button type="button" className="inline-button" style={{ width: '100%', marginTop: 8 }} disabled={!!ocupado} onClick={() => void registrarMiHuella()}>
            Registrar también la huella (opcional)
          </button>
        )}
      </div>

      {tieneCara && (
        <button type="button" className="dash-card__link" style={{ marginTop: 10 }} disabled={!!ocupado} onClick={() => void retirarAutorizacion()}>
          Retirar mi autorización y borrar mi cara
        </button>
      )}

      {hoy.length > 0 && (
        <>
          <h3 className="dash-titulo">Lo de hoy</h3>
          <div className="dash-detalle">
            {[...hoy].reverse().map((m) => (
              <div key={m.id} className="ent-row" style={{ cursor: 'default' }}>
                <div className="ent-row__cab">
                  <strong>{m.tipo === 'ENTRADA' ? '🟢 Entrada' : '🔴 Salida'}</strong>
                  <span className="ent-row__hora">{fmtFechaHora(m.marcadoEn)}</span>
                </div>
                <span className="ent-row__pie">
                  {m.metodo === 'ROSTRO' ? 'con la cara' : m.metodo === 'HUELLA' ? 'con huella' : m.metodo === 'PIN' ? 'sin verificar' : 'la anotó administración'}
                  {m.requiereRevision && ` · ⏳ por revisar: ${m.revisionMotivo ?? ''}`}
                  {!m.requiereRevision && m.revisadoPor && ' · ✓ revisada por el jefe'}
                  {m.horaCorregida && ' · ⚠ la hora del teléfono venía mal y se usó la del servidor'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Autorización de datos biométricos (Ley 1581 de 2012): ANTES de abrir la cámara. */}
      {autorizacion && (
        <div className="modal-overlay open" onClick={() => setAutorizacion(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Antes de registrar tu cara</p>
                <h3>Autorización de datos biométricos</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setAutorizacion(null)} aria-label="Cerrar">✕</button>
            </div>
            {/* El texto lo entrega el servidor y es el que queda guardado con la cara. */}
            <div className="rostro-consentimiento">
              <p><strong>{autorizacion.titulo}</strong></p>
              {autorizacion.parrafos.map((p, i) => <p key={i}>{p}</p>)}
            </div>
            <div className="rostro-camara__acciones">
              <button type="button" className="primary-button" onClick={() => {
                setVersionAceptada(autorizacion.version); setAutorizacion(null); setCamara('registrar')
              }}>
                Acepto — registrar mi cara
              </button>
              <button type="button" className="inline-button" onClick={() => setAutorizacion(null)}>No acepto</button>
            </div>
          </div>
        </div>
      )}

      {camara === 'registrar' && (
        <CamaraRostro modo="registrar" onListo={(r) => void guardarCara(r)} onCancelar={() => setCamara(null)} />
      )}
      {camara === 'marcar' && (
        <CamaraRostro
          modo="marcar"
          onListo={(r) => void conCara(r)}
          onCancelar={() => setCamara(null)}
          onSinCara={(foto) => void sinCara(foto)}
        />
      )}

      {/* La cara no coincidió: NO se registró. Intentar otra vez o dejarla para el jefe. */}
      {noCoincide && (
        <div className="modal-overlay open">
          <div className="modal-card">
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">{proximo === 'ENTRADA' ? 'Entrada' : 'Salida'} sin registrar</p>
                <h3>No te reconocí</h3>
              </div>
            </div>
            <p className="subtle-copy">Busca luz de frente, quítate la gorra o las gafas oscuras y vuelve a intentar.</p>
            <div className="rostro-camara__acciones">
              <button type="button" className="primary-button" onClick={() => { setNoCoincide(null); setCamara('marcar') }}>
                Intentar de nuevo
              </button>
              <button
                type="button"
                className="inline-button"
                onClick={() => {
                  const toma = noCoincide
                  setNoCoincide(null)
                  void enviar({ metodo: 'ROSTRO', toma, forzarRevision: true }).catch((e) => setError(mensajeDeError(e))).finally(() => setOcupado(''))
                }}
              >
                Marcar igual — que lo revise el jefe
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MiJornadaTab
