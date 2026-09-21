import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { fmtCantidad } from '../lib/cantidad'
import {
  loadConsumo, loadHorasDelMes, loadHorasPorRangoMes, loadReferencias,
  type ConsumoFila, type ReferenciaEquipo,
} from '../services/consumoApi'
import { loadSemaforos } from '../services/samApi'
import { NIVEL, describirRango, nivelDe, rangoDe, type RangoSemaforo } from '../lib/semaforo'
import { GraficaGalHora } from './GraficaGalHora'
import { PERIODOS, rangoDe as rangoDePeriodo, hoyBogota, type Periodo } from '../lib/periodos'

/**
 * Tablero de consumo para el dueño.
 *
 * Une el formato en papel (mar–jul 2026) con lo que registra la app (agosto en
 * adelante), y marca de dónde salió cada mes. Sin el histórico, el tablero
 * arranca en agosto y no hay contra qué comparar: 1.376 galones no dicen nada si
 * no se sabe que julio fueron 9.252.
 *
 * El número que de verdad se mira es **galones por hora**, no galones: una
 * máquina que gasta más porque trabajó más no es un problema. Y se compara
 * contra el rango de ESA máquina, no contra el promedio de la flota: un tractor
 * de 90 HP y uno de 241 no son comparables.
 *
 * 🔴 Desde el 21-sep-2026 la columna de comparación es el SEMÁFORO del cliente
 * (tabla `semaforo_consumo`, la misma de «Combustible por hora de máquina» en
 * Insumos y materiales): ✓ dentro · ▲ medio · ⚠ alto · ▽ debajo del rango. Lo pidió
 * con captura: «esto también hazlo con la misma lógica de semáforos». Antes era un
 * «▼20% de 5,27» contra la referencia 2025 del Excel de maquinaria — esa referencia
 * sigue en el Excel y al pasar el dedo por el semáforo, pero ya no decide el color.
 */

const MES_NOMBRE = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function etiquetaMes(mes: string): string {
  const [a, m] = mes.split('-')
  return `${MES_NOMBRE[Number(m) - 1] ?? m} ${a.slice(2)}`
}

/**
 * El rango de un periodo. «Hoy» y «Ayer» son fechas reales; las quincenas y el
 * mes son del MES ELEGIDO en las barras de arriba (así «1ra quinc.» de agosto se
 * puede mirar sin salir de la pantalla). El final nunca pasa de hoy.
 */
function rangoPeriodo(p: Periodo, mes: string): { desde: string; hasta: string } {
  const hoy = hoyBogota()
  const r = p === 'HOY' || p === 'AYER' ? rangoDePeriodo(p, hoy) : rangoDePeriodo(p, `${mes}-15`)
  return { desde: r.desde, hasta: r.hasta > hoy ? hoy : r.hasta }
}

