import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { CamaraRostro, type ResultadoCamara } from '../components/CamaraRostro'
import { fmtFechaHora } from '../lib/fechas'
import { buscarPersona, iniciales, primerNombre, proximoTipo } from '../lib/quiosco'
import { pendientesEnCola, sincronizarMarcaciones } from '../services/asistenciaApi'
import { loadRosterQuiosco, marcarEnQuiosco } from '../services/tallerPersonalApi'
import type { Mecanico, RosterQuiosco } from '../services/tallerPersonalApi'

/** La hora grande de la tableta: solo hora y minutos, siempre en Bogotá. */
const HORA_BOGOTA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  hour: 'numeric',
  minute: '2-digit',
})

type Vista = 'persona' | 'camara' | 'pin'

/**
 * El quiosco del taller — TODA la app de la tableta de la entrada.
 *
 * 🔴 Es la pantalla de gente con las manos sucias y afán a las seis de la
 * mañana: letra grande, un solo botón por persona y ninguna confirmación que
 * estorbe. Toca su nombre, mira a la cámara y listo.
 *
 * 🔴 Nunca bloquea la marcación: sin señal se encola y sube sola; si la cara no
 * se reconoce, se puede dejar para que la revise el jefe. Lo que la tableta no
 * pudo probar NO se paga solo.
 */
