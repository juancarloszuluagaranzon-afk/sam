import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ayuda } from '../components/Ayuda'
import { BarrasH, Columnas, ColumnasApiladas, Leyenda, plegarOtros, colorDe, SERIES, type Punto, type Serie } from '../components/Charts'
import { fmtFechaHora } from '../lib/fechas'
import { fmtCantidad } from '../lib/cantidad'
import {
  loadResumenMovimientos, indiceCalidad, entregasPorDia, ritmoPorHora, hhmm,
  type ResumenMovimientos, type Despachador,
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
 * aval del operario y las visitas. Un tablero que mostrara el ranking pelado
 * sería más bonito y le costaría plata mal repartida al dueño.
 *
 * 🔴 **Todo cuenta ENTREGAS, no filas de kardex.** Medido sobre agosto: contar
 * filas infla a Genaro un 51% y a Diego un 23%, o sea premia a quien reparte
 * materiales sueltos. Con eso se iba a pagar.
 */

function n0(v: number) { return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v) }
function n1(v: number) { return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v) }
function pct(parte: number, total: number) { return total > 0 ? Math.round((parte / total) * 100) : 0 }

/** Primer día del mes actual y hoy, en zona Bogotá. */
function rangoMesActual(): { desde: string; hasta: string } {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
}