function fmtDia(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MES_NOMBRE[Number(m) - 1] ?? m}`
}

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtN = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })

/** La columna es angosta en celular: la palabra corta; la larga va en el Excel. */
const CORTO = { bajo: 'debajo', verde: 'dentro', naranja: 'medio', rojo: 'alto' } as const

/** Para el Excel: «▲ medio (✓ 1,2 a 1,5 · ▲ hasta 1,7 · ⚠ más de 1,7)». */
function textoSemaforo(valor: number | null, rango: RangoSemaforo | null, horasIncompletas: boolean): string {
  if (horasIncompletas) return 'faltan horas'
  if (valor == null) return 'sin horas'
  if (!rango) return 'sin rango'
  const n = nivelDe(valor, rango)
  return n ? `${NIVEL[n].icono} ${NIVEL[n].texto} (${describirRango(rango)})` : ''
}

export function ConsumoDashboardTab() {
  const { sortedEquipment, busy, setBusy, setError, setInfo } = useAppData()

  const [filas, setFilas] = useState<ConsumoFila[]>([])
  const [refs, setRefs] = useState<ReferenciaEquipo[]>([])
  const [horas, setHoras] = useState<Map<string, number>>(new Map())
  /** Las máquinas cuya serie de horómetros se desplomó y hubo que sumar tramos. */
  const [sinRango, setSinRango] = useState<string[]>([])
  /** Horómetro inicial y final del mes de cada máquina (para la gráfica). */
  const [extremos, setExtremos] = useState<Map<string, { inicial: number; final: number }>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [mesSel, setMesSel] = useState<string>('')
  // Filtros de periodo — los MISMOS de Operación general e Insumos y materiales
  // (lib/periodos). Pedido del cliente con captura (21-sep-2026): «ponle estos
  // filtros». Las cifras, la gráfica y la tabla de abajo siguen al periodo.
  const [periodo, setPeriodo] = useState<Periodo>('MES')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  function aplicarPeriodo(p: Periodo, mes = mesSel) {
    setPeriodo(p)
    if (p === 'RANGO') return // deja las fechas que haya y muestra los dos campos
    const r = rangoPeriodo(p, mes)
    setDesde(r.desde)
    setHasta(r.hasta)
    // «Hoy» y «Ayer» pueden caer en otro mes: la barra elegida lo acompaña.
    if (r.desde.slice(0, 7) !== mes) setMesSel(r.desde.slice(0, 7))
  }
  // Combustible o ganchos. Un selector y no dos columnas más: la tabla ya tiene
  // cinco y en celular no cabe una sexta sin volverse ilegible.
  // Abre en GANCHOS: lo pidió el cliente (21-sep-2026, «déjalo predeterminado en
  // ganchos»). El combustible ya se ve arriba, en la gráfica de galones y gal/h.
  const [medida, setMedida] = useState<'COMBUSTIBLE' | 'GANCHOS'>('GANCHOS')
  // Rangos del semáforo (los ajusta el cliente en la base, sin publicar versión).
  // Si no cargan, la columna dice «sin rango»: nunca se inventa un verde.
  const [rangos, setRangos] = useState<RangoSemaforo[]>([])
  useEffect(() => {
    let vivo = true
    loadSemaforos().then((r) => { if (vivo) setRangos(r) }).catch(() => { /* sin semáforo */ })
    return () => { vivo = false }
  }, [])

  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])
  const refDe = useMemo(() => {
    const m = new Map<string, ReferenciaEquipo>()
    refs.forEach((r) => m.set(r.equipoCodigo, r))
    return m
  }, [refs])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [c, r] = await Promise.all([loadConsumo(), loadReferencias(2025)])
      setFilas(c)
      setRefs(r)
    } finally { setCargando(false) }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  /** Serie mensual: una barra por mes, con la fuente de la que salió. */
  const meses = useMemo(() => {
    const m = new Map<string, { gal: number; gan: number; fuente: Set<string>; movs: number }>()
    for (const f of filas) {
      const k = f.fecha.slice(0, 7)
      const e = m.get(k) ?? { gal: 0, gan: 0, fuente: new Set<string>(), movs: 0 }
      if (f.insumo === 'COMBUSTIBLE') e.gal += f.cantidad
      else if (f.insumo === 'GANCHOS') e.gan += f.cantidad
      e.fuente.add(f.fuente)
      e.movs += 1
      m.set(k, e)
    }
    return [...m.entries()]
      .map(([mes, v]) => ({ mes, ...v, gal: Math.round(v.gal * 10) / 10, gan: Math.round(v.gan) }))
      .sort((a, b) => a.mes.localeCompare(b.mes))
  }, [filas])

  // Por defecto, el último mes con datos.
  useEffect(() => {
    if (!mesSel && meses.length) {
      const ultimo = meses[meses.length - 1].mes
      setMesSel(ultimo)
      const r = rangoPeriodo('MES', ultimo)
      setDesde(r.desde)
      setHasta(r.hasta)
    }
  }, [meses, mesSel])

  // Las horas del periodo elegido, para el galones/hora.
  useEffect(() => {
    if (!desde || !hasta || desde > hasta) return
    // El cierre mensual solo aplica cuando se mira el MES entero.
    const mesEntero = periodo === 'MES' ? mesSel : null
    let vivo = true
    // 🔴 El cierre mensual manda — es el dato que administracion firma. Si el
    // mes no lo tiene, las horas salen del HOROMETRO INICIAL Y FINAL DEL MES,
    // que es el mismo criterio con el que se hace ese cierre a mano.
    //
    // Antes se sumaban los tramos de `labor_sesiones`, que solo cuenta las horas
    // que quedaron dentro de una labor cerrada. Medido contra el cierre de julio
    // (el unico mes que lo tiene): el rango acierta 13 de 20 maquinas dentro del
    // 10% contra 9, y varias exactas.
    void (async () => {
      const [cierre, r] = await Promise.all([
        mesEntero ? loadHorasDelMes(mesEntero) : Promise.resolve(new Map<string, number>()),
        // Aunque el mes tenga cierre, las lecturas dan el horómetro inicial y final.
        loadHorasPorRangoMes(desde, hasta > hoyISO() ? hoyISO() : hasta),
      ])
      if (!vivo) return
      setExtremos(r.extremos)
      if (cierre.size > 0) { setHoras(cierre); setSinRango([]); return }
      setHoras(r.horas); setSinRango(r.cayeronASuma)
    })()
    return () => { vivo = false }
  }, [desde, hasta, periodo, mesSel])

  const delMes = useMemo(
    () => filas.filter((f) => { const d = f.fecha.slice(0, 10); return d >= desde && d <= hasta }),
    [filas, desde, hasta],
  )
  const etiquetaPeriodo = periodo === 'HOY' ? `Hoy · ${fmtDia(desde)}`
    : periodo === 'AYER' ? `Ayer · ${fmtDia(desde)}`
    : periodo === 'PRIMERA' ? `1ra quinc. · ${etiquetaMes(mesSel)}`
    : periodo === 'SEGUNDA' ? `2da quinc. · ${etiquetaMes(mesSel)}`
    : periodo === 'RANGO' ? `${fmtDia(desde)} a ${fmtDia(hasta)}`
    : etiquetaMes(mesSel)

  /** Una fila por máquina: lo que gastó, cuánto trabajó, y cómo va contra su referencia. */
  const porMaquina = useMemo(() => {
    const m = new Map<string, { gal: number; gan: number }>()
    for (const f of delMes) {
      const e = m.get(f.equipoCodigo) ?? { gal: 0, gan: 0 }
      if (f.insumo === 'COMBUSTIBLE') e.gal += f.cantidad
      else if (f.insumo === 'GANCHOS') e.gan += f.cantidad
      m.set(f.equipoCodigo, e)
    }
    return [...m.entries()].map(([codigo, v]) => {
      const h = horas.get(codigo) ?? 0
      const galHora = h > 0 ? Math.round((v.gal / h) * 100) / 100 : null
      const ref = refDe.get(codigo)?.galHora ?? null

      // ⚠️ Antes de acusar a la máquina, revisar el denominador.
      //
      // Si gastó 210 galones y su referencia es 5,27 gal/h, entonces trabajó
      // unas 40 horas. Si solo hay 19,5 capturadas, lo que falla son las HORAS,
      // no el consumo — y mostrar "▲104%" ahí es acusar a un tractor de gastar
      // el doble cuando lo que pasó es que nadie cerró bien las labores.
      //
      // Sin esto el tablero marcaba 12 de 21 máquinas en rojo, y una alerta que
      // suena doce veces no la lee nadie.
      const horasImplicitas = ref != null && ref > 0 ? v.gal / ref : null
      const horasIncompletas = horasImplicitas != null && h > 0 && h < horasImplicitas * 0.6
      const desv = galHora != null && ref != null && ref > 0 && !horasIncompletas
        ? Math.round(((galHora - ref) / ref) * 100) : null

      // Ganchos. `refGan` en null NO es dato faltante: los PUMA no usan ganchos.
      const refGan = refDe.get(codigo)?.ganchosHora ?? null
      const ganHora = h > 0 && v.gan > 0 ? Math.round((v.gan / h) * 100) / 100 : null
      const desvGan = ganHora != null && refGan != null && refGan > 0 && !horasIncompletas
        ? Math.round(((ganHora - refGan) / refGan) * 100) : null

      return {
        codigo,
        nombre: equipoNombre.get(codigo) ?? codigo,
        gal: Math.round(v.gal * 10) / 10,
        gan: Math.round(v.gan),
        horas: Math.round(h * 10) / 10,
        horasEsperadas: horasImplicitas == null ? null : Math.round(horasImplicitas),
        horasIncompletas,
        galHora, ref, desv,
        ganHora, refGan, desvGan,
        inicial: extremos.get(codigo)?.inicial ?? null,
        final: extremos.get(codigo)?.final ?? null,
        usaGanchos: refGan != null,
      }
    }).sort((a, b) => b.gal - a.gal)
  }, [delMes, horas, refDe, equipoNombre, extremos])

  // En ganchos solo se listan las que los usan: mostrar un PUMA con "—" en todo
  // hace pensar que falta un dato, cuando lo que pasa es que no lleva ganchos.
  const visibles = useMemo(
    () => (medida === 'COMBUSTIBLE'
      ? porMaquina
      : porMaquina.filter((m) => m.gan > 0).sort((a, b) => b.gan - a.gan)),
    [porMaquina, medida],
  )
  const esGan = medida === 'GANCHOS'

  const totalGal = porMaquina.reduce((t, m) => t + m.gal, 0)
  const totalGan = porMaquina.reduce((t, m) => t + m.gan, 0)
  const totalHoras = porMaquina.reduce((t, m) => t + m.horas, 0)
  const galHoraFlota = totalHoras > 0 ? Math.round((totalGal / totalHoras) * 100) / 100 : null
  const maxGal = Math.max(1, ...meses.map((m) => m.gal))
  const fuenteMes = meses.find((m) => m.mes === mesSel)?.fuente
  // Sin banners de alerta: saturaban la pantalla. La señal sigue estando donde
  // sirve —en la fila de cada máquina, junto a su número— que es donde el dueño
  // ya está mirando cuando le interesa el detalle.

  async function exportar() {
    setBusy(true); setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const wb = utils.book_new()
      utils.book_append_sheet(wb, utils.json_to_sheet(meses.map((m) => ({
        'Mes': etiquetaMes(m.mes), 'Combustible(gal)': m.gal, 'Ganchos': m.gan,
        'Movimientos': m.movs, 'Fuente': [...m.fuente].join(' + '),
      }))), 'Por mes')
      utils.book_append_sheet(wb, utils.json_to_sheet(porMaquina.map((m) => ({
        'Máquina': m.nombre, 'Combustible(gal)': m.gal, 'Ganchos': m.gan,
        'Horómetro inicial': m.inicial ?? '', 'Horómetro final': m.final ?? '',
        'Horas': m.horas || '',
        'Gal/hora': m.galHora ?? '', 'Ref. gal/h 2025': m.ref ?? '', 'Desv. gal %': m.desv ?? '',
        'Semáforo gal/h': textoSemaforo(m.galHora, rangoDe(rangos, 'gal_hora', m.nombre), m.horasIncompletas),
        'Gan/hora': m.ganHora ?? '', 'Ref. gan/h 2025': m.refGan ?? '',
        'Desv. ganchos %': m.desvGan ?? '',
        'Semáforo ganchos/h': m.gan > 0 ? textoSemaforo(m.ganHora, rangoDe(rangos, 'ganchos_hora', m.nombre), m.horasIncompletas) : '',
      }))), 'Máquinas')
      writeFile(wb, `consumo-${desde}-a-${hasta}.xlsx`)
      setInfo('Tablero descargado.')
    } catch { setError('No se pudo generar el Excel.') } finally { setBusy(false) }
  }

  return (
    <section className="panel">
      <div className="panel-title split">
        <h2>⛽ Consumo por máquina</h2>
        <button type="button" className="inline-button" onClick={() => void cargar()} disabled={cargando}>
          ↻ Actualizar
        </button>
      </div>
      <Ayuda>
        <p>
          La historia completa: hasta julio sale del formato que se llevaba en papel,
          y desde agosto de lo que registra la app. Cada mes dice de dónde viene.
        </p>
        <p>
          El número que importa no es cuántos galones gastó una máquina —la que más
          trabaja gasta más— sino <strong>cuántos galones por hora</strong>, comparado
          contra su propia referencia de 2025.
        </p>
      </Ayuda>

      {cargando ? <p className="muted-text">Cargando…</p> : (
        <>
          {/* ── La serie: de dónde venimos ─────────────────────────────────── */}
          <p className="ins-res__lbl" style={{ marginTop: 14 }}>Combustible por mes</p>
          <div className="cons-serie">
            {meses.map((m) => (
              <button key={m.mes} type="button"
                      className={`cons-mes${m.mes === mesSel ? ' is-sel' : ''}`}
                      onClick={() => { setMesSel(m.mes); aplicarPeriodo('MES', m.mes) }}>
                <span className="cons-mes__barra">
                  <span className="cons-mes__fill" style={{ height: `${(m.gal / maxGal) * 100}%` }} />
                </span>
                <strong>{m.gal.toLocaleString('es-CO')}</strong>
                <small>{etiquetaMes(m.mes)}</small>
                <em className={m.fuente.has('papel') ? 'cons-f cons-f--papel' : 'cons-f cons-f--app'}>
                  {m.fuente.has('papel') ? 'papel' : 'app'}
                </em>
              </button>
            ))}
          </div>

          {/* ── El mes elegido ─────────────────────────────────────────────── */}
          <div className="panel-title split" style={{ marginTop: 20 }}>
            <h3 style={{ margin: 0 }}>{etiquetaPeriodo}</h3>
            <button type="button" className="primary-button" onClick={() => void exportar()} disabled={busy}>
              ⬇ Excel
            </button>
          </div>

          <div className="mov-periodo">
            {PERIODOS.map((p) => (
              <button key={p.value} type="button" aria-pressed={periodo === p.value}
                      onClick={() => aplicarPeriodo(p.value)}>
                {p.label}
              </button>
            ))}
            {periodo === 'RANGO' && (
              <div className="mov-periodo__rango">
                <label>Desde
                  <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
                </label>
                <label>Hasta
                  <input type="date" value={hasta} min={desde} max={hoyBogota()} onChange={(e) => setHasta(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          <div className="mural-kpi">
            <div className="kpi"><span className="kpi__n">{totalGal.toLocaleString('es-CO')}</span>
              <span className="kpi__l">galones</span></div>
            <div className="kpi"><span className="kpi__n">{totalGan.toLocaleString('es-CO')}</span>
              <span className="kpi__l">ganchos</span></div>
            <div className="kpi"><span className="kpi__n">{porMaquina.length}</span>
              <span className="kpi__l">máquinas</span></div>
            <div className={`kpi${galHoraFlota == null ? ' kpi--vacio' : ''}`}>
              <span className="kpi__n">{galHoraFlota ?? '—'}</span>
              <span className="kpi__l">galones por hora</span></div>
          </div>

          {/* La gráfica que dibujó el cliente: barra = galones, encima gal/h con
              su semáforo, y debajo máquina · horómetro inicial · final · horas. */}
          <GraficaGalHora
            columnas={porMaquina.map((m) => {
              const rango = rangoDe(rangos, 'gal_hora', m.nombre)
              return {
                codigo: m.codigo, nombre: m.nombre, galones: m.gal, horas: m.horas,
                galHora: m.horasIncompletas ? null : m.galHora,
                inicial: m.inicial, final: m.final,
                porSuma: sinRango.includes(m.codigo),
                rango, nivel: m.horasIncompletas ? null : nivelDe(m.galHora, rango),
              }
            })}
          />

          {/* Las notas de de dónde salen las horas y de las máquinas con el horómetro
              sucio se QUITARON a pedido del cliente (21-sep-2026, «quita estos
              comentarios»). Lo sucio sigue marcado donde se mira: «Σ» en la casilla de
              horas de la gráfica, con la explicación al pasar el dedo. */}
          {fuenteMes?.has('papel') && (
            <p className="subtle-copy" style={{ marginTop: 4 }}>
              📄 Este mes viene del formato en papel. Las horas trabajadas salen de las
              labores del sistema, así que el galones/hora puede quedar incompleto.
            </p>
          )}

          {/* ── Máquina por máquina ────────────────────────────────────────── */}
          <div className="panel-title split" style={{ marginTop: 16, marginBottom: 0 }}>
            <p className="ins-res__lbl" style={{ margin: 0 }}>Máquina por máquina</p>
            <div className="cons-toggle">
              <button type="button" className={!esGan ? 'is-sel' : ''}
                      onClick={() => setMedida('COMBUSTIBLE')}>⛽ Combustible</button>
              <button type="button" className={esGan ? 'is-sel' : ''}
                      onClick={() => setMedida('GANCHOS')}>🪝 Ganchos</button>
            </div>
          </div>

          {esGan && (
            <p className="subtle-copy" style={{ marginTop: 6 }}>
              Solo las {visibles.length} máquinas que usan ganchos — los PUMA no llevan.
              Ojo: los ganchos se entregan por paquetes de 40, así que en pocos días el
              promedio salta; en un mes completo se estabiliza.
            </p>
          )}

          <div className="cons-tabla">
            <div className="cons-fila cons-fila--cab">
              <span>Máquina</span><span>{esGan ? 'Ganchos' : 'Galones'}</span><span>Horas</span>
              <span>{esGan ? 'Gan/hora' : 'Gal/hora'}</span><span>Semáforo</span>
            </div>
            {visibles.map((m) => {
              const porHora = esGan ? m.ganHora : m.galHora
              const referencia = esGan ? m.refGan : m.ref
              const desviacion = esGan ? m.desvGan : m.desv
              const rango = rangoDe(rangos, esGan ? 'ganchos_hora' : 'gal_hora', m.nombre)
              const nivel = m.horasIncompletas ? null : nivelDe(porHora, rango)
              // La referencia 2025 no se pierde: queda al pasar el dedo y en el Excel.
              const ref2025 = referencia == null ? '' : desviacion == null
                ? `Referencia 2025: ${referencia}`
                : `Referencia 2025: ${referencia} (${desviacion > 0 ? '▲' : '▼'}${Math.abs(desviacion)}%)`
              return (
                <div key={m.codigo} className="cons-fila">
                  <span className="cons-fila__maq">
                    🚜 {m.nombre}
                    {!esGan && m.gan > 0 && <small>{fmtCantidad(m.gan, 'unidad')} ganchos</small>}
                    {esGan && m.gal > 0 && <small>{fmtCantidad(m.gal, 'galón')} gal</small>}
                  </span>
                  <span>{(esGan ? m.gan : m.gal).toLocaleString('es-CO')}</span>
                  <span>{m.horas || '—'}</span>
                  <span><strong>{porHora ?? '—'}</strong></span>
                  <span className="cons-sem" title={[rango ? describirRango(rango) : '', ref2025].filter(Boolean).join(' · ')}>
                    {/* ⏱ primero: con horas de menos el gal/h sale inflado, y pintarlo
                        de rojo sería acusar a la máquina de lo que falló en el registro. */}
                    {m.horasIncompletas ? <small>⏱ faltan horas (≈{m.horasEsperadas})</small>
                      : porHora == null ? <small>sin horas</small>
                      : !rango ? <small>sin rango</small>
                      : nivel && (
                        <>
                          <span className={`dash-galh dash-galh--${nivel}`}>{NIVEL[nivel].icono} {CORTO[nivel]}</span>
                          <small className="cons-sem__largo">{describirRango(rango)}</small>
                          {/* En celular solo la franja verde: el rango entero partía la fila en tres renglones. */}
                          <small className="cons-sem__corto">✓ {rango.verdeMin != null ? `${fmtN(rango.verdeMin)}–` : 'hasta '}{fmtN(rango.verdeMax)}</small>
                        </>
                      )}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

export default ConsumoDashboardTab
