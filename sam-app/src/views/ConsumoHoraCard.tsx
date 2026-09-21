import { useEffect, useMemo, useState } from 'react'
import type { Assignment, InsumoKardex } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'
import { nfGrafico, SERIES } from '../components/Charts'
import { fmtFechaHora } from '../lib/fechas'
import { combustiblePorMaquina, ganchosPorMaquina, type Catalogo } from '../lib/insumosDash'
import { NIVEL, describirRango, nivelDe, rangoDe, type NivelSemaforo, type RangoSemaforo } from '../lib/semaforo'
import {
  consumoPorHora, diasDelRango, lecturasDeLabores,
  type FilaConsumoHora, type Lectura,
} from '../lib/consumoHora'
import { loadLecturasHorometro, loadSemaforos } from '../services/samApi'

/**
 * Combustible por hora de máquina: una barra por máquina con los galones del
 * periodo y, al lado, los galones por hora.
 *
 * Las horas son el horómetro FINAL del periodo menos el INICIAL, leídos de
 * todas las fuentes (cierres de labor, entregas y tanqueos) y filtrados como
 * explica `lib/consumoHora`. Los galones son EXACTAMENTE los de la torta
 * «Combustible por máquina» (`combustiblePorMaquina`): si dieran distinto, el
 * cliente tendría que preguntarse cuál es el bueno.
 *
 * Usa el filtro de periodo de la pantalla (Hoy, Ayer, Rango…): no trae uno
 * propio. Dos filtros en la misma pantalla es lo que el cliente llamó
 * «saturado».
 */
