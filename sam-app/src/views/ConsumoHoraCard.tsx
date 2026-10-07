import { useEffect, useMemo, useState } from 'react'
import type { InsumoKardex } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'
import { nfGrafico, SERIES } from '../components/Charts'
import { fmtFechaHora } from '../lib/fechas'
import { combustiblePorMaquina, ganchosPorMaquina, type Catalogo } from '../lib/insumosDash'
import { NIVEL, describirRango, nivelDe, rangoDe, type NivelSemaforo, type RangoSemaforo } from '../lib/semaforo'
import {
  consumoTanqueATanque, diasDelRango,
  type ConsumoTanques, type Tanqueo,
} from '../lib/consumoHora'
import { loadSemaforos, loadTanqueos, loadTanqueosPrevios } from '../services/samApi'

/** Una barra: el consumo tanque a tanque de la máquina, con su nombre. */
type FilaConsumoHora = ConsumoTanques & {
  nombre: string
  /** Lo que mide la barra: lo GASTADO; si no se puede medir, lo cargado (en gris). */
  galones: number
  medido: boolean
}

/**
 * Combustible por hora de máquina: una barra por máquina con los galones
 * GASTADOS en el periodo y, al lado, los galones por hora.
 *
 * 🔴 TANQUE A TANQUE (7-oct-2026, regla de Iván): cada tanqueo repone lo gastado
 * desde el anterior. El gastado del periodo son los galones de sus tanqueos menos
 * el primero, y las horas, el horómetro del último tanqueo menos el del primero.
 * VALTRA 9902 del 1 al 3 de octubre: 9 gal en 5,8 h, no los 23 que se cargaron.
 * Ver `consumoTanqueATanque` en `lib/consumoHora`.
 *
 * Usa el filtro de periodo de la pantalla (Hoy, Ayer, Rango…): no trae uno
 * propio. Dos filtros en la misma pantalla es lo que el cliente llamó
 * «saturado».
 */
