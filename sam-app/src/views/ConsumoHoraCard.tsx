import { useEffect, useMemo, useState } from 'react'
import type { Assignment, InsumoKardex } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'
import { nfGrafico, SERIES } from '../components/Charts'
import { fmtFechaHora } from '../lib/fechas'
import { combustiblePorMaquina, type Catalogo } from '../lib/insumosDash'
import {
  consumoPorHora, diasDelRango, lecturasDeLabores,
  type FilaConsumoHora, type Lectura,
} from '../lib/consumoHora'
import { loadLecturasHorometro } from '../services/samApi'

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
          <div className="dash-barras">
            {filas.map((f) => (
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
                    className={`dash-galh${f.cruceTanqueo.discrepa ? ' dash-galh--ojo' : ''}`}
                    title={f.cruceTanqueo.discrepa
                      ? `Entre tanqueos: ${nfGrafico(f.cruceTanqueo.horasMismasFechas ?? 0, 1)} h con todas las lecturas y ${nfGrafico(f.cruceTanqueo.horas ?? 0, 1)} h al tanquear: revisar`
                      : `${nfGrafico(f.horas ?? 0, 1)} h de horómetro`}
                  >
                    {f.cruceTanqueo.discrepa && '⚠ '}{nfGrafico(f.galPorHora, 2)} gal/h
                  </span>
                ) : (
                  <span className="dash-galh dash-galh--sin" title={f.problema ?? ''}>sin horas</span>
                )}
              </button>
            ))}
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