function diaCorto(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

export function MovimientosTab() {
  const { desde: d0, hasta: h0 } = rangoMesActual()
  const [desde, setDesde] = useState(d0)
  const [hasta, setHasta] = useState(h0)
  const [datos, setDatos] = useState<ResumenMovimientos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [detalle, setDetalle] = useState<Despachador | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try {
      setDatos(await loadResumenMovimientos(desde, hasta))
    } catch {
      setError('No se pudo cargar el tablero. Revisa la conexión.')
    } finally { setCargando(false) }
  }, [desde, hasta])
  useEffect(() => { void cargar() }, [cargar])

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

  const sol = datos?.solicitudes ?? {}
  const adopcion = pct(sol.operariosQuePidieron ?? 0, datos?.operariosActivos ?? 0)

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>📦 Movimientos de insumos</h2>
        <button type="button" className="inline-button" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? 'Cargando…' : '↻ Actualizar'}
        </button>
      </div>

      <Ayuda>
        <p>
          Quién entrega el material y el combustible, qué entrega y a quién. Está pensado
          para responder <strong>cómo va cada despachador</strong> sin que el número se
          pueda inflar.
        </p>
        <p>
          🔴 <strong>Aquí se cuentan ENTREGAS, no materiales.</strong> Una entrega de
          ganchos y combustible es <em>un</em> viaje del supervisor, no dos. Suena a
          detalle y no lo es: contando materiales, Genaro aparecería con un 51% más de
          trabajo del que hizo — y con ese número se iba a pagar.
        </p>
        <p>
          🔴 <strong>El volumen nunca va solo.</strong> Al lado de cuántas entregas hizo
          cada uno va si quedaron con foto, si el operario las avaló y cuántas
          <em> visitas</em> fueron. Un número de entregas sin esas tres cosas se puede
          inflar en un día; con ellas, no.
        </p>
      </Ayuda>

      <div className="dash-filtros" style={{ marginTop: 12 }}>
        <label>Desde
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>Hasta
          <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      {cargando && <p className="muted-text">Cargando movimientos…</p>}

      {!cargando && t && t.entregas === 0 && (
        <p className="dash-vacio">No hay entregas registradas en este periodo.</p>
      )}

      {!cargando && t && t.entregas > 0 && (
        <>
          {/* ── Lo que pasó en el periodo ───────────────────────────────── */}
          <div className="dash-kpis">
            <div className="dash-kpi">
              <strong>{n0(t.entregas)}</strong>
              <span>entregas</span>
              <small>en {t.dias} días</small>
            </div>
            <div className="dash-kpi">
              <strong>{n0(t.galones)}</strong>
              <span>galones</span>
              <small>de combustible</small>
            </div>
            <div className="dash-kpi">
              <strong>{t.operarios}</strong>
              <span>operarios</span>
              <small>{t.maquinas} máquinas</small>
            </div>
            <div className="dash-kpi">
              <strong>{pct(t.avaladas, t.entregas)}%</strong>
              <span>avaladas</span>
              <small>{t.conDiferencia} con diferencia</small>
            </div>
          </div>

          {/* ── El ranking, siempre con su calidad al lado ──────────────── */}
          <h3 className="dash-titulo">Cómo va cada despachador</h3>
          <div className="mov-tarjetas">
            {despachadores.map((d, i) => {
              const cal = indiceCalidad(d)
              const porDia = entregasPorDia(d)
              const ritmo = ritmoPorHora(d, datos?.jornadas ?? [])
              const jor = (datos?.jornadas ?? []).find((j) => j.id === d.id)
              const porEvento = d.eventos > 0 ? d.entregas / d.eventos : 1
              return (
                <button key={d.id} type="button" className="mov-tarjeta" onClick={() => setDetalle(d)}>
                  <div className="mov-tarjeta__head">
                    <i className="mov-tarjeta__color" style={{ background: colorDe(i) }} />
                    <strong>{d.nombre}</strong>
                  </div>
                  <div className="mov-tarjeta__cifras">
                    <div>
                      <b>{n0(d.entregas)}</b>
                      <span>entregas</span>
                    </div>
                    <div>
                      <b>{n1(porDia)}</b>
                      <span>por día trabajado</span>
                    </div>
                    {/* 🔴 El ritmo va PEGADO al volumen. Es el número que cambia
                        la conclusión: dos personas con volumen muy distinto pueden
                        tener el mismo ritmo, y entonces la diferencia era presencia,
                        no productividad. */}
                    <div>
                      <b>{ritmo != null ? n1(ritmo) : '—'}</b>
                      <span>por hora en campo</span>
                    </div>
                    <div>
                      <b>{jor ? n1(jor.horas) : '—'} h</b>
                      <span>jornada</span>
                    </div>
                  </div>
                  {jor && (
                    <p className="mov-jornada">
                      {d.dias} días activos · de {hhmm(jor.primeraHora)} a {hhmm(jor.ultimaHora)}
                      {' · '}{n0(d.galones)} galones · {d.maquinas} máquinas
                    </p>
                  )}
                  <div className={`mov-calidad mov-calidad--${cal >= 95 ? 'ok' : cal >= 85 ? 'medio' : 'bajo'}`}>
                    <span className="mov-calidad__num">{cal}%</span>
                    <span className="mov-calidad__det">
                      registro completo · {pct(d.conFoto, d.entregas)}% con foto ·
                      {' '}{pct(d.avaladas, d.entregas)}% avalado
                    </span>
                  </div>
                  {porEvento > 1.15 && (
                    <p className="mov-alerta">
                      ⚠ {n1(porEvento)} entregas por visita — revisar si se están partiendo
                    </p>
                  )}
                </button>
              )
            })}
          </div>

          <div className="mov-clave">
            <p>
              🔴 <strong>Antes de comparar los totales, mire la columna «por hora en
              campo».</strong> En agosto Genaro entregó 263 veces y Castañeda 104 — dos
              veces y media más. Pero por hora van <strong>1,2 los dos</strong>: el mismo
              ritmo. Toda la diferencia es <strong>presencia</strong>: Genaro trabajó 29 de
              31 días con jornadas de 7 horas; Castañeda 20 días con jornadas de 4.
            </p>
            <p>
              Eso no le quita mérito a Genaro — estar es parte del trabajo, y en los dos
              domingos que él descansó fue Castañeda quien cubrió. Pero{' '}
              <strong>premiar la presencia y premiar la productividad son dos decisiones
              distintas</strong>, y con el total del mes a secas se toma una creyendo que
              se toma la otra.
            </p>
          </div>

          <p className="subtle-copy mov-nota">
            <strong>«Por día trabajado»</strong> divide entre los días en que de verdad
            entregó, no entre los días del mes: comparar contra el calendario castigaría a
            quien estuvo incapacitado o de descanso. <strong>«Por hora en campo»</strong>
            usa el tiempo entre la primera y la última entrega del día — es una ventana de
            trabajo, no horas pagadas: aquí nadie marca entrada. Y{' '}
            <strong>el porcentaje de abajo</strong> es qué tan completo quedó el registro:
            foto, aval del operario y sin diferencias, multiplicados. Se multiplican y no
            se promedian a propósito: fallar en cualquiera de los tres tiene que bajarlo,
            que para eso es un control.
          </p>

          <p className="subtle-copy mov-nota">
            <strong>El cuadre del carro</strong> compara lo que cada supervisor cargó
            contra lo que entregó desde él. Un número en negativo <em>no</em> quiere decir
            que falten galones — puede ser saldo que venía del mes pasado o un cargue que
            no se registró. Quiere decir que <strong>las cuentas del mes no cierran
            solas</strong>, y eso hay que resolverlo antes de amarrarle plata. A quien
            despacha desde la bodega principal no le sale cuadre, porque no tiene carro.
          </p>

          {/* ── La serie diaria: lo que pidió el cliente ─────────────────── */}
          <h3 className="dash-titulo">Entregas por día</h3>
          <ColumnasApiladas dias={dias} series={seriesDespachadores} />
          <Leyenda series={seriesDespachadores} />

          {/* ── A qué hora ──────────────────────────────────────────────── */}
          <h3 className="dash-titulo">A qué hora se entrega</h3>
          <Columnas datos={horas} />
          <p className="subtle-copy mov-nota">
            La ruta arranca de madrugada y se apaga después del mediodía. Las entregas
            sueltas de la noche valen una mirada: no está mal entregar tarde, pero es
            cuando menos gente hay para comprobar.
          </p>

          {/* ── Qué se entrega ──────────────────────────────────────────── */}
          <h3 className="dash-titulo">Qué se entrega</h3>
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
          <p className="subtle-copy mov-nota">
            Van en dos listas y no en una a propósito: <strong>sumar galones con unidades
            da un número que no significa nada.</strong> Ya pasó una vez en el Inicio
            —«entrega directa 63,95» eran 40 ganchos más 23,95 galones— y nadie lo notó.
          </p>

          {/* ── Quién recibe ────────────────────────────────────────────── */}
          <h3 className="dash-titulo">Quién recibe</h3>
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

          {/* ── Las solicitudes del operario, con su verdad por delante ─── */}
          <h3 className="dash-titulo">Solicitudes hechas por operarios</h3>
          {(sol.total ?? 0) < 20 ? (
            <div className="mov-vacio-explicado">
              <p>
                <strong>Este flujo casi no se usa todavía.</strong> En el periodo hay
                {' '}<strong>{sol.total ?? 0} solicitudes</strong> de operarios contra
                {' '}<strong>{n0(t.entregas)} entregas</strong>: de cada 100 entregas,
                menos de 2 nacieron de un pedido. Las demás las lleva el supervisor por su
                cuenta.
              </p>
              <p>
                Han pedido <strong>{sol.operariosQuePidieron ?? 0} de {datos?.operariosActivos ?? 0} operarios</strong>
                {' '}({adopcion}%). Por eso aquí no hay ranking de quién pide más: con esos
                números, el primer puesto lo decidiría una sola solicitud.
              </p>
              <p className="subtle-copy">
                Si quiere que este flujo arranque, lo que mueve la aguja es el operario, no
                el tablero. Mientras tanto, «quién recibe» de arriba responde la misma
                pregunta —quién consume y cuánto— con datos de verdad.
              </p>
            </div>
          ) : (
            <div className="dash-kpis">
              <div className="dash-kpi"><strong>{sol.total}</strong><span>solicitudes</span></div>
              <div className="dash-kpi"><strong>{sol.pendientes ?? 0}</strong><span>sin atender</span></div>
              <div className="dash-kpi">
                <strong>{sol.minutosRespuesta ? n0(sol.minutosRespuesta / 60) : '—'}</strong>
                <span>horas de respuesta</span>
              </div>
              <div className="dash-kpi"><strong>{adopcion}%</strong><span>de operarios pide</span></div>
            </div>
          )}

          {/* ── La advertencia que no se puede quitar ───────────────────── */}
          <div className="mov-advertencia">
            <p><strong>Antes de pagar con estos números</strong></p>
            <ul>
              <li>
                <strong>No compare a Diego con los otros dos.</strong> Es analista, no
                supervisor de ruta: entregar no es su trabajo principal y aparecerá siempre
                de último aunque haga bien lo suyo.
              </li>
              <li>
                <strong>El tiempo hasta el aval no es culpa del despachador.</strong> Ese
                reloj lo para el operario cuando confirma, y a veces confirma al otro día.
                Castigarlo por eso se responde presionando al operario para que firme sin
                revisar, y ahí se pierde el control entero.
              </li>
              <li>
                <strong>Un solo mes es poco.</strong> Estos datos arrancan el 1 de agosto.
                Antes de amarrarles plata, deje correr un par de meses y mire si el número
                de entregas por visita se mantiene en 1,0.
              </li>
            </ul>
          </div>
        </>
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
              <div className="dash-kpi"><strong>{n0(detalle.entregas)}</strong><span>entregas</span></div>
              <div className="dash-kpi"><strong>{n0(detalle.eventos)}</strong><span>visitas</span></div>
              <div className="dash-kpi"><strong>{detalle.dias}</strong><span>días activos</span></div>
              <div className="dash-kpi"><strong>{n0(detalle.galones)}</strong><span>galones</span></div>
              <div className="dash-kpi"><strong>{detalle.maquinas}</strong><span>máquinas</span></div>
              <div className="dash-kpi"><strong>{detalle.operarios}</strong><span>operarios</span></div>
            </div>
            <ul className="mov-detalle-lista">
              <li>Con foto: <strong>{detalle.conFoto}</strong> de {detalle.entregas} ({pct(detalle.conFoto, detalle.entregas)}%)</li>
              <li>Avaladas por el operario: <strong>{detalle.avaladas}</strong> ({pct(detalle.avaladas, detalle.entregas)}%)</li>
              <li>Reportadas con diferencia: <strong>{detalle.conDiferencia}</strong></li>
              <li>Con horómetro registrado: <strong>{detalle.conHorometro}</strong> ({pct(detalle.conHorometro, detalle.entregas)}%)</li>
              <li>Primera entrega: {fmtFechaHora(detalle.primera)}</li>
              <li>Última entrega: {fmtFechaHora(detalle.ultima)}</li>
              <li>
                Promedio por entrega:{' '}
                <strong>{fmtCantidad(detalle.entregas > 0 ? detalle.galones / detalle.entregas : 0, 'galón')} gal</strong>
              </li>
            </ul>
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
