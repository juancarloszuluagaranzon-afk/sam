import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { fmtCantidad } from '../lib/cantidad'
import {
  loadConsumo, loadHectareasPorRango, loadHorasDelMes, loadHorasPorRangoMes, loadReferencias,
  type ConsumoFila, type ReferenciaEquipo,
} from '../services/consumoApi'
import {
  anularComentarioCombustible, crearComentarioCombustible, loadComentariosCombustible,
  loadSemaforos, loadTanqueos, loadTanqueosPrevios, type ComentarioCombustible,
} from '../services/samApi'
import { consumoTanqueATanque, diasDelRango, type ConsumoTanques } from '../lib/consumoHora'
import { NIVEL, describirRango, nivelDe, rangoDe, type RangoSemaforo } from '../lib/semaforo'
import { GraficaGalHora, type ColumnaGalHora } from './GraficaGalHora'
import { fmtFechaHora } from '../lib/fechas'
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
  /** Hectáreas realizadas por máquina en el periodo (solo labores en ha). */
  const [hectareas, setHectareas] = useState<Map<string, number>>(new Map())
  /** Las máquinas cuya serie de horómetros se desplomó y hubo que sumar tramos. */
  const [sinRango, setSinRango] = useState<string[]>([])
  /** Horómetro inicial y final del mes de cada máquina (para la gráfica). */
  const [extremos, setExtremos] = useState<Map<string, { inicial: number; final: number }>>(new Map())
  const [cargando, setCargando] = useState(true)
  /** Consumo TANQUE A TANQUE del periodo por máquina (ver `lib/consumoHora`). */
  const [tanques, setTanques] = useState<Map<string, ConsumoTanques>>(new Map())
  /** La máquina cuyos tanqueos se están mirando (al tocar su barra). */
  const [verMaq, setVerMaq] = useState<string | null>(null)
  /** Comentarios a los tanqueos del periodo (los anota Diego, 7-oct-2026). */
  const [comentarios, setComentarios] = useState<ComentarioCombustible[]>([])
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
      loadHectareasPorRango(desde, hasta).then((h) => { if (vivo) setHectareas(h) }).catch(() => { /* sin área */ })
      // El primer tanqueo del periodo se mide contra el último del periodo anterior.
      loadComentariosCombustible(desde, hasta).then((c) => { if (vivo) setComentarios(c) }).catch(() => { /* sin comentarios */ })
      Promise.all([loadTanqueos(desde, hasta), loadTanqueosPrevios(desde)])
        .then(([tq, prev]) => { if (vivo) setTanques(consumoTanqueATanque(tq, diasDelRango(desde, hasta), prev)) })
        .catch(() => { if (vivo) setTanques(new Map()) })
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
      // 🔴 TANQUE A TANQUE (7-oct-2026, regla de Iván): si la máquina tiene
      // tanqueos en la app, el gasto y las horas salen de ellos — galones de los
      // tanqueos del periodo, contra el horómetro del último menos el del último
      // tanqueo del periodo ANTERIOR. Sin tanqueo anterior no hay medida (se mide con el
      // siguiente). Lo de antes (cierre mensual / horómetros del mes) queda solo
      // para los meses del formato en papel, que no tienen tanqueos.
      const tq = tanques.get(codigo)
      const porTanque = tq != null
      const cargado = v.gal
      if (porTanque) v = { ...v, gal: tq.gastado ?? 0 }
      const h = porTanque ? (tq.horas ?? 0) : (horas.get(codigo) ?? 0)
      const galHora = porTanque ? tq.galPorHora : h > 0 ? Math.round((v.gal / h) * 100) / 100 : null
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
      // Tanque a tanque las horas y los galones son del MISMO tramo: no pueden
      // quedar «incompletas» una respecto de la otra.
      const horasIncompletas = !porTanque && horasImplicitas != null && h > 0 && h < horasImplicitas * 0.6
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
        // Lo que de verdad produjo la máquina en el periodo. Sin esto, «gastó
        // 358 galones» no dice si fue mucho o poco: 358 en 40 ha y 358 en 12 no
        // son el mismo negocio.
        ha: Math.round((hectareas.get(codigo) ?? 0) * 100) / 100,
        gal: Math.round(v.gal * 10) / 10,
        gan: Math.round(v.gan),
        horas: Math.round(h * 10) / 10,
        horasEsperadas: horasImplicitas == null ? null : Math.round(horasImplicitas),
        horasIncompletas,
        galHora, ref, desv,
        ganHora, refGan, desvGan,
        inicial: porTanque ? tq.inicial?.horometro ?? null : extremos.get(codigo)?.inicial ?? null,
        final: porTanque ? tq.final?.horometro ?? null : extremos.get(codigo)?.final ?? null,
        cargado: Math.round(cargado * 10) / 10,
        porTanque,
        problemaTanque: porTanque ? tq.problema : null,
        usaGanchos: refGan != null,
      }
    }).sort((a, b) => b.gal - a.gal)
  }, [delMes, horas, refDe, equipoNombre, extremos, hectareas, tanques])

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
        'Máquina': m.nombre, 'Combustible gastado (gal)': m.gal, 'Combustible cargado (gal)': m.cargado,
        'Cálculo': m.porTanque ? (m.problemaTanque ?? 'tanque a tanque') : 'cierre / horómetros del mes',
        'Ganchos': m.gan, 'Ha realizadas': m.ha || '',
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
              <span className="kpi__l">{porMaquina.some((m) => m.porTanque) ? 'galones gastados' : 'galones'}</span></div>
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
                porSuma: !m.porTanque && sinRango.includes(m.codigo),
                marca: (() => { const n = comentarios.filter((c) => c.maquina === m.codigo).length; return n ? `💬 ${n}` : undefined })(),
                rango, nivel: m.horasIncompletas ? null : nivelDe(m.galHora, rango),
              }
            })}
            onVer={(codigo) => setVerMaq(codigo)}
          />
          {tanques.size > 0 && (
            <p className="field-hint" style={{ marginTop: 4 }}>
              Consumo entre tanqueos: cada tanqueo repone lo gastado desde el anterior. Se cuentan los
              galones de los tanqueos del periodo contra las horas desde el último tanqueo del periodo
              anterior hasta el último de este. Toca una máquina para ver cada tanqueo, su eficiencia y
              dejar comentarios.
            </p>
          )}
          {verMaq && (
            <TanqueosMaquina
              nombre={equipoNombre.get(verMaq) ?? verMaq}
              tq={tanques.get(verMaq) ?? null}
              rango={rangoDe(rangos, 'gal_hora', equipoNombre.get(verMaq) ?? verMaq)}
              periodo={etiquetaPeriodo}
              comentarios={comentarios.filter((c) => c.maquina === verMaq)}
              onComentarios={(cambio) => setComentarios(cambio)}
              onClose={() => setVerMaq(null)}
            />
          )}

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
              <span>Máquina</span><span>{esGan ? 'Ganchos' : 'Galones'}</span>
              <span className="cons-col-ha">Ha realizadas</span><span>Horas</span>
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
                    <small>
                      {!esGan && m.gan > 0 ? `${fmtCantidad(m.gan, 'unidad')} ganchos` : ''}
                      {esGan && m.gal > 0 ? `${fmtCantidad(m.gal, 'galón')} gal` : ''}
                      {/* En celular la columna de hectáreas no cabe: va aquí. */}
                      {m.ha > 0 && <span className="cons-ha-corto">{(!esGan && m.gan > 0) || (esGan && m.gal > 0) ? ' · ' : ''}{fmtN(m.ha)} ha</span>}
                    </small>
                  </span>
                  <span>{(esGan ? m.gan : m.gal).toLocaleString('es-CO')}</span>
                  <span className="cons-col-ha">{m.ha > 0 ? fmtN(m.ha) : '—'}</span>
                  <span>{m.horas || '—'}</span>
                  <span><strong>{porHora ?? '—'}</strong></span>
                  <span className="cons-sem" title={[rango ? describirRango(rango) : '', ref2025].filter(Boolean).join(' · ')}>
                    {/* ⏱ primero: con horas de menos el gal/h sale inflado, y pintarlo
                        de rojo sería acusar a la máquina de lo que falló en el registro. */}
                    {m.horasIncompletas ? <small>⏱ faltan horas (≈{m.horasEsperadas})</small>
                      : porHora == null ? <small title={m.problemaTanque ?? ''}>{m.problemaTanque?.startsWith('un solo') ? '1 tanqueo' : 'sin horas'}</small>
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

/**
 * Los tanqueos de UNA máquina en el periodo filtrado arriba, con la eficiencia de
 * cada tramo (7-oct-2026, pedido del cliente: «al oprimir se abra la gráfica de
 * cada equipo donde se vean cada uno de estos eventos de tanqueos y su eficiencia
 * entre tanqueos en el mes o en la quincena»).
 *
 * Cada columna es un tanqueo: sus galones reponen lo gastado desde el tanqueo
 * anterior, así que su gal/h = galones ÷ (horómetro − horómetro anterior). El
 * PRIMERO se mide contra el último tanqueo del periodo anterior (mes o quincena
 * de antes). Los tanqueos sin horómetro se suman al tramo siguiente que sí lo tenga.
 *
 * COMENTARIOS: al tocar un tanqueo se le puede dejar una nota («ese día el
 * horómetro estaba dañado», «se tanqueó la guadañadora con el mismo vale»…). Se
 * guardan en la base con quién y cuándo; se anulan, no se borran. Lo pidió Iván
 * para Diego, que revisa los datos desfasados.
 */
function TanqueosMaquina({ nombre, tq, rango, periodo, comentarios, onComentarios, onClose }: {
  nombre: string
  tq: ConsumoTanques | null
  rango: RangoSemaforo | null
  periodo: string
  comentarios: ComentarioCombustible[]
  /** Recibe una función que actualiza la lista completa de comentarios del tablero. */
  onComentarios: (cambio: (prev: ComentarioCombustible[]) => ComentarioCombustible[]) => void
  onClose: () => void
}) {
  const { session, setError } = useAppData()
  const [sel, setSel] = useState<number | null>(null)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)

  const tramos = (tq?.tramos ?? []).filter((tr) => !tr.antes)
  const llave = (t: { fuente: string; id?: string }) => `${t.fuente}|${t.id ?? ''}`
  const deTanqueo = (t: { fuente: string; id?: string }) => comentarios.filter((c) => `${c.fuente}|${c.origenId}` === llave(t))

  const columnas: ColumnaGalHora[] = []
  let acumulado = 0
  for (const [i, tr] of tramos.entries()) {
    if (tr.cuenta) acumulado += tr.galones
    let galHora: number | null = null
    let sinGalHora = 'sin horómetro'
    if (tr.horasDesdeAnterior != null && tr.horasDesdeAnterior > 0 && tr.cuenta) {
      galHora = Math.round((acumulado / tr.horasDesdeAnterior) * 100) / 100
    } else if (tr.nota?.startsWith('sin tanqueo anterior')) sinGalHora = 'sin tanqueo anterior'
    else if (tr.nota?.startsWith('antes')) sinGalHora = 'antes del 1.er horómetro'
    else if (tr.horometro != null && tr.horasDesdeAnterior === 0) sinGalHora = 'horómetro igual'
    const n = deTanqueo(tr).length
    columnas.push({
      codigo: String(i),
      nombre: fmtFechaHora(tr.cuando),
      galones: tr.galones,
      horas: tr.horasDesdeAnterior ?? 0,
      galHora,
      inicial: tr.horometroAnterior,
      final: tr.horometro,
      porSuma: false,
      nivel: nivelDe(galHora, rango),
      rango,
      sinGalHora,
      marca: n ? `💬 ${n}` : undefined,
      sel: sel === i,
    })
    if (galHora != null) acumulado = 0
  }
  const partida = (tq?.tramos ?? []).find((tr) => tr.antes)
  const escogido = sel != null ? tramos[sel] : null
  const colEscogida = sel != null ? columnas[sel] : null

  async function guardar() {
    if (!escogido?.id || !texto.trim() || !tq) return
    setGuardando(true)
    try {
      const nuevo = await crearComentarioCombustible({
        maquina: tq.maquina, fuente: escogido.fuente, origenId: escogido.id, tanqueoEn: escogido.cuando,
        comentario: texto, autorId: session?.id, autorNombre: session?.name,
      })
      onComentarios((prev) => [...prev, nuevo])
      setTexto('')
    } catch (e) {
      setError((e as Error).message)
    } finally { setGuardando(false) }
  }
  async function quitar(c: ComentarioCombustible) {
    if (!window.confirm('¿Quitar este comentario? Queda anulado en el historial.')) return
    try {
      await anularComentarioCombustible(c.id, session?.id)
      onComentarios((prev) => prev.filter((x) => x.id !== c.id))
    } catch (e) { setError((e as Error).message) }
  }
  const puedeQuitar = (c: ComentarioCombustible) =>
    c.autorId === session?.id || session?.role === 'owner' || session?.role === 'administracion'

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(920px, calc(100vw - 24px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Tanqueos · {periodo}</p>
            <h3>{nombre}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        {!tq ? (
          <p className="subtle-copy">Sin tanqueos registrados en la app en este periodo.</p>
        ) : (
          <>
            <div className="dash-kpis">
              <div className="dash-kpi"><span className="dash-kpi__val">{tq.gastado != null ? fmtN(tq.gastado) : '—'}</span><span className="dash-kpi__lbl">galones gastados</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{tq.horas != null ? fmtN(tq.horas) : '—'}</span><span className="dash-kpi__lbl">horas entre tanqueos</span></div>
              <div className="dash-kpi">
                <span className="dash-kpi__val">{tq.galPorHora != null ? fmtN(tq.galPorHora) : '—'}</span>
                <span className="dash-kpi__lbl">gal/h del periodo{rango ? ` · rango ${describirRango(rango)}` : ''}</span>
              </div>
              <div className="dash-kpi"><span className="dash-kpi__val">{fmtN(tq.cargado)}</span><span className="dash-kpi__lbl">galones cargados</span></div>
            </div>
            {tq.problema && <p className="mov-alerta">⚠ {tq.problema}.</p>}
            <GraficaGalHora
              columnas={columnas}
              titulo="Cada tanqueo y su eficiencia desde el anterior · toca uno para comentarlo"
              rotuloColumna="Tanqueo"
              onVer={(codigo) => { setSel(Number(codigo)); setTexto('') }}
            />
            <p className="field-hint">
              Cada tanqueo repone lo gastado desde el anterior: su gal/h = galones ÷ horas entre los dos horómetros.
              {partida
                ? <> El primero se mide contra el último tanqueo del periodo anterior ({fmtFechaHora(partida.cuando)}, horómetro {partida.horometro != null ? fmtN(partida.horometro) : '—'}).</>
                : <> Esta máquina no tiene tanqueos antes del periodo: el primero es el punto de partida.</>}
            </p>

            <div className="tq-coment">
              <p className="eyebrow" style={{ margin: 0 }}>Comentarios</p>
              {escogido && colEscogida ? (
                <>
                  <p style={{ margin: '6px 0' }}>
                    <strong>{fmtFechaHora(escogido.cuando)}</strong> · {fmtN(escogido.galones)} gal
                    {colEscogida.galHora != null ? ` · ${fmtN(colEscogida.galHora)} gal/h` : ''}
                    {escogido.horometro != null ? ` · horómetro ${fmtN(escogido.horometro)}` : ''}
                    {escogido.detalle ? ` · ${escogido.detalle}` : ''}
                  </p>
                  {deTanqueo(escogido).map((c) => (
                    <div key={c.id} className="tq-coment__item">
                      {c.comentario}
                      <small>
                        {c.autorNombre ?? c.autorId ?? '—'} · {fmtFechaHora(c.createdAt)}
                        {puedeQuitar(c) && <> · <button type="button" className="inline-button" style={{ padding: '0 6px' }} onClick={() => void quitar(c)}>Quitar</button></>}
                      </small>
                    </div>
                  ))}
                  {escogido.id ? (
                    <>
                      <textarea className="base-input" placeholder="¿Qué se ve desfasado en este tanqueo? Queda guardado con tu nombre."
                        value={texto} onChange={(e) => setTexto(e.target.value)} disabled={guardando} maxLength={1000} />
                      <div className="modal-footer" style={{ marginTop: 6 }}>
                        <button type="button" className="inline-button" onClick={() => setSel(null)} disabled={guardando}>Cerrar comentario</button>
                        <button type="button" className="primary-button" onClick={() => void guardar()} disabled={guardando || !texto.trim()}>
                          {guardando ? 'Guardando…' : 'Guardar comentario'}
                        </button>
                      </div>
                    </>
                  ) : <p className="field-hint">Este tanqueo no se puede comentar (sin identificador).</p>}
                </>
              ) : comentarios.length > 0 ? (
                comentarios.map((c) => (
                  <div key={c.id} className="tq-coment__item">
                    <strong>{c.tanqueoEn ? fmtFechaHora(c.tanqueoEn) : ''}</strong> · {c.comentario}
                    <small>{c.autorNombre ?? c.autorId ?? '—'} · {fmtFechaHora(c.createdAt)}</small>
                  </div>
                ))
              ) : (
                <p className="field-hint">Toca un tanqueo de la gráfica para dejarle un comentario.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
