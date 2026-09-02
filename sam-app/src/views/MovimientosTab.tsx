import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ayuda } from '../components/Ayuda'
import { BarrasH, Columnas, ColumnasApiladas, Leyenda, plegarOtros, colorDe, SERIES, type Punto, type Serie } from '../components/Charts'
import { fmtFechaHora } from '../lib/fechas'
import { fmtCantidad } from '../lib/cantidad'
import {
  loadResumenMovimientos, indiceCalidad, ritmoPorHora, hhmm,
  cuadreCarro, esDeRuta, loadSolicitudesOperarios,
  type ResumenMovimientos, type Despachador, type ResumenSolicitudes,
} from '../services/movimientosApi'

/**
 * Tablero de MOVIMIENTOS DE INSUMOS — quién entrega, qué se entrega, a quién.
 *
 * **Para qué se construyó.** El dueño quiere arrancar un pago por productividad
 * con los despachadores (Genaro, Castañeda, Diego) y necesitaba ver cómo van.
 *
 * 🔴 **La regla que ordena toda la pantalla: el volumen NUNCA se muestra solo.**
 * Pagar por número de entregas es un incentivo conocido y estudiado — Goodhart,
 * Campbell, el caso Wells Fargo — y su falla no es que la gente sea deshonesta,
 * es que la medida deja de medir en cuanto se vuelve la meta. Aquí el número de
 * entregas viaja SIEMPRE pegado a tres cosas que lo hacen creíble: la foto, el
 * aprobación del operario y las visitas. Un tablero que mostrara el ranking pelado
 * sería más bonito y le costaría plata mal repartida al dueño.
 *
 * 🔴 **Todo cuenta ENTREGAS, no filas de kardex.** Medido sobre agosto: contar
 * filas infla a Genaro un 51% y a Diego un 23%, o sea premia a quien reparte
 * materiales sueltos. Con eso se iba a pagar.
 */

function n0(v: number) { return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v) }
function n1(v: number) { return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v) }
function pct(parte: number, total: number) { return total > 0 ? Math.round((parte / total) * 100) : 0 }

/** "RIVERA HERREÑO GENARO" → "Genaro". El apellido no ayuda a leer una frase. */
function primerNombre(completo: string): string {
  const partes = completo.trim().split(/\s+/)
  const n = partes[partes.length - 1] || completo
  return n.charAt(0) + n.slice(1).toLowerCase()
}

/** Primer día del mes actual y hoy, en zona Bogotá. */
function rangoMesActual(): { desde: string; hasta: string } {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
}

/** Hoy en zona Bogotá (yyyy-mm-dd), sin depender del reloj del equipo. */
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

/** La quincena en curso: 1–15 o 16–fin de mes. Es como se paga. */
function rangoQuincena(): { desde: string; hasta: string } {
  const hoy = hoyBogota()
  const [y, m, d] = hoy.split('-')
  return Number(d) <= 15
    ? { desde: `${y}-${m}-01`, hasta: hoy }
    : { desde: `${y}-${m}-16`, hasta: hoy }
}

function rango30dias(): { desde: string; hasta: string } {
  const hoy = hoyBogota()
  const [y, m, d] = hoy.split('-').map(Number)
  const atras = new Date(Date.UTC(y, m - 1, d - 29))
  return { desde: atras.toISOString().slice(0, 10), hasta: hoy }
}

type Periodo = 'quincena' | 'mes' | 'd30' | 'otro'

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'quincena', label: 'Quincena' },
  { id: 'mes', label: 'Mes' },
  { id: 'd30', label: '30 días' },
  { id: 'otro', label: 'Otro' },
]

