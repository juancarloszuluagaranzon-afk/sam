import { useCallback, useEffect, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { Ayuda } from '../../components/Ayuda'
import { fmtFechaHora } from '../../lib/fechas'
import { hayHuella, registrarHuella, verificarHuella, apodoDelAparato, ubicacion, mensajeDeError } from '../../lib/biometria'
import {
  loadCredenciales, registrarCredencial, ultimaMarcacion, loadMarcaciones,
  marcarOEncolar, sincronizarMarcaciones, pendientesEnCola,
  type Credencial, type MarcacionFila,
} from '../../services/asistenciaApi'
import { emparejar, clasificar, hhmm, enBogota } from '../../lib/horasExtra'

/**
 * Mi jornada — el mecánico marca su entrada y su salida.
 *
 * 🔴 **Un botón, no un formulario.** La persona llega a las seis de la mañana
 * con las manos ocupadas: la pantalla tiene que decir en qué estado está y
 * ofrecer una sola acción. Todo lo demás —la hora, la ubicación, el aparato—
 * lo pone el sistema. Cada campo que se le pida es una excusa para no marcar,
 * y una jornada sin marcar es una discusión de nómina a fin de mes.
 *
 * 🔴 **Nunca se bloquea la marcación.** Ni por falta de señal (se encola), ni
 * por falta de GPS (se guarda sin ubicación), ni porque el lector de huella
 * falle (queda el respaldo por PIN, marcado como tal). Un control que impide
 * registrar el trabajo hecho no controla nada: hace que se apunte en un
 * cuaderno.
 */
export function MiJornadaTab() {
  const { session, setError, setInfo } = useAppData()
  const yo = session?.id ?? ''

  const [soporta, setSoporta] = useState<boolean | null>(null)
  const [credenciales, setCredenciales] = useState<Credencial[]>([])
  const [ultima, setUltima] = useState<MarcacionFila | null>(null)
  const [hoy, setHoy] = useState<MarcacionFila[]>([])
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState('')
  const [pendientes, setPendientes] = useState(0)

  const refrescar = useCallback(async () => {
    if (!yo) return
    setCargando(true)
    try {
      const dia = enBogota(new Date().toISOString()).dia
      const [cr, ul, ms] = await Promise.all([
        loadCredenciales(yo),
        ultimaMarcacion(yo),
        // Desde ayer, no desde hoy: el turno que arranca a las 6 p.m. y termina
        // a las 2 a.m. es de la misma jornada y no puede desaparecer al pasar
        // la medianoche.
        loadMarcaciones({ usuarioId: yo, desde: `${dia}T00:00:00-05:00`, limit: 50 }),
      ])
      setCredenciales(cr); setUltima(ul); setHoy(ms)
    } finally {
      setCargando(false)
      setPendientes(pendientesEnCola())
    }
  }, [yo])

  useEffect(() => { void hayHuella().then(setSoporta) }, [])
  useEffect(() => { void refrescar() }, [refrescar])

  // Lo que quedó sin señal sube solo en cuanto vuelve la conexión o la persona
  // vuelve a abrir la pantalla. No hay que acordarse de nada.
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

  /** Lo trabajado hoy, con lo ya marcado. Se ve crecer, que es medio punto. */
  const { sesiones, sueltas } = emparejar(hoy)
  const dias = clasificar(sesiones)
  const minutosHoy = dias.reduce((t, d) => t + d.totalMinutos, 0)

  async function registrar() {
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

  async function marcarAhora(conHuella: boolean) {
    if (!yo) return
    setOcupado(conHuella ? 'Pidiendo la huella…' : 'Registrando…')
    try {
      let credencialId: string | null = null
      if (conHuella) {
        credencialId = await verificarHuella(credenciales.map((c) => c.id))
      }
      setOcupado('Buscando la ubicación…')
      const pos = await ubicacion()
      setOcupado('Registrando…')
      const r = await marcarOEncolar({
        id: crypto.randomUUID(),
        usuarioId: yo,
        tipo: proximo,
        ocurrioEn: new Date().toISOString(),
        metodo: conHuella ? 'HUELLA' : 'PIN',
        credencialId,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        precisionM: pos?.precision ?? null,
        dispositivo: apodoDelAparato(),
      })
      if (r.enviada) {
        const fuera = r.respuesta?.dentroDelSitio === false
        setInfo(`${proximo === 'ENTRADA' ? 'Entrada' : 'Salida'} registrada.${fuera ? ' ⚠ Quedó marcada FUERA del taller.' : ''}`)
      } else {
        setInfo('Sin señal: quedó guardada en el teléfono y sube sola. La hora es la de ahora, no la del envío.')
      }
      await refrescar()
    } catch (e) {
      setError(mensajeDeError(e))
    } finally { setOcupado('') }
  }

  if (!yo) return <p className="dash-vacio">Entra con tu usuario para marcar.</p>

  const sinHuella = credenciales.length === 0

  return (
    <section className="panel-card mov">
      <div className="panel-title split">
        <h2>Mi jornada</h2>
        <Ayuda>
          <p>Marca tu <strong>entrada</strong> al llegar y tu <strong>salida</strong> al irte. Nada más.</p>
          <p>
            La hora, la ubicación y el aparato los pone el sistema. La huella se queda en tu
            teléfono: la app solo guarda que <em>este</em> teléfono la verificó.
          </p>
          <p>
            <strong>Sin señal también funciona.</strong> Queda guardada con la hora en que
            marcaste y sube sola cuando vuelva la conexión.
          </p>
        </Ayuda>
      </div>

      {pendientes > 0 && (
        <p className="mov-alerta">
          ⏳ {pendientes} marcación(es) esperando señal. Suben solas; no vuelvas a marcar.
        </p>
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

      {minutosHoy > 0 && (
        <p className="dash-galha__nota">
          Hoy llevas <strong>{hhmm(minutosHoy)}</strong> horas
          {adentro && ' (sigue corriendo)'}.
          {sueltas.length > 0 && ' ⚠ Hay una marcación sin pareja: avisa al jefe de taller.'}
        </p>
      )}

      {soporta === false && (
        <p className="mov-alerta">
          Este teléfono no le ofrece lector de huella al navegador. Puedes marcar igual;
          la marcación queda anotada como <strong>sin huella</strong>.
        </p>
      )}

      {sinHuella && soporta && (
        <div className="flota-comprobante" style={{ marginTop: 12 }}>
          <span className="flota-comprobante__lbl">🔒 Primero registra tu huella en este teléfono</span>
          <p className="subtle-copy" style={{ marginTop: 0 }}>
            Se hace una sola vez por aparato. Tu huella no sale del teléfono.
          </p>
          <button type="button" className="primary-button" onClick={() => void registrar()} disabled={!!ocupado}>
            {ocupado || 'Registrar mi huella'}
          </button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="primary-button"
          style={{ width: '100%', minHeight: 72, fontSize: '1.15rem' }}
          disabled={!!ocupado || cargando}
          onClick={() => void marcarAhora(!sinHuella && soporta === true)}
        >
          {ocupado || (proximo === 'ENTRADA' ? '🟢 Marcar ENTRADA' : '🔴 Marcar SALIDA')}
        </button>
        {!sinHuella && soporta && (
          <button
            type="button"
            className="inline-button"
            style={{ width: '100%', marginTop: 8 }}
            disabled={!!ocupado}
            onClick={() => void marcarAhora(false)}
          >
            El lector no responde — marcar sin huella
          </button>
        )}
      </div>

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
                  {m.metodo === 'HUELLA' ? 'con huella' : m.metodo === 'PIN' ? 'sin huella' : 'la anotó administración'}
                  {m.dentroDelSitio === false && ' · ⚠ fuera del taller'}
                  {m.horaCorregida && ' · ⚠ la hora del teléfono venía mal y se usó la del servidor'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default MiJornadaTab
