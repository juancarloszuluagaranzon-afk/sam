import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ayuda } from '../components/Ayuda'
import { BarrasH, Columnas, SERIES, type Punto } from '../components/Charts'
import { fmtFechaHora } from '../lib/fechas'
import { PERIODOS, rangoDe, esUnSoloDia, hoyBogota, type Periodo } from '../lib/periodos'
import { useAppData } from '../context/AppDataContext'
import { executionDateKey, loadKardexReporte } from '../services/samApi'
import { ModalEntregas } from '../components/ModalEntregas'
import { InsumosCard } from './InsumosCard'
import { ConsumoHoraCard } from './ConsumoHoraCard'
import { PorDespacharCard } from './PorDespacharCard'
import type { InsumoKardex } from '../domain/sam'
import {
  loadResumenMovimientos,
  cuadreCarro, loadSolicitudesOperarios,
  type ResumenMovimientos, type ResumenSolicitudes,
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
  const { assignments, insumos, sortedEquipment } = useAppData()
  // El mes sigue siendo el arranque: con «Hoy» el ritmo por hora se
  // calcula sobre una jornada a medias y el tablero es de tendencia.
  const hoy = hoyBogota()
  const [periodo, setPeriodo] = useState<Periodo>('MES')
  const [desde, setDesde] = useState(() => rangoDe('MES', hoy).desde)
  const [hasta, setHasta] = useState(() => rangoDe('MES', hoy).hasta)
  const [movs, setMovs] = useState<InsumoKardex[]>([])
  const [detIns, setDetIns] = useState<{ titulo: string; items: InsumoKardex[] } | null>(null)
  const [datos, setDatos] = useState<ResumenMovimientos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  // El panel de solicitudes va en su propia consulta: es el que menos se abre y
  // no tiene por que viajar en cada carga del tablero.
  const [solicitudes, setSolicitudes] = useState<ResumenSolicitudes>({
    porOperario: [], porInsumo: [], detalle: [],
  })

  // Cada «Actualizar» recarga también la cola de «Por despachar».
  const [vuelta, setVuelta] = useState(0)
  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    setVuelta((v) => v + 1)
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

  /** «Rango» no toca las fechas: deja las que haya y muestra los dos campos. */
  function aplicarPeriodo(id: Periodo) {
    setPeriodo(id)
    if (id === 'RANGO') return
    const r = rangoDe(id, hoy)
    setDesde(r.desde)
    setHasta(r.hasta)
  }

  // El kardex del mismo rango: es lo que alimenta las tortas y el gal/ha.
  // Va aparte del RPC del tablero porque son dos preguntas distintas —
  // quién entregó y qué se entregó— y una no debe esperar a la otra.
  useEffect(() => {
    void loadKardexReporte({ desde, hasta: `${hasta}T23:59:59` }).then(setMovs).catch(() => setMovs([]))
  }, [desde, hasta])

  /** Consumos: SALIDA con máquina. Surtir un carro no es consumo. */
  const insumosMovs = useMemo(() => movs.filter((m) => m.tipo === 'SALIDA' && m.equipoCodigo), [movs])
  /** Labores cerradas del rango: el denominador del gal/ha. */
  const cerradas = useMemo(() => assignments.filter((a) => {
    if (a.status !== 'COMPLETADA' && a.status !== 'PARCIAL') return false
    const k = executionDateKey(a)
    return !!k && k >= desde && k <= hasta
  }), [assignments, desde, hasta])
  const catalogoInsumos = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])
  const nombreMaq = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return (c: string) => m.get(c) ?? c
  }, [sortedEquipment])

  const t = datos?.totales
  const despachadores = datos?.despachadores ?? []

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

  const topOperarios: Punto[] = useMemo(
    () => (datos?.operarios ?? []).slice(0, 8)
      .map((o) => ({ id: o.id, label: o.nombre, valor: o.entregas })),
    [datos],
  )

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

  return (
    <section className="panel-card mov">
      <div className="panel-title split">
        <h2>Insumos y materiales</h2>
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

      {/* Chips en vez de dos campos de fecha: escribirlos a mano en un celular
          son ocho toques. Son LOS MISMOS de Operación general (`lib/periodos`),
          porque el cliente pidió comparar las dos caras del tablero sin tener
          que traducir «quincena» de una a la otra. */}
      <div className="mov-periodo">
        {PERIODOS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={periodo === p.value}
            onClick={() => aplicarPeriodo(p.value)}
          >
            {p.label}
          </button>
        ))}
        {periodo === 'RANGO' && (
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
        <>
          <p className="dash-vacio">No hay entregas registradas en este periodo.</p>
          {/* Sin entregas en el periodo (p. ej. «Hoy» temprano) es justo cuando más
              sirve ver qué hay por despachar. */}
          <PorDespacharCard vuelta={vuelta} />
        </>
      )}

      {!cargando && t && t.entregas > 0 && (
        <>
          {/* 🔴 La lista por persona (entregas, días, por hora, % de registro, cuadre
              del carro) y su aviso «todavía no son para pagar» se QUITARON el
              21-sep-2026: lo pidió el cliente («quita esto»). Las funciones que la
              calculaban siguen en lib/ por si vuelve el pago por productividad. */}
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

          {/* ── Por despachar: lo que falta entregar, para planear mañana ───
              Pedido del cliente (21-sep-2026). Va justo después de las cifras de lo
              ENTREGADO: primero lo que pasó, enseguida lo que falta. No sigue el
              filtro de periodo — es la cola viva. */}
          <PorDespacharCard vuelta={vuelta} />

          {/* ── Qué se entregó ────────────────────────────────────────────
              Hasta aquí la pantalla habló de PERSONAS: quién entregó, cuánto,
              qué días. De aquí en adelante habla del MATERIAL: qué salió, a
              qué máquina, cuánto por hectárea. Estaba metida entre los KPI y
              la tira de días, partiendo la historia de las personas en dos y
              poniendo dos filas de cifras seguidas — «saturado», dijo el
              cliente. Va `compacta` porque los KPI de arriba ya cuentan.

              Es el MISMO componente que la tarjeta de Operación general, no una
              copia: dos tableros del mismo hecho terminan dando dos verdades. */}
          <InsumosCard
            compacta
            movs={insumosMovs}
            cerradas={cerradas}
            catalogo={catalogoInsumos}
            nombreMaq={nombreMaq}
            unSoloDia={esUnSoloDia(periodo)}
            cargando={insumos.length === 0}
            onVerEntregas={(titulo, items) => setDetIns({ titulo, items })}
          />

          {/* Combustible por hora de máquina: una barra por máquina y su gal/h,
              con el horómetro inicial y final del periodo (pedido 18-sep-2026).
              Usa el MISMO filtro de periodo de arriba. */}
          <ConsumoHoraCard
            movs={insumosMovs}
            cerradas={cerradas}
            catalogo={catalogoInsumos}
            nombreMaq={nombreMaq}
            desde={desde}
            hasta={hasta}
            unSoloDia={esUnSoloDia(periodo)}
          />

          {/* ── CAPA 3: lo que se abre a propósito ───────────────────────── */}
          {/* Antes aquí había cuatro gráficas de barras: qué material, por
             unidad, y qué máquina por combustible. Las tres primeras eran la
             MISMA pregunta que las tortas de arriba, con otra forma; la última
             era exactamente el mismo dato. Queda solo lo que la tarjeta no
             tiene: a QUIÉN se le entrega. */}
          <Acordeon titulo="A quién se entrega" resumen={`${t.operarios} operarios`}>
            <p className="eyebrow">Operarios con más entregas</p>
            <BarrasH datos={topOperarios} unidad="entregas" color={SERIES[2]} />
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

      {/* ── Detalle de una persona ──────────────────────────────────────── */}
      {/* Las entregas detrás de una porción de las tortas. */}
      {detIns && (
        <ModalEntregas titulo={detIns.titulo} items={detIns.items} onClose={() => setDetIns(null)} />
      )}
    </section>
  )
}

export default MovimientosTab