function diaCorto(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

/**
 * Una sección que se abre a propósito, con su cifra de resumen en el título.
 *
 * La cifra en el renglón cerrado es lo que hace que valga la pena plegar: sin
 * ella hay que abrir las cuatro para saber cuál mirar, y entonces plegar solo
 * agregó toques. No usa las píldoras de `tablero-caras` a propósito — ese
 * control ya significa «cambiar de cara» 400 px más arriba.
 */
function Acordeon({ titulo, resumen, children }: {
  titulo: string
  resumen: string
  children: React.ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="mov-acc">
      <button
        type="button"
        className="mov-acc__btn"
        aria-expanded={abierto}
        onClick={() => setAbierto(!abierto)}
      >
        <span className="mov-acc__tit">{titulo}</span>
        <span className="mov-acc__res">{resumen}</span>
        <span className="mov-acc__chev" aria-hidden>{abierto ? '⌃' : '⌄'}</span>
      </button>
      {abierto && <div className="mov-acc__cuerpo">{children}</div>}
    </div>
  )
}

export function MovimientosTab() {
  const { desde: d0, hasta: h0 } = rangoMesActual()
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [desde, setDesde] = useState(d0)
  const [hasta, setHasta] = useState(h0)
  const [diaADia, setDiaADia] = useState(false)
  const [datos, setDatos] = useState<ResumenMovimientos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [detalle, setDetalle] = useState<Despachador | null>(null)
  // El panel de solicitudes va en su propia consulta: es el que menos se abre y
  // no tiene por que viajar en cada carga del tablero.
  const [solicitudes, setSolicitudes] = useState<ResumenSolicitudes>({
    porOperario: [], porInsumo: [], detalle: [],
  })

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try {
      const [res, sols] = await Promise.all([
        loadResumenMovimientos(desde, hasta),
        loadSolicitudesOperarios(desde, hasta),
      ])
      setDatos(res)
      setSolicitudes(sols)
    } catch {
      setError('No se pudo cargar el tablero. Revisa la conexión.')
    } finally { setCargando(false) }
  }, [desde, hasta])
  useEffect(() => { void cargar() }, [cargar])

  /** «Otro» no toca las fechas: deja las que haya y muestra los dos campos. */
  function aplicarPeriodo(id: Periodo) {
    setPeriodo(id)
    if (id === 'otro') return
    const r = id === 'quincena' ? rangoQuincena() : id === 'd30' ? rango30dias() : rangoMesActual()
    setDesde(r.desde)
    setHasta(r.hasta)
  }

  const t = datos?.totales
  const despachadores = datos?.despachadores ?? []

  // Color fijo por PERSONA según su posición en la lista, no según quién va
  // ganando: si el orden repintara, el mismo tono sería Genaro un día y
  // Castañeda otro, y el ojo aprende el color antes que la leyenda.
  const seriesDespachadores: Serie[] = useMemo(
    () => despachadores.map((d, i) => ({
      id: d.id,
      label: d.nombre.split(/\s+/).slice(0, 2).join(' '),
      color: colorDe(i),
    })),
    [despachadores],
  )

  const dias = useMemo(() => {
    if (!datos) return []
    const porDia = new Map<string, Record<string, number>>()
    for (const r of datos.porDia) {
      const v = porDia.get(r.dia) ?? {}
      v[r.quien] = (v[r.quien] ?? 0) + r.entregas
      porDia.set(r.dia, v)
    }
    return [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, valores]) => ({ id: dia, label: diaCorto(dia), valores }))
  }, [datos])

  const horas: Punto[] = useMemo(
    () => (datos?.porHora ?? []).map((h) => ({
      id: String(h.hora), label: `${String(h.hora).padStart(2, '0')}h`, valor: h.entregas,
    })),
    [datos],
  )

  /**
   * Las dos cifras que resumen la hora sin abrir la gráfica.
   *
   * Lo temprano es la firma de una ruta que arranca de madrugada; lo nocturno
   * es lo contrario — una entrega a las 11 p.m. no es mala por sí misma, pero
   * es cuando menos gente hay para comprobarla, y ese es el dato.
   */
  const { pctTemprano, nocturnas } = useMemo(() => {
    const filas = datos?.porHora ?? []
    const total = filas.reduce((s, h) => s + h.entregas, 0)
    const temprano = filas.filter((h) => h.hora < 8).reduce((s, h) => s + h.entregas, 0)
    const noche = filas.filter((h) => h.hora >= 20 || h.hora < 4).reduce((s, h) => s + h.entregas, 0)
    return { pctTemprano: pct(temprano, total), nocturnas: noche }
  }, [datos])

  // Los insumos se parten POR UNIDAD: galones y unidades no se suman jamás.
  const insumosGalon = useMemo(
    () => plegarOtros((datos?.insumos ?? []).filter((i) => /^gal/i.test(i.unidad))
      .map((i) => ({ id: i.nombre, label: i.nombre, valor: i.cantidad, sufijo: 'gal' })), 5),
    [datos],
  )
  const insumosUnidad = useMemo(
    () => plegarOtros((datos?.insumos ?? []).filter((i) => !/^gal/i.test(i.unidad))
      .map((i) => ({ id: i.nombre, label: i.nombre, valor: i.cantidad, sufijo: i.unidad })), 5),
    [datos],
  )

  const topOperarios: Punto[] = useMemo(
    () => (datos?.operarios ?? []).slice(0, 8)
      .map((o) => ({ id: o.id, label: o.nombre, valor: o.entregas })),
    [datos],
  )
  const topMaquinas: Punto[] = useMemo(
    () => (datos?.maquinas ?? []).filter((m) => m.galones > 0).slice(0, 8)
      .map((m) => ({ id: m.codigo, label: m.codigo, valor: m.galones, sufijo: 'gal' })),
    [datos],
  )

  /**
   * El hallazgo, CALCULADO del periodo cargado.
   *
   * 🔴 Este párrafo tenía los números de agosto escritos a mano. Servía ese mes
   * y mentía en cuanto alguien cambiaba las fechas — la peor clase de error,
   * porque suena bien y nadie vuelve a revisarlo.
   *
   * Compara a los dos de RUTA con más y menos entregas. Solo dice algo si el
   * volumen difiere de verdad (1,5× o más) y el ritmo por hora casi no (menos del
   * 15%): ahí la diferencia fue presencia y hay que decirlo. Si no se cumple, no
   * se inventa una conclusión.
   */
  const hallazgo = useMemo(() => {
    const ruta = (datos?.despachadores ?? []).filter(esDeRuta)
      .map((d) => ({ d, ritmo: ritmoPorHora(d, datos?.jornadas ?? []) }))
      .filter((x): x is { d: Despachador; ritmo: number } => x.ritmo != null)
    if (ruta.length < 2) return null
    const orden = [...ruta].sort((a, b) => b.d.entregas - a.d.entregas)
    const alto = orden[0]
    const bajo = orden[orden.length - 1]
    const veces = bajo.d.entregas > 0 ? alto.d.entregas / bajo.d.entregas : 0
    const brecha = Math.abs(alto.ritmo - bajo.ritmo) / Math.max(alto.ritmo, bajo.ritmo)
    if (veces < 1.5 || brecha > 0.15) return null
    return {
      alto, bajo, veces,
      jA: (datos?.jornadas ?? []).find((j) => j.id === alto.d.id),
      jB: (datos?.jornadas ?? []).find((j) => j.id === bajo.d.id),
    }
  }, [datos])

  const sol = datos?.solicitudes ?? {}
  const adopcion = pct(sol.operariosQuePidieron ?? 0, datos?.operariosActivos ?? 0)

  /** Todo lo que falta cerrar, en una sola pasada: es la cinta de la capa 1. */
  const pendientes = useMemo(() => {
    const desc = despachadores.filter((d) => cuadreCarro(d) != null)
    return {
      sinFoto: t ? t.entregas - t.conFoto : 0,
      sinAprobar: datos?.avalVencido?.length ?? 0,
      cuadre: desc.reduce((s, d) => s + (cuadreCarro(d) ?? 0), 0),
      hayCuadre: desc.length > 0,
    }
  }, [despachadores, datos, t])

  /**
   * La tira de presencia: una fila por persona, una casilla por día.
   *
   * Reemplaza arriba a las 31 columnas apiladas —que siguen existiendo, a un
   * toque— porque apilar borra justo lo que sostiene el veredicto: quién estuvo
   * qué días. Un hueco en la fila se ve sin leer ningún número.
   */
  const tira = useMemo(() => {
    let max = 0
    for (const dia of dias) for (const d of despachadores) {
      max = Math.max(max, dia.valores[d.id] ?? 0)
    }
    return { max: max || 1 }
  }, [dias, despachadores])

  return (
    <section className="panel-card mov">
      <div className="panel-title split">
        <h2>Movimientos de insumos</h2>
        <div className="mov-titulo-acciones">
          <Ayuda>
            <p>Quién entrega insumos y combustible, cuánto y a quién.</p>
            <p>
              Aquí se cuentan <strong>entregas, no materiales</strong>: ganchos y combustible
              en un mismo viaje son <em>una</em> entrega. Contarlas por material inflaría a
              quien reparte suelto un 51%, y con ese número se iba a pagar.
            </p>
            <p>
              <strong>Por día trabajado</strong> — entre los días en que de verdad entregó, no
              entre los del mes.<br />
              <strong>Por hora en ruta</strong> — entre la primera y la última entrega del día.<br />
              <strong>Registro</strong> — foto, aprobación del operario y sin diferencias,
              multiplicados: fallar en uno solo lo baja.<br />
              <strong>Carro</strong> — galones cargados menos entregados. En negativo no quiere
              decir que falten; quiere decir que el mes no cierra solo.
            </p>
          </Ayuda>
          <button type="button" className="inline-button" onClick={() => void cargar()} disabled={cargando}>
            {cargando ? 'Cargando…' : '↻ Actualizar'}
          </button>
        </div>
      </div>

      {/* Chips en vez de dos campos de fecha: el 95% de las veces se quiere la
          quincena o el mes, y escribirlos a mano en un celular son ocho toques. */}
      <div className="mov-periodo">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={periodo === p.id}
            onClick={() => aplicarPeriodo(p.id)}
          >
            {p.label}
          </button>
        ))}
        {periodo === 'otro' && (
          <div className="mov-periodo__rango">
            <label>Desde
              <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label>Hasta
              <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      {datos?.desdeCache && (
        <p className="mov-alerta">
          ⚠ Sin conexión. Estos datos son del <strong>{fmtFechaHora(datos.guardadoEn)}</strong>.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {cargando && <p className="muted-text">Cargando movimientos…</p>}

      {!cargando && t && t.entregas === 0 && (
        <p className="dash-vacio">No hay entregas registradas en este periodo.</p>
      )}

      {!cargando && t && t.entregas > 0 && (
        <>
          {/* ── CAPA 1: el veredicto, las tres filas y el freno ──────────── */}
          <div className="mov-veredicto">
            {hallazgo ? (
              <>
                <p>
                  <b>{primerNombre(hallazgo.alto.d.nombre)} entregó{' '}
                  {n1(hallazgo.veces)} veces más que {primerNombre(hallazgo.bajo.d.nombre)},
                  pero por hora van casi igual</b> — {n1(hallazgo.alto.ritmo)} y{' '}
                  {n1(hallazgo.bajo.ritmo)}. La diferencia es presencia, no ritmo.
                </p>
                <p className="mov-veredicto__pie">
                  El «por hora» se mide entre la primera y la última entrega del día:
                  sirve para comparar, no para pagar.
                </p>
              </>
            ) : (
              <>
                <p>
                  <b>Este periodo los totales y el ritmo por hora cuentan la misma
                  historia.</b> Comparar los totales no engaña.
                </p>
                <p className="mov-veredicto__pie">
                  Mire igual el registro antes de decidir: el volumen sin él no dice si
                  el trabajo quedó probado.
                </p>
              </>
            )}
          </div>

          {/* Una fila por persona. Volumen, presencia y ritmo en la misma línea
              —el veredicto afirma los tres— y debajo la calidad del registro,
              para que ninguna de las dos cosas obligue a abrir un modal. */}
          <div className="mov-tarjetas">
            {despachadores.map((d, i) => {
              const cal = indiceCalidad(d)
              const ritmo = ritmoPorHora(d, datos?.jornadas ?? [])
              const porEvento = d.eventos > 0 ? d.entregas / d.eventos : 1
              const cuadre = cuadreCarro(d)
              const alertas = (d.carguesSospechosos > 0 ? 1 : 0) + (d.avalVencido > 0 ? 1 : 0)
                + (porEvento > 1.15 ? 1 : 0)
              return (
                <button key={d.id} type="button" className="mov-fila" onClick={() => setDetalle(d)}>
                  <i className="mov-fila__color" style={{ background: colorDe(i) }} />
                  <span className="mov-fila__nom">{primerNombre(d.nombre)}</span>
                  {/* Las tres van en UNA rejilla y no en tres celdas sueltas:
                      cada celda por su cuenta alinea sus propios hijos, y las
                      cifras quedaban a 354, 360 y 355 px — medido. Aquí
                      comparten fila y línea base aunque tengan tamaños distintos. */}
                  <span className="mov-fila__cifras">
                    <span className="mov-fila__c mov-fila__c--n">
                      <b>{n0(d.entregas)}</b><i>entregas</i>
                    </span>
                    <span className="mov-fila__c">
                      <b>{d.dias}</b><i>días</i>
                    </span>
                    <span className="mov-fila__c">
                      <b>{ritmo != null ? n1(ritmo) : '—'}</b><i>por hora</i>
                    </span>
                  </span>
                  {/* La celda se declara siempre, con alerta o sin ella: si
                      desapareciera, esa fila entera se correría de columna. */}
                  <span className="mov-fila__alerta">{alertas > 0 ? `⚠${alertas}` : ''}</span>
                  <span className="mov-fila__ir" aria-hidden>›</span>
                  <span className="mov-fila__pie">
                    <span className={cal >= 95 ? '' : cal >= 85 ? 'es-ojo' : 'es-mal'}>
                      <b>{cal}%</b> registro
                    </span>
                    {cuadre != null ? (
                      <span className={Math.abs(cuadre) > 50 ? 'es-mal' : ''}>
                        carro <b>{cuadre > 0 ? '+' : ''}{n0(cuadre)}</b> gal
                      </span>
                    ) : (
                      <span>bodega, sin carro · no se compara con los de ruta</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          {/* El freno se queda a la vista SIEMPRE; lo que se pliega es la
              explicación, nunca la advertencia. */}
          <div className="mov-freno">
            <span>⚠ Estos números todavía no son para pagar.</span>
            <Ayuda rotulo="Por qué">
              <p>
                <strong>{despachadores.filter((d) => !esDeRuta(d)).map((d) => primerNombre(d.nombre)).join(' y ') || 'Quien despacha desde la bodega'}</strong>{' '}
                no hace ruta: entregar no es su trabajo principal y aparece de último
                aunque haga bien lo suyo. No entra en la comparación.
              </p>
              <p>
                <strong>La demora en aprobar la decide el operario</strong> cuando
                confirma, no el despachador. Cobrársela se responde presionando al
                operario para que firme sin revisar.
              </p>
              <p>
                <strong>Un mes dice poco.</strong> Deje correr dos y vigile que las
                entregas por visita se mantengan cerca de 1,0.
              </p>
            </Ayuda>
          </div>

          {/* Informativa a propósito: no son botones porque no llevan a ninguna
              parte, y un chip pulsable que no responde se aprende como adorno. */}
          <div className="mov-cinta">
            <span><b>{n0(pendientes.sinFoto)}</b> sin foto</span>
            <span className={pendientes.sinAprobar > 0 ? 'es-ojo' : ''}>
              <b>{n0(pendientes.sinAprobar)}</b> sin aprobar
            </span>
            {pendientes.hayCuadre && (
              <span className={Math.abs(pendientes.cuadre) > 50 ? 'es-ojo' : ''}>
                <b>{pendientes.cuadre > 0 ? '+' : ''}{n0(pendientes.cuadre)}</b> gal sin cuadrar
              </span>
            )}
          </div>

          {/* ── CAPA 2: el periodo completo ──────────────────────────────── */}
          <div className="dash-kpis">
            <div className="dash-kpi">
              <span className="dash-kpi__val">{n0(t.entregas)}</span>
              <span className="dash-kpi__lbl">entregas</span>
              <span className="dash-kpi__pie">en {t.dias} días</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi__val">{n0(t.galones)}</span>
              <span className="dash-kpi__lbl">galones</span>
              <span className="dash-kpi__pie">de combustible</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi__val">{t.operarios}</span>
              <span className="dash-kpi__lbl">operarios</span>
              <span className="dash-kpi__pie">{t.maquinas} máquinas</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi__val">{pct(t.avaladas, t.entregas)}%</span>
              <span className="dash-kpi__lbl">aprobadas</span>
              <span className="dash-kpi__pie">{t.conDiferencia} con diferencia</span>
            </div>
          </div>

          <h3 className="dash-titulo">Quién estuvo, día por día</h3>
          <div className="mov-tira">
            {despachadores.map((d, i) => (
              <div key={d.id} className="mov-tira__fila">
                <span className="mov-tira__nom">{primerNombre(d.nombre)}</span>
                <span className="mov-tira__dias">
                  {dias.map((dia) => {
                    const v = dia.valores[d.id] ?? 0
                    return (
                      <span
                        key={dia.id}
                        className="mov-tira__dia"
                        title={`${dia.label}: ${v}`}
                        style={v > 0 ? {
                          background: colorDe(i),
                          opacity: 0.35 + 0.65 * (v / tira.max),
                        } : undefined}
                      />
                    )
                  })}
                </span>
              </div>
            ))}
            {dias.length > 0 && (
              <div className="mov-tira__esc">
                <span>{dias[0].label}</span>
                <span>{dias[dias.length - 1].label}</span>
              </div>
            )}
          </div>
          <div className="mov-tira__pie">
            <button type="button" className="inline-button" onClick={() => setDiaADia(true)}>
              Ver día a día
            </button>
          </div>

          {/* ── CAPA 3: lo que se abre a propósito ───────────────────────── */}
          <Acordeon titulo="Qué se entrega y a quién" resumen={`${n0(t.galones)} gal`}>
            <div className="mov-dos">
              <div>
                <p className="eyebrow">Combustible y aceites (galones)</p>
                <BarrasH datos={insumosGalon} unidad="gal" />
              </div>
              <div>
                <p className="eyebrow">Repuestos y materiales (unidades)</p>
                <BarrasH datos={insumosUnidad} unidad="unidad" color={SERIES[1]} />
              </div>
            </div>
            <div className="mov-dos">
              <div>
                <p className="eyebrow">Operarios con más entregas</p>
                <BarrasH datos={topOperarios} unidad="entregas" color={SERIES[2]} />
              </div>
              <div>
                <p className="eyebrow">Máquinas por combustible</p>
                <BarrasH datos={topMaquinas} unidad="gal" color={SERIES[3]} />
              </div>
            </div>
          </Acordeon>

          <Acordeon titulo="A qué hora se entrega" resumen={`${pctTemprano}% antes de 8`}>
            {nocturnas > 0 && (
              <p className="mov-alerta">
                ⚠ {n0(nocturnas)} entrega{nocturnas > 1 ? 's' : ''} entre las 8 p.m. y las
                4 a.m. Es cuando menos gente hay para comprobar.
              </p>
            )}
            <Columnas datos={horas} />
          </Acordeon>

          <Acordeon
            titulo="Quién pide, y qué"
            resumen={`${n0(sol.total ?? 0)} · ${n0(sol.rechazadas ?? 0)} rechazadas`}
          >
            {(sol.total ?? 0) > 0 && (sol.total ?? 0) < 30 && (
              <span className="mov-chip-n">muestra pequeña · n={n0(sol.total ?? 0)}</span>
            )}

            {(sol.rechazadas ?? 0) > 0 && (sol.rechazadas ?? 0) >= (sol.entregadas ?? 0) && (
              <p className="mov-veredicto">
                <b>De {n0(sol.total ?? 0)} solicitudes, {n0(sol.rechazadas ?? 0)} terminaron
                rechazadas.</b> No es que no pidan: el pedido compite con la ruta, y la
                ruta va primero.
              </p>
            )}

            <div className="dash-kpis">
              <div className="dash-kpi">
                <span className="dash-kpi__val">{n0(sol.total ?? 0)}</span>
                <span className="dash-kpi__lbl">solicitudes</span>
                <span className="dash-kpi__pie">contra {n0(t.entregas)} entregas directas</span>
              </div>
              <div className="dash-kpi">
                <span className="dash-kpi__val">{sol.operariosQuePidieron ?? 0}/{datos?.operariosActivos ?? 0}</span>
                <span className="dash-kpi__lbl">operarios han pedido</span>
                <span className="dash-kpi__pie">{adopcion}% de adopción</span>
              </div>
              <div className="dash-kpi">
                <span className="dash-kpi__val">{n0(sol.entregadas ?? 0)}</span>
                <span className="dash-kpi__lbl">terminaron entregadas</span>
                <span className="dash-kpi__pie">de {n0(sol.total ?? 0)}</span>
              </div>
              <div className="dash-kpi">
                <span className="dash-kpi__val">{n0(sol.rechazadas ?? 0)}</span>
                <span className="dash-kpi__lbl">rechazadas</span>
                <span className="dash-kpi__pie">{n0(sol.pendientes ?? 0)} sin atender</span>
              </div>
            </div>

            {(solicitudes.porOperario?.length ?? 0) > 0 && (
              <div className="mov-dos">
                <div>
                  <p className="eyebrow">Quién pide</p>
                  <BarrasH
                    datos={(solicitudes.porOperario ?? []).map((o) => ({
                      id: o.id, label: o.nombre, valor: o.solicitudes,
                    }))}
                    unidad="solicitudes"
                    color={SERIES[4]}
                  />
                </div>
                <div>
                  <p className="eyebrow">Qué piden</p>
                  <BarrasH
                    datos={(solicitudes.porInsumo ?? []).map((i) => ({
                      id: i.nombre, label: i.nombre, valor: i.veces, sufijo: 'veces',
                    }))}
                    unidad="veces"
                    color={SERIES[5]}
                  />
                </div>
              </div>
            )}

            {/* Con pocas solicitudes la LISTA COMPLETA informa más que cualquier
                agregado: deja ver el caso concreto y su motivo. Va en filas y no
                en tabla — una tabla de 620 px obliga a rodar de lado en celular. */}
            {(solicitudes.detalle ?? []).map((s) => (
              <div key={s.id} className="mov-row">
                <div className="mov-row__items">
                  <strong>{s.operario}</strong>
                  <span className={`status-pill ${s.estado === 'ENTREGADA' ? 'green'
                    : s.estado === 'RECHAZADA' ? 'red' : 'amber'}`}>
                    {s.estado}
                  </span>
                </div>
                <p className="subtle-copy">
                  {s.items ?? '—'}
                  {s.nota && <> · {s.nota}</>}
                </p>
                <p className="subtle-copy">
                  {fmtFechaHora(s.creada)}
                  {s.requeridoPara && <> · lo quería {fmtFechaHora(s.requeridoPara)}</>}
                  {s.motivo && <> · {s.motivo}</>}
                </p>
              </div>
            ))}
          </Acordeon>

          <Acordeon titulo="Lo que falta cerrar" resumen={`${n0(pendientes.sinFoto)} sin foto`}>
            <div className="dash-kpis">
              <div className="dash-kpi">
                <span className="dash-kpi__val">{n0(pendientes.sinFoto)}</span>
                <span className="dash-kpi__lbl">sin foto</span>
                <span className="dash-kpi__pie">de {n0(t.entregas)} entregas</span>
              </div>
              <div className="dash-kpi">
                <span className="dash-kpi__val">{n0(pendientes.sinAprobar)}</span>
                <span className="dash-kpi__lbl">sin aprobar</span>
                <span className="dash-kpi__pie">con más de 3 días</span>
              </div>
              <div className="dash-kpi">
                <span className="dash-kpi__val">{t.horasAvalMediana != null ? n1(t.horasAvalMediana) : '—'} h</span>
                <span className="dash-kpi__lbl">tarda la aprobación</span>
                <span className="dash-kpi__pie">la mitad, menos de eso</span>
              </div>
            </div>
            <p className="subtle-copy mov-nota">
              Es una <strong>mediana</strong>, no un promedio: unas pocas aprobaciones muy
              viejas arrastran el promedio a un número que no describe a nadie.
            </p>
          </Acordeon>
        </>
      )}

      {/* Sello de corte: en este proyecto todo entregable dice cuándo se sacó. */}
      {!cargando && datos?.corteEn && (
        <p className="subtle-copy mov-sello">
          Corte del {fmtFechaHora(datos.corteEn)} · periodo {datos.desde} a {datos.hasta}.
        </p>
      )}

      {/* La serie diaria completa que pidió el cliente: sigue existiendo, pero
          dentro de un modal, donde el gesto lateral no le compite al scroll. */}
      {diaADia && (
        <div className="modal-overlay open" onClick={() => setDiaADia(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Entregas por día</p>
                <h3>{datos?.desde} a {datos?.hasta}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDiaADia(false)} aria-label="Cerrar">✕</button>
            </div>
            <ColumnasApiladas dias={dias} series={seriesDespachadores} />
            <Leyenda series={seriesDespachadores} />
          </div>
        </div>
      )}

      {/* ── Detalle de una persona ──────────────────────────────────────── */}
      {detalle && (
        <div className="modal-overlay open" onClick={() => setDetalle(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Despachador</p>
                <h3>{detalle.nombre}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDetalle(null)} aria-label="Cerrar">✕</button>
            </div>
            <div className="dash-kpis">
              <div className="dash-kpi"><span className="dash-kpi__val">{n0(detalle.entregas)}</span><span className="dash-kpi__lbl">entregas</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{n0(detalle.eventos)}</span><span className="dash-kpi__lbl">visitas</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{detalle.dias}</span><span className="dash-kpi__lbl">días activos</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{n0(detalle.galones)}</span><span className="dash-kpi__lbl">galones</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{detalle.maquinas}</span><span className="dash-kpi__lbl">máquinas</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{detalle.operarios}</span><span className="dash-kpi__lbl">operarios</span></div>
            </div>
            {(() => {
              const jor = (datos?.jornadas ?? []).find((j) => j.id === detalle.id)
              const porEvento = detalle.eventos > 0 ? detalle.entregas / detalle.eventos : 1
              return (
                <>
                  <ul className="mov-detalle-lista">
                    {jor && (
                      <li>
                        Jornada: de {hhmm(jor.primeraHora)} a {hhmm(jor.ultimaHora)}{' '}
                        (<strong>{n1(jor.horas)} h</strong>)
                      </li>
                    )}
                    <li>Con foto: <strong>{detalle.conFoto}</strong> de {detalle.entregas} ({pct(detalle.conFoto, detalle.entregas)}%)</li>
                    <li>Aprobadas por el operario: <strong>{detalle.avaladas}</strong> ({pct(detalle.avaladas, detalle.entregas)}%)</li>
                    <li>Reportadas con diferencia: <strong>{detalle.conDiferencia}</strong></li>
                    <li>Con horómetro registrado: <strong>{detalle.conHorometro}</strong> ({pct(detalle.conHorometro, detalle.entregas)}%)</li>
                    {detalle.horasAvalMediana != null && (
                      <li>La aprobación tarda <strong>{n1(detalle.horasAvalMediana)} h</strong> (mediana)</li>
                    )}
                    <li>Primera entrega: {fmtFechaHora(detalle.primera)}</li>
                    <li>Última entrega: {fmtFechaHora(detalle.ultima)}</li>
                    <li>
                      Promedio por entrega:{' '}
                      <strong>{fmtCantidad(detalle.entregas > 0 ? detalle.galones / detalle.entregas : 0, 'galón')} gal</strong>
                    </li>
                  </ul>

                  {detalle.carguesSospechosos > 0 && (
                    <p className="mov-alerta">
                      ⚠ {detalle.carguesSospechosos} cargue{detalle.carguesSospechosos > 1 ? 's' : ''} por
                      encima de 500 galones, por fuera del cuadre. Revíselo en Aprobaciones.
                    </p>
                  )}
                  {detalle.avalVencido > 0 && (
                    <p className="mov-alerta">
                      ⚠ {detalle.avalVencido} entrega{detalle.avalVencido > 1 ? 's' : ''} sin
                      aprobar con más de 3 días
                    </p>
                  )}
                  {porEvento > 1.15 && (
                    <p className="mov-alerta">
                      ⚠ {n1(porEvento)} entregas por visita — revisar si se están partiendo
                    </p>
                  )}
                </>
              )
            })()}
            <p className="subtle-copy">
              «Visitas» agrupa las entregas a la misma máquina dentro de hora y media. Si
              las entregas suben mucho más rápido que las visitas, alguien está partiendo
              un tanqueo en varios registros.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

export default MovimientosTab