export function ConsumoHoraCard({
  movs, catalogo, nombreMaq, desde, hasta, unSoloDia,
}: {
  movs: InsumoKardex[]
  catalogo: Catalogo
  nombreMaq: (c: string) => string
  desde: string
  hasta: string
  unSoloDia: boolean
}) {
  const [otras, setOtras] = useState<Tanqueo[] | null>(null)
  /** Tanqueos de antes del periodo: el punto de partida del primero. */
  const [previos, setPrevios] = useState<Tanqueo[]>([])
  const [ver, setVer] = useState<FilaConsumoHora | null>(null)
  // Rangos del semáforo: vienen de la base (el cliente los ajusta). Si no cargan,
  // la gráfica sigue igual que antes, sin colores — nunca inventa un verde.
  const [rangos, setRangos] = useState<RangoSemaforo[]>([])
  useEffect(() => {
    let vivo = true
    loadSemaforos().then((r) => { if (vivo) setRangos(r) }).catch(() => { /* sin semáforo */ })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    let vivo = true
    setOtras(null)
    Promise.all([loadTanqueos(desde, hasta), loadTanqueosPrevios(desde)])
      .then(([l, p]) => { if (vivo) { setOtras(l); setPrevios(p) } })
      .catch(() => { if (vivo) setOtras([]) })
    return () => { vivo = false }
  }, [desde, hasta])

  const filas = useMemo((): FilaConsumoHora[] => {
    // Las máquinas que recibieron combustible en el periodo (las de la torta); el
    // consumo de cada una sale de sus tanqueos.
    const conCombustible = combustiblePorMaquina(movs, catalogo, nombreMaq).map((p) => p.id)
    const tq = consumoTanqueATanque(otras ?? [], diasDelRango(desde, hasta), previos)
    const maquinas = new Set([...conCombustible, ...tq.keys()])
    return [...maquinas].map((maquina) => {
      const c = tq.get(maquina) ?? {
        maquina, gastado: null, cargado: 0, horas: null, galPorHora: null,
        inicial: null, final: null, problema: 'sin tanqueos en el periodo', tramos: [],
      }
      const medido = c.gastado != null
      return { ...c, nombre: nombreMaq(maquina), galones: medido ? c.gastado! : c.cargado, medido }
    }).filter((f) => f.galones > 0 || f.cargado > 0)
      .sort((a, b) => Number(b.medido) - Number(a.medido) || b.galones - a.galones)
  }, [movs, catalogo, nombreMaq, otras, previos, desde, hasta])

  /** Ganchos entregados a cada máquina en el periodo (unidades). */
  const ganchos = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of ganchosPorMaquina(movs, catalogo, nombreMaq)) m.set(p.id, p.valor)
    return m
  }, [movs, catalogo, nombreMaq])

  /** Semáforo de cada máquina: gal/h y ganchos/h, cada uno contra su rango. */
  const semaforo = useMemo(() => {
    const m = new Map<string, {
      gal: NivelSemaforo | null; rangoGal: RangoSemaforo | null
      ganchos: number; ganchosHora: number | null; gch: NivelSemaforo | null; rangoGch: RangoSemaforo | null
    }>()
    for (const f of filas) {
      const rangoGal = rangoDe(rangos, 'gal_hora', f.nombre)
      const g = ganchos.get(f.maquina) ?? 0
      const ganchosHora = g > 0 && f.horas != null && f.horas > 0 ? Math.round((g / f.horas) * 100) / 100 : null
      const rangoGch = g > 0 ? rangoDe(rangos, 'ganchos_hora', f.nombre) : null
      m.set(f.maquina, {
        gal: nivelDe(f.galPorHora, rangoGal), rangoGal,
        ganchos: g, ganchosHora, gch: nivelDe(ganchosHora, rangoGch), rangoGch,
      })
    }
    return m
  }, [filas, rangos, ganchos])
  const cuenta = (n: NivelSemaforo) => [...semaforo.values()].filter((s) => s.gal === n).length

  // Promedio de la flota SOLO con las máquinas que tienen horas: sumar galones
  // de una máquina sin horómetro inflaría el gal/hora de todas.
  const conHoras = filas.filter((f) => f.horas != null && f.horas > 0)
  const galConHoras = conHoras.reduce((s, f) => s + f.galones, 0)
  const horasTot = conHoras.reduce((s, f) => s + (f.horas ?? 0), 0)
  const max = Math.max(...filas.map((f) => f.galones), 0.0001)

  return (
    <div className="dash-card">
      <div className="dash-card__head"><h3>Combustible por hora de máquina</h3></div>
      <Ayuda>
        <p>
          La barra es el combustible <strong>gastado</strong> en el periodo, medido
          <strong> tanque a tanque</strong>: cada tanqueo repone lo que se gastó desde el
          anterior, así que se suman los galones de los tanqueos del periodo.
        </p>
        <p>
          Las horas son el horómetro del <strong>último tanqueo</strong> menos el del último
          tanqueo del <strong>periodo anterior</strong> (el punto de partida). Al tocar una
          máquina se ve cada tanqueo, sus horas y qué no entró en la cuenta.
        </p>
        <p>
          Si la máquina no tiene tanqueo anterior con horómetro, no hay contra qué medir: la
          barra sale en gris con lo cargado.
        </p>
      </Ayuda>

      {filas.length === 0 ? (
        <p className="dash-vacio">Sin combustible entregado a máquinas en este periodo.</p>
      ) : (
        <>
          {horasTot > 0 && (
            <p className="dash-galh__resumen">
              <strong>{nfGrafico(galConHoras / horasTot, 2)} gal/h</strong> en promedio ·{' '}
              {nfGrafico(galConHoras, 0)} gal en {nfGrafico(horasTot, 1)} h
              {conHoras.length < filas.length && ` · ${filas.length - conHoras.length} sin horas`}
            </p>
          )}
          {rangos.length > 0 && (cuenta('rojo') + cuenta('naranja') + cuenta('bajo')) > 0 && (
            <p className="dash-sem__resumen">
              {cuenta('rojo') > 0 && <span className="dash-galh dash-galh--rojo">{NIVEL.rojo.icono} {cuenta('rojo')} alto</span>}
              {cuenta('naranja') > 0 && <span className="dash-galh dash-galh--naranja">{NIVEL.naranja.icono} {cuenta('naranja')} medio</span>}
              {cuenta('bajo') > 0 && <span className="dash-galh dash-galh--bajo">{NIVEL.bajo.icono} {cuenta('bajo')} debajo del rango</span>}
              <span className="dash-sem__ok">{NIVEL.verde.icono} {cuenta('verde')} dentro</span>
            </p>
          )}
          <div className="dash-barras">
            {filas.map((f) => { const s = semaforo.get(f.maquina); return (
              <button
                key={f.maquina}
                type="button"
                className="dash-barra dash-barra--galh"
                onClick={() => setVer(f)}
                aria-label={`${f.nombre}: ${nfGrafico(f.galones, 1)} galones, ${f.galPorHora != null ? `${nfGrafico(f.galPorHora, 2)} galones por hora` : f.problema ?? 'sin horas'}`}
              >
                <span className="dash-barra__lbl" title={f.nombre}>{f.nombre}</span>
                <span className="dash-barra__track">
                  <span className="dash-barra__fill" style={{ width: `${Math.max((f.galones / max) * 100, 2)}%`, background: f.medido ? SERIES[0] : 'var(--muted, #b8b8b8)' }} />
                </span>
                <span className="dash-barra__val" title={f.medido ? `gastó ${nfGrafico(f.galones, 1)} gal · se le cargaron ${nfGrafico(f.cargado, 1)}` : `se le cargaron ${nfGrafico(f.cargado, 1)} gal: ${f.problema ?? ''}`}>
                  {nfGrafico(f.galones, f.galones >= 100 ? 0 : 1)}<small>{f.medido ? ' gal' : ' cargados'}</small>
                </span>
                {otras == null ? (
                  <span className="dash-galh dash-galh--sin">…</span>
                ) : f.galPorHora != null ? (
                  <span
                    className={`dash-galh${s?.gal ? ` dash-galh--${s.gal}` : ''}`}
                    title={[
                      s?.gal && s.rangoGal ? `${NIVEL[s.gal].texto} (${describirRango(s.rangoGal)})` : 'sin rango para esta máquina',
                      `${nfGrafico(f.horas ?? 0, 1)} h desde el tanqueo anterior al periodo`,
                    ].join(' · ')}
                  >
                    {s?.gal && `${NIVEL[s.gal].icono} `}{nfGrafico(f.galPorHora, 2)} gal/h
                  </span>
                ) : (
                  <span className="dash-galh dash-galh--sin" title={f.problema ?? ''}>{f.tramos.length === 1 ? '1 tanqueo' : 'sin medir'}</span>
                )}
                {/* Ganchos por hora: solo si la máquina recibió ganchos en el periodo. */}
                {s && s.ganchos > 0 ? (
                  s.ganchosHora != null ? (
                    <span
                      className={`dash-galh dash-gch${s.gch ? ` dash-galh--${s.gch}` : ''}`}
                      title={`${nfGrafico(s.ganchos, 0)} ganchos en ${nfGrafico(f.horas ?? 0, 1)} h${s.gch && s.rangoGch ? ` · ${NIVEL[s.gch].texto} (${describirRango(s.rangoGch)})` : ''}`}
                    >
                      {s.gch && `${NIVEL[s.gch].icono} `}{nfGrafico(s.ganchosHora, 2)}<small> ganchos/h</small>
                    </span>
                  ) : (
                    <span className="dash-galh dash-gch dash-galh--sin" title="Sin horas: no hay contra qué dividir">{nfGrafico(s.ganchos, 0)}<small> ganchos</small></span>
                  )
                ) : <span className="dash-gch dash-gch--vacio" aria-hidden="true" />}
              </button>
            ) })}
          </div>
          {unSoloDia && (
            <p className="dash-galha__nota">Un solo día: lo cargado hoy repone lo gastado desde el tanqueo anterior.</p>
          )}
        </>
      )}

      {ver && (
        <div className="modal-overlay open" onClick={() => setVer(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Combustible por hora · {desde === hasta ? desde : `${desde} a ${hasta}`}</p>
                <h3>{ver.nombre}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setVer(null)} aria-label="Cerrar">✕</button>
            </div>
            <div className="dash-kpis">
              <div className="dash-kpi"><span className="dash-kpi__val">{ver.gastado != null ? nfGrafico(ver.gastado, 1) : '—'}</span><span className="dash-kpi__lbl">galones gastados</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{ver.horas != null ? nfGrafico(ver.horas, 1) : '—'}</span><span className="dash-kpi__lbl">horas entre tanqueos</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{ver.galPorHora != null ? nfGrafico(ver.galPorHora, 2) : '—'}</span><span className="dash-kpi__lbl">galones por hora</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{nfGrafico(ver.cargado, 1)}</span><span className="dash-kpi__lbl">galones cargados</span></div>
            </div>
            {ver.problema && <p className="mov-alerta">⚠ {ver.problema}.</p>}
            {(() => {
              const s = semaforo.get(ver.maquina)
              if (!s) return null
              return (
                <div className="dash-sem__detalle">
                  <p>
                    <strong>Galones por hora:</strong>{' '}
                    {s.gal ? <span className={`dash-galh dash-galh--${s.gal}`}>{NIVEL[s.gal].icono} {NIVEL[s.gal].texto}</span>
                      : ver.galPorHora == null ? 'sin horas, sin semáforo' : 'sin rango para esta máquina'}
                    {s.rangoGal && <small> · {describirRango(s.rangoGal)} gal/h</small>}
                    {s.rangoGal?.nota && <small> · {s.rangoGal.nota}</small>}
                  </p>
                  {s.ganchos > 0 && (
                    <p>
                      <strong>Ganchos:</strong> {nfGrafico(s.ganchos, 0)} en el periodo
                      {s.ganchosHora != null && <> · {nfGrafico(s.ganchosHora, 2)} por hora </>}
                      {s.gch && <span className={`dash-galh dash-galh--${s.gch}`}>{NIVEL[s.gch].icono} {NIVEL[s.gch].texto}</span>}
                      {s.rangoGch && <small> · {describirRango(s.rangoGch)} por hora</small>}
                    </p>
                  )}
                  {s.gal === 'bajo' && (
                    <p className="dash-galha__nota">Debajo del rango casi siempre es un registro que falta —un tanqueo o una entrega sin anotar— o un horómetro que corrió de más. Revisar antes de celebrar.</p>
                  )}
                </div>
              )
            })()}
            <div className="dash-galh__lecturas">
              <LecturaFila titulo="Punto de partida (tanqueo anterior)" l={ver.inicial} />
              <LecturaFila titulo="Último tanqueo (final)" l={ver.final} />
            </div>
            <p className="field-hint" style={{ marginTop: 10 }}>
              Cada tanqueo repone lo que se gastó desde el anterior: el gastado son los galones de los
              tanqueos del periodo, y las horas, el horómetro del último menos el del tanqueo anterior al periodo.
            </p>
            <p className="eyebrow" style={{ marginTop: 14 }}>Tanqueos del periodo ({ver.tramos.length})</p>
            <div className="dash-galh__desc">
              {ver.tramos.map((tr, i) => (
                <div key={i} className="dash-galh__descfila">
                  <b>{tr.horometro != null ? nfGrafico(tr.horometro, 1) : '—'}</b>
                  <span>
                    {fmtFechaHora(tr.cuando)} · {nfGrafico(tr.galones, 1)} gal{tr.cuenta ? '' : ' (no entra)'}
                    {tr.horasDesdeAnterior != null ? ` · ${nfGrafico(tr.horasDesdeAnterior, 1)} h desde el anterior` : ''}
                    {tr.detalle ? ` · ${tr.detalle}` : ''}
                  </span>
                  {tr.nota && <small>{tr.nota}</small>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LecturaFila({ titulo, l }: { titulo: string; l: Tanqueo | null }) {
  return (
    <div className="dash-galh__lectura">
      <span className="eyebrow">{titulo}</span>
      {l ? (
        <>
          <strong>{nfGrafico(l.horometro ?? 0, 1)}</strong>
          <small>{l.fuente} · {fmtFechaHora(l.cuando)} · {nfGrafico(l.galones, 1)} gal{l.detalle ? ` · ${l.detalle}` : ''}</small>
        </>
      ) : <small>Sin lectura en el periodo.</small>}
    </div>
  )
}