export function ConsumoHoraCard({
  movs, cerradas, catalogo, nombreMaq, desde, hasta, unSoloDia,
}: {
  movs: InsumoKardex[]
  cerradas: Assignment[]
  catalogo: Catalogo
  nombreMaq: (c: string) => string
  desde: string
  hasta: string
  unSoloDia: boolean
}) {
  const [otras, setOtras] = useState<Lectura[] | null>(null)
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
    loadLecturasHorometro(desde, hasta)
      .then((l) => { if (vivo) setOtras(l) })
      .catch(() => { if (vivo) setOtras([]) })
    return () => { vivo = false }
  }, [desde, hasta])

  const filas = useMemo(() => {
    const galones = new Map<string, number>()
    for (const p of combustiblePorMaquina(movs, catalogo, nombreMaq)) galones.set(p.id, p.valor)
    const lab = lecturasDeLabores(cerradas)
    return consumoPorHora({
      galones,
      lecturas: [...lab.lecturas, ...(otras ?? [])],
      descartadasPrevias: lab.descartadas,
      dias: diasDelRango(desde, hasta),
      nombreMaq,
    })
  }, [movs, catalogo, nombreMaq, cerradas, otras, desde, hasta])

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
          La barra es el <strong>combustible</strong> que recibió cada máquina en el periodo
          elegido arriba (el mismo número de la torta). La etiqueta es cuánto gastó
          <strong> por hora</strong>.
        </p>
        <p>
          Las horas son el <strong>horómetro final</strong> del periodo menos el
          <strong> inicial</strong>, tomados de los cierres de labor, las entregas y los
          tanqueos. Las lecturas en cero, al revés o con dígitos de más no se usan; al tocar
          una máquina se ve de dónde salió cada horómetro y qué se descartó.
        </p>
        <p>
          Para <strong>un solo día</strong> el número es orientativo: el tanqueo de hoy
          alimenta también mañana. En una quincena o un mes se promedia solo.
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
                  <span className="dash-barra__fill" style={{ width: `${Math.max((f.galones / max) * 100, 2)}%`, background: SERIES[0] }} />
                </span>
                <span className="dash-barra__val">{nfGrafico(f.galones, f.galones >= 100 ? 0 : 1)}<small> gal</small></span>
                {otras == null ? (
                  <span className="dash-galh dash-galh--sin">…</span>
                ) : f.galPorHora != null ? (
                  <span
                    className={`dash-galh${s?.gal ? ` dash-galh--${s.gal}` : ''}${f.cruceTanqueo.discrepa ? ' dash-galh--ojo' : ''}`}
                    title={[
                      s?.gal && s.rangoGal ? `${NIVEL[s.gal].texto} (${describirRango(s.rangoGal)})` : 'sin rango para esta máquina',
                      f.cruceTanqueo.discrepa
                        ? `entre tanqueos: ${nfGrafico(f.cruceTanqueo.horasMismasFechas ?? 0, 1)} h con todas las lecturas y ${nfGrafico(f.cruceTanqueo.horas ?? 0, 1)} h al tanquear: revisar`
                        : `${nfGrafico(f.horas ?? 0, 1)} h de horómetro`,
                    ].join(' · ')}
                  >
                    {/* ≠ = el horómetro de tanqueo no cuadra (antes era ⚠, que ahora es «alto»). */}
                    {f.cruceTanqueo.discrepa && '≠ '}{s?.gal && `${NIVEL[s.gal].icono} `}{nfGrafico(f.galPorHora, 2)} gal/h
                  </span>
                ) : (
                  <span className="dash-galh dash-galh--sin" title={f.problema ?? ''}>sin horas</span>
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
            <p className="dash-galha__nota">Un solo día: orientativo, el tanqueo de hoy alimenta también mañana.</p>
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
              <div className="dash-kpi"><span className="dash-kpi__val">{nfGrafico(ver.galones, 1)}</span><span className="dash-kpi__lbl">galones</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{ver.horas != null ? nfGrafico(ver.horas, 1) : '—'}</span><span className="dash-kpi__lbl">horas de horómetro</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{ver.galPorHora != null ? nfGrafico(ver.galPorHora, 2) : '—'}</span><span className="dash-kpi__lbl">galones por hora</span></div>
              <div className="dash-kpi"><span className="dash-kpi__val">{ver.usadas}</span><span className="dash-kpi__lbl">lecturas usadas</span></div>
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
              <LecturaFila titulo="Horómetro inicial" l={ver.inicial} />
              <LecturaFila titulo="Horómetro final" l={ver.final} />
            </div>
            <p className="eyebrow" style={{ marginTop: 14 }}>Contra el horómetro de tanqueo</p>
            <div className="dash-galh__cruce">
              <div>
                <span>Con todas las lecturas</span>
                <strong>{ver.horas != null ? `${nfGrafico(ver.horas, 1)} h` : '—'}</strong>
                <small>{ver.galPorHora != null ? `${nfGrafico(ver.galPorHora, 2)} gal/h` : 'sin gal/h'}</small>
              </div>
              <div>
                <span>Solo al tanquear</span>
                <strong>{ver.cruceTanqueo.horas != null ? `${nfGrafico(ver.cruceTanqueo.horas, 1)} h` : '—'}</strong>
                <small>{ver.cruceTanqueo.galPorHora != null ? `${nfGrafico(ver.cruceTanqueo.galPorHora, 2)} gal/h` : ver.cruceTanqueo.lecturas.length < 2 ? 'menos de dos tanqueos con horómetro' : 'el horómetro no avanzó'}</small>
              </div>
            </div>
            {ver.cruceTanqueo.discrepa && ver.cruceTanqueo.horasMismasFechas != null && ver.cruceTanqueo.horas != null && (
              <p className="mov-alerta">
                ⚠ Entre el primer y el último tanqueo, las lecturas dan {nfGrafico(ver.cruceTanqueo.horasMismasFechas, 1)} h y el
                horómetro de tanqueo {nfGrafico(ver.cruceTanqueo.horas, 1)} h: revisar qué se anotó al cerrar las labores y qué al tanquear.
              </p>
            )}
            {ver.cruceTanqueo.lecturas.length > 0 && (
              <div className="dash-galh__desc">
                {ver.cruceTanqueo.lecturas.map((l, i) => (
                  <div key={i} className="dash-galh__descfila">
                    <b>{nfGrafico(l.horometro, 1)}</b>
                    <span>{l.fuente} · {fmtFechaHora(l.cuando)}{l.detalle ? ` · ${l.detalle}` : ''}</span>
                  </div>
                ))}
              </div>
            )}

            {ver.descartadas.length > 0 && (
              <>
                <p className="eyebrow" style={{ marginTop: 14 }}>No se usaron ({ver.descartadas.length})</p>
                <div className="dash-galh__desc">
                  {ver.descartadas.slice(0, 40).map((d, i) => (
                    <div key={i} className="dash-galh__descfila">
                      <b>{nfGrafico(d.horometro, 1)}</b>
                      <span>{d.fuente} · {fmtFechaHora(d.cuando)}{d.detalle ? ` · ${d.detalle}` : ''}</span>
                      <small>{d.motivo}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LecturaFila({ titulo, l }: { titulo: string; l: Lectura | null }) {
  return (
    <div className="dash-galh__lectura">
      <span className="eyebrow">{titulo}</span>
      {l ? (
        <>
          <strong>{nfGrafico(l.horometro, 1)}</strong>
          <small>{l.fuente} · {fmtFechaHora(l.cuando)}{l.detalle ? ` · ${l.detalle}` : ''}</small>
        </>
      ) : <small>Sin lectura en el periodo.</small>}
    </div>
  )
}