export function QuioscoTallerView({ onLogout }: { onLogout: () => void }) {
  const { session } = useAppData()
  const quioscoId = session?.id ?? ''

  const [roster, setRoster] = useState<RosterQuiosco | null>(null)
  const [cargando, setCargando] = useState(true)
  const [pendientes, setPendientes] = useState(0)
  const [reloj, setReloj] = useState(() => new Date())

  const [busqueda, setBusqueda] = useState('')
  const [seleccionado, setSeleccionado] = useState<Mecanico | null>(null)
  const [vista, setVista] = useState<Vista>('persona')
  const [pin, setPin] = useState('')
  const [avisoPin, setAvisoPin] = useState('')
  const [ocupado, setOcupado] = useState(false)

  /** El resultado de una marcación: se ve 5 s y vuelve solo a la lista. */
  const [resultado, setResultado] = useState<string | null>(null)
  /** La cara no coincidió: se guarda la foto del intento para «dejarla para el jefe». */
  const [noCoincide, setNoCoincide] = useState<{ foto: string | null } | null>(null)

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const r = await loadRosterQuiosco()
      setRoster(r)
      // Si la lista se recargó mientras alguien estaba en su panel, se refresca
      // esa persona; si ya no está, se vuelve a la cuadrícula.
      setSeleccionado((sel) => {
        if (!sel) return null
        return r.mecanicos.find((m) => m.id === sel.id) ?? null
      })
    } catch {
      // Sin lista nueva se queda la que ya está en pantalla: nunca una blanca.
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [])

  const sincronizar = useCallback(async () => {
    try {
      const r = await sincronizarMarcaciones()
      setPendientes(r.quedan)
      if (r.subidas > 0) void cargar(true)
    } catch {
      // La cola se queda como está: el próximo intento la vuelve a leer.
      setPendientes(pendientesEnCola())
    }
  }, [cargar])

  // Al abrir: traer la lista y subir lo que haya quedado guardado.
  useEffect(() => {
    void cargar()
    setPendientes(pendientesEnCola())
    void sincronizar()
  }, [cargar, sincronizar])

  // El reloj de la tableta, cada 30 s; la lista, cada 5 min y al volver la señal.
  useEffect(() => {
    const tic = window.setInterval(() => setReloj(new Date()), 30_000)
    const refresco = window.setInterval(() => void cargar(true), 300_000)
    const alVolver = () => void sincronizar()
    window.addEventListener('online', alVolver)
    return () => {
      window.clearInterval(tic)
      window.clearInterval(refresco)
      window.removeEventListener('online', alVolver)
    }
  }, [cargar, sincronizar])

  // El resultado se ve 5 s y se vuelve solo a la lista, con el roster fresco.
  useEffect(() => {
    if (!resultado) return
    const t = window.setTimeout(() => {
      setResultado(null)
      setSeleccionado(null)
      setBusqueda('')
      setVista('persona')
      void cargar(true)
    }, 5000)
    return () => window.clearTimeout(t)
  }, [resultado, cargar])

  // Aparato COMPARTIDO: si alguien abre su panel y se va sin marcar, al minuto
  // vuelve solo a la lista, para que el siguiente no marque con el nombre ajeno.
  // Cada tecla del PIN reinicia la cuenta; con la cámara abierta no corre.
  useEffect(() => {
    if (!seleccionado || resultado || ocupado || vista === 'camara') return
    const t = window.setTimeout(() => {
      setSeleccionado(null); setBusqueda(''); setVista('persona')
      setPin(''); setAvisoPin(''); setNoCoincide(null)
    }, 60_000)
    return () => window.clearTimeout(t)
  }, [seleccionado, resultado, ocupado, vista, pin, noCoincide])

  const mecanicos = roster?.mecanicos ?? []
  const lista = useMemo(() => buscarPersona(mecanicos, busqueda), [mecanicos, busqueda])
  const adentroAhora = useMemo(
    () => mecanicos.filter((m) => proximoTipo(m.ultima).tipo === 'SALIDA').length,
    [mecanicos],
  )

  const hora = HORA_BOGOTA.format(reloj)
  const rostroSel = seleccionado?.rostro ?? null
  const tieneCara = !!rostroSel && rostroSel.estado !== 'RECHAZADO'
  const proxima = seleccionado ? proximoTipo(seleccionado.ultima) : null
  const tipo = proxima?.tipo ?? 'ENTRADA'

  function estadoDe(m: Mecanico): string {
    if (m.ultima) {
      const p = proximoTipo(m.ultima)
      if (p.olvidoSalida) {
        return `⚠ No marcaste la salida del ${fmtFechaHora(m.ultima.marcadoEn)}: se marcará una ENTRADA nueva. Avísale al jefe.`
      }
      if (p.tipo === 'SALIDA') return `Adentro desde ${fmtFechaHora(m.ultima.marcadoEn)}`
    }
    return 'Afuera'
  }

  function volverALista() {
    setSeleccionado(null)
    setBusqueda('')
    setVista('persona')
    setPin('')
    setAvisoPin('')
    setNoCoincide(null)
  }

  /**
   * Manda la marcación y decide qué decir. El PIN se limpia SIEMPRE: no se
   * guarda en el aparato ni en la cola sin señal.
   */
  async function ejecutar(opts: {
    metodo: 'ROSTRO' | 'PIN'
    toma?: ResultadoCamara | null
    foto?: string | null
    pin?: string | null
    forzarRevision?: boolean
  }) {
    if (!seleccionado) return
    const persona = seleccionado
    const suTipo = proximoTipo(persona.ultima).tipo
    const suQue = suTipo === 'ENTRADA' ? 'Entrada' : 'Salida'
    setVista('persona')
    setOcupado(true)
    try {
      const r = await marcarEnQuiosco({
        usuarioId: persona.id,
        quioscoId,
        tipo: suTipo,
        metodo: opts.metodo,
        toma: opts.toma ?? null,
        foto: opts.foto ?? null,
        pin: opts.pin ?? null,
        forzarRevision: opts.forzarRevision ?? false,
      })
      setPin('')
      setAvisoPin('')

      if (!r.enviada) {
        setResultado(`✓ ${suQue} guardada sin señal · ${persona.nombre} · ${fmtFechaHora(new Date().toISOString())}. Sube sola cuando vuelva la señal.`)
        return
      }
      const respuesta = r.respuesta
      if (!respuesta) {
        setResultado(`✓ ${suQue} registrada · ${persona.nombre} · ${fmtFechaHora(new Date().toISOString())}`)
        return
      }
      if (respuesta.resultado === 'NO_COINCIDE') {
        setNoCoincide({ foto: opts.toma?.foto ?? opts.foto ?? null })
        return
      }
      if (respuesta.resultado === 'PIN_INCORRECTO') {
        setVista('pin')
        setAvisoPin('PIN incorrecto. Intenta otra vez.')
        return
      }
      const cuando = fmtFechaHora(respuesta.marcadoEn)
      if (respuesta.resultado === 'POR_REVISAR') {
        setResultado(`✓ ${suQue} registrada · ${persona.nombre} · ${cuando}. Queda por revisar: ${respuesta.revisionMotivo ?? 'la revisa el jefe'}.`)
      } else {
        setResultado(`✓ ${suQue} registrada · ${persona.nombre} · ${cuando}`)
      }
    } catch {
      setResultado('No se pudo marcar. Avisa al jefe.')
    } finally {
      setPendientes(pendientesEnCola())
      setOcupado(false)
    }
  }

  /** La cara no se reconoció: se manda la foto de ese intento para que el jefe la revise. */
  async function dejarParaJefe(foto: string | null) {
    setNoCoincide(null)
    await ejecutar({ metodo: 'ROSTRO', foto, forzarRevision: true })
  }

  function digito(d: string) {
    if (ocupado) return
    setAvisoPin('')
    const siguiente = (pin + d).slice(0, 4)
    setPin(siguiente)
    if (siguiente.length === 4) void ejecutar({ metodo: 'PIN', pin: siguiente })
  }

  function cerrarQuiosco() {
    if (!window.confirm('¿Cerrar el quiosco? Para volver a abrirlo hace falta el usuario y el PIN del quiosco.')) return
    onLogout()
  }

  return (
    <div className="quiosco">
      <header className="quiosco__cab">
        <div className="quiosco__marca">
          <h1>Quiosco del taller</h1>
          <span className="quiosco__reloj">{hora}</span>
        </div>
        <div className="quiosco__estado">
          <span className="quiosco__adentro">Adentro ahora: {adentroAhora}</span>
          {roster?.desdeCache && (
            <span className="quiosco__aviso">
              {roster.actualizadoEn
                ? `Sin señal: lista guardada del ${fmtFechaHora(roster.actualizadoEn)}`
                : 'Sin señal: lista guardada en esta tableta'}
            </span>
          )}
          {pendientes > 0 && <span className="quiosco__aviso">⏳ {pendientes} marcación(es) por subir</span>}
        </div>
      </header>

      <p className="quiosco__ayuda">Toca tu nombre, mira a la cámara y parpadea.</p>

      {cargando && !roster ? (
        <p className="quiosco__vacio">Cargando el personal…</p>
      ) : resultado ? (
        <div className="quiosco__resultado" role="status" aria-live="polite">
          <p>{resultado}</p>
        </div>
      ) : noCoincide && seleccionado ? (
        <div className="quiosco__panel quiosco__panel--aviso">
          <h2>No te reconocí</h2>
          <p className="quiosco__estado-persona">Busca luz de frente, quítate la gorra o las gafas oscuras y vuelve a intentar.</p>
          <button type="button" className="quiosco__cara quiosco__cara--entrada" onClick={() => { setNoCoincide(null); setVista('camara') }}>
            Intentar otra vez
          </button>
          <button type="button" className="quiosco__secundario" onClick={() => { setNoCoincide(null); setVista('pin') }}>
            Marcar con mi PIN
          </button>
          <button type="button" className="quiosco__secundario" onClick={() => void dejarParaJefe(noCoincide.foto)}>
            Dejarla para el jefe
          </button>
        </div>
      ) : seleccionado ? (
        vista === 'pin' ? (
          <div className="quiosco__panel">
            <h2>{seleccionado.nombre}</h2>
            <p className="quiosco__pin-titulo">Escribe tu PIN de 4 dígitos</p>
            <div className="quiosco__puntos" aria-label={`${pin.length} de 4 dígitos`}>
              {[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'is-lleno' : ''} />)}
            </div>
            {avisoPin && <p className="quiosco__pin-error">{avisoPin}</p>}
            <div className="quiosco__teclado">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" className="quiosco__tecla" onClick={() => digito(d)} disabled={ocupado}>
                  {d}
                </button>
              ))}
              <span className="quiosco__tecla quiosco__tecla--hueco" aria-hidden />
              <button type="button" className="quiosco__tecla" onClick={() => digito('0')} disabled={ocupado}>0</button>
              <button
                type="button"
                className="quiosco__tecla quiosco__tecla--borrar"
                onClick={() => { setAvisoPin(''); setPin(pin.slice(0, -1)) }}
                disabled={ocupado}
                aria-label="Borrar el último dígito"
              >
                ⌫
              </button>
            </div>
            {ocupado && <p className="quiosco__ocupado">Un momento…</p>}
            <button
              type="button"
              className="quiosco__secundario"
              onClick={() => { setPin(''); setAvisoPin(''); setVista('persona') }}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="quiosco__panel">
            {rostroSel?.foto
              ? <img src={rostroSel.foto} alt={`Cara de ${seleccionado.nombre}`} className="quiosco__foto quiosco__foto--grande" />
              : <span className="quiosco__iniciales quiosco__iniciales--grande" aria-hidden>{iniciales(seleccionado.nombre)}</span>}
            <h2>{seleccionado.nombre}</h2>
            <p className="quiosco__estado-persona">{estadoDe(seleccionado)}</p>

            {tieneCara ? (
              <>
                <button
                  type="button"
                  className={`quiosco__cara ${tipo === 'ENTRADA' ? 'quiosco__cara--entrada' : 'quiosco__cara--salida'}`}
                  onClick={() => setVista('camara')}
                  disabled={ocupado}
                >
                  {`Marcar ${tipo} con la cara`}
                </button>
                <button type="button" className="quiosco__secundario" onClick={() => setVista('pin')} disabled={ocupado}>
                  Marcar con mi PIN
                </button>
              </>
            ) : (
              <>
                <p className="quiosco__sin-cara">No tienes la cara registrada: marca con tu PIN</p>
                <button
                  type="button"
                  className={`quiosco__cara ${tipo === 'ENTRADA' ? 'quiosco__cara--entrada' : 'quiosco__cara--salida'}`}
                  onClick={() => setVista('pin')}
                  disabled={ocupado}
                >
                  Marcar con mi PIN
                </button>
              </>
            )}
            {ocupado && <p className="quiosco__ocupado">Un momento…</p>}
            <button type="button" className="quiosco__secundario" onClick={volverALista} disabled={ocupado}>
              Cancelar
            </button>
          </div>
        )
      ) : (
        <>
          <input
            type="search"
            className="quiosco__buscador"
            placeholder="Busca tu nombre o cédula"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            autoComplete="off"
          />
          {mecanicos.length === 0 ? (
            <p className="quiosco__vacio">Todavía no hay personal del taller. Que el jefe lo agregue.</p>
          ) : lista.length === 0 ? (
            <p className="quiosco__vacio">No encontramos a nadie con ese nombre o cédula.</p>
          ) : (
            <div className="quiosco__grid">
              {lista.map((m) => {
                const adentro = proximoTipo(m.ultima).tipo === 'SALIDA'
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="quiosco__persona"
                    onClick={() => { setSeleccionado(m); setVista('persona'); setAvisoPin('') }}
                  >
                    {m.rostro?.foto
                      ? <img src={m.rostro.foto} alt="" className="quiosco__foto" />
                      : <span className="quiosco__iniciales" aria-hidden>{iniciales(m.nombre)}</span>}
                    <span className="quiosco__nombre">{primerNombre(m.nombre)}</span>
                    <span className={`quiosco__chip${adentro ? ' is-dentro' : ''}`}>{adentro ? 'Adentro' : 'Afuera'}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {seleccionado && vista === 'camara' && (
        <CamaraRostro
          modo="marcar"
          onListo={(toma) => void ejecutar({ metodo: 'ROSTRO', toma })}
          onSinCara={(foto) => void dejarParaJefe(foto)}
          onCancelar={() => setVista('persona')}
        />
      )}

      <footer className="quiosco__pie">
        <button type="button" className="quiosco__cerrar" onClick={cerrarQuiosco}>
          Cerrar quiosco
        </button>
      </footer>
    </div>
  )
}

export default QuioscoTallerView
