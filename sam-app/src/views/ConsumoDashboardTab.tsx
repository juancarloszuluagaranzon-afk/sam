import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { fmtCantidad } from '../lib/cantidad'
import {
  loadConsumo, loadHorasDelMes, loadHorasPorEquipo, loadReferencias,
  type ConsumoFila, type ReferenciaEquipo,
} from '../services/consumoApi'

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
 * contra la referencia 2025 de ESA máquina —del Excel de maquinaria—, no contra
 * el promedio de la flota: un tractor de 90 HP y uno de 241 no son comparables.
 */

const MES_NOMBRE = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function etiquetaMes(mes: string): string {
  const [a, m] = mes.split('-')
  return `${MES_NOMBRE[Number(m) - 1] ?? m} ${a.slice(2)}`
}

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ConsumoDashboardTab() {
  const { sortedEquipment, busy, setBusy, setError, setInfo } = useAppData()

  const [filas, setFilas] = useState<ConsumoFila[]>([])
  const [refs, setRefs] = useState<ReferenciaEquipo[]>([])
  const [horas, setHoras] = useState<Map<string, number>>(new Map())
  /** De dónde salieron las horas: el cierre del mes o la suma de sesiones. */
  const [fuenteHoras, setFuenteHoras] = useState<'cierre' | 'sesiones'>('sesiones')
  const [cargando, setCargando] = useState(true)
  const [mesSel, setMesSel] = useState<string>('')
  // Combustible o ganchos. Un selector y no dos columnas más: la tabla ya tiene
  // cinco y en celular no cabe una sexta sin volverse ilegible.
  const [medida, setMedida] = useState<'COMBUSTIBLE' | 'GANCHOS'>('COMBUSTIBLE')

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
    if (!mesSel && meses.length) setMesSel(meses[meses.length - 1].mes)
  }, [meses, mesSel])

  // Las horas del mes elegido, para el galones/hora.
  useEffect(() => {
    if (!mesSel) return
    const [a, m] = mesSel.split('-').map(Number)
    const desde = `${mesSel}-01`
    const hasta = new Date(a, m, 0).toISOString().slice(0, 10)
    let vivo = true
    // El cierre mensual manda; las sesiones son el respaldo. Sumar tramos de
    // `labor_sesiones` mete las horas sucias (445 de 2.212 son absurdas) y con
    // el denominador malo el galones/hora sale en cualquier cosa.
    void (async () => {
      const cierre = await loadHorasDelMes(mesSel)
      if (!vivo) return
      if (cierre.size > 0) { setHoras(cierre); setFuenteHoras('cierre'); return }
      const ses = await loadHorasPorEquipo(desde, hasta > hoyISO() ? hoyISO() : hasta)
      if (vivo) { setHoras(ses); setFuenteHoras('sesiones') }
    })()
    return () => { vivo = false }
  }, [mesSel])

  const delMes = useMemo(() => filas.filter((f) => f.fecha.startsWith(mesSel)), [filas, mesSel])

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
        usaGanchos: refGan != null,
      }
    }).sort((a, b) => b.gal - a.gal)
  }, [delMes, horas, refDe, equipoNombre])

  // En ganchos solo se listan las que los usan: mostrar un PUMA con "—" en todo
  // hace pensar que falta un dato, cuando lo que pasa es que no lleva ganchos.
  const visibles = useMemo(
    () => (medida === 'COMBUSTIBLE'
      ? porMaquina
      : porMaquina.filter((m) => m.usaGanchos && m.gan > 0).sort((a, b) => b.gan - a.gan)),
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
        'Horas': m.horas || '',
        'Gal/hora': m.galHora ?? '', 'Ref. gal/h 2025': m.ref ?? '', 'Desv. gal %': m.desv ?? '',
        'Gan/hora': m.ganHora ?? '', 'Ref. gan/h 2025': m.refGan ?? '',
        'Desv. ganchos %': m.desvGan ?? '',
      }))), `Máquinas ${etiquetaMes(mesSel)}`)
      writeFile(wb, `consumo-${mesSel}.xlsx`)
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
                      onClick={() => setMesSel(m.mes)}>
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
            <h3 style={{ margin: 0 }}>{etiquetaMes(mesSel)}</h3>
            <button type="button" className="primary-button" onClick={() => void exportar()} disabled={busy}>
              ⬇ Excel
            </button>
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

          <p className="subtle-copy" style={{ marginTop: 4 }}>
            {fuenteHoras === 'cierre'
              ? '⏱ Las horas salen del cierre mensual de horómetros — el dato bueno.'
              : '⏱ Las horas salen de sumar las labores cerradas. Si el mes ya tiene cierre de horómetros, cárgalo: es más confiable.'}
          </p>
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
              <span>{esGan ? 'Gan/hora' : 'Gal/hora'}</span><span>vs 2025</span>
            </div>
            {visibles.map((m) => {
              const porHora = esGan ? m.ganHora : m.galHora
              const referencia = esGan ? m.refGan : m.ref
              const desviacion = esGan ? m.desvGan : m.desv
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
                  <span className={desviacion == null ? '' : Math.abs(desviacion) >= 20 ? 'cons-mal' : 'cons-bien'}>
                    {referencia == null ? <small>{esGan ? 'no usa ganchos' : 'sin referencia'}</small>
                      : m.horasIncompletas ? <small>⏱ faltan horas (≈{m.horasEsperadas})</small>
                      : desviacion == null ? <small>ref. {referencia}</small>
                      : <>{desviacion > 0 ? '▲' : '▼'}{Math.abs(desviacion)}% <small>de {referencia}</small></>}
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
