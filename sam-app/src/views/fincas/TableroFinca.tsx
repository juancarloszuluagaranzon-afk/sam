import { useEffect, useMemo, useState } from 'react'
import { cargarReferencias, type DatosFincas, type ReferenciasSector } from '../../services/fincasApi'
import {
  comparar, costosGremio, fmtCant, fmtPesos, fmtPesosCorto, indicadoresCosecha, VER_PLATA,
} from '../../lib/fincas'

const fmt1 = (n: number): string => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fmt2 = (n: number): string => n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt0 = (n: number): string => Math.round(n).toLocaleString('es-CO')

/** «Procaña, Plantilla de costos 2022 (soca)» → «Procaña soca 2022». */
function fuenteCorta(fuente: string, anio: number): string {
  const base = fuente.split(',')[0]?.trim() ?? ''
  const parentesis = fuente.match(/\(([^)]+)\)/)?.[1]?.trim() ?? ''
  return [base, parentesis, anio ? String(anio) : ''].filter(Boolean).join(' ')
}

const fechaCorta = (iso: string): string =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function Delta({ c }: { c: { texto: string; arriba: boolean } | null }) {
  if (!c) return null
  return <em className={`af-delta ${c.arriba ? 'af-delta--arriba' : 'af-delta--abajo'}`}>{c.texto}</em>
}

/**
 * El tablero del dueño y de administración (24-oct-2026): la productividad de la
 * última cosecha frente a Cenicaña y los costos del ciclo en el lenguaje del
 * gremio cañero ($/ha, $/t, $/kg de azúcar, punto de equilibrio y rubros).
 * Las referencias son un dato de la base (`af_referencias`): si no llegan, el
 * tablero se dibuja igual, sin comparaciones. Una cuenta que falle no tumba la
 * pantalla: esa sección simplemente no se pinta.
 */
export function TableroFinca({ d, fincaId }: { d: DatosFincas; fincaId: string }) {
  const [refs, setRefs] = useState<ReferenciasSector | null>(null)

  useEffect(() => {
    let vivo = true
    cargarReferencias()
      .then((r) => { if (vivo) setRefs(r) })
      .catch(() => { /* se dibuja sin comparaciones */ })
    return () => { vivo = false }
  }, [])

  const ind = useMemo(() => {
    try { return indicadoresCosecha(fincaId, d) } catch { return null }
  }, [fincaId, d])

  const costos = useMemo(() => {
    try { return costosGremio(fincaId, d, refs) } catch { return null }
  }, [fincaId, d, refs])

  const finca = d.fincas.find((f) => f.id === fincaId)
  const prod = refs?.productividad ?? null
  const refCostos = refs?.costos ?? null
  const refCostoKg = refCostos && refCostos.kgAzucarTc > 0 ? refCostos.costoTc / refCostos.kgAzucarTc : null

  // ── C: los kilos de azúcar que le liquidan por tonelada ──
  const kgLiq = costos?.kgAzucarTc ?? null
  const kaTc = costos?.kaTc ?? null
  const kgLibres = costos?.kgLibres ?? null
  // Sin costos registrados no hay medidor: con $0 diría «le quedan los 58 kg».
  const conCostos = costos != null && costos.costoTotal > 0
  const puedeAzucar = VER_PLATA && conCostos && kgLiq != null && kaTc != null && kgLibres != null
  const pctCosto = Math.max(0, Math.min(100, costos?.pctCostos ?? 0))
  const pctLibre = 100 - pctCosto
  const notaAzucar = puedeAzucar && costos
    ? [
      `Le queda por hectárea: ${costos.leQuedaHa != null ? fmtPesosCorto(costos.leQuedaHa) : '—'} (estimado)`,
      ...(costos.kgEsReferencia && refCostos
        ? [`${fmtCant(kgLiq)} kg es la referencia de compraventa (Procaña)`]
        : []),
      ...(refCostos
        ? [`${fuenteCorta(refCostos.fuente, refCostos.anio)}: ${fmtCant(refCostos.kaTc)} kg de costo por tonelada`]
        : []),
    ].join(' · ')
    : ''

  // ── D: el mayor rubro, para escalar las barras ──
  const rubros = costos?.rubros ?? []
  const mayorRubro = rubros.reduce((m, r) => Math.max(m, r.valor), 0)

  const precioFinca = finca?.precioKgAzucar
  const precioTexto = precioFinca != null && precioFinca > 0
    ? fmtPesos(precioFinca)
    : 'sin definir'

  return (
    <>
      <div className="af-card af-card--ancha">
        <h3>Productividad de la última cosecha frente al sector</h3>
        {!ind ? (
          <p className="af-nota">Aún no hay datos de cosecha del ingenio para esta finca.</p>
        ) : (
          <>
            <div className="af-kpis">
              <div className="af-kpi">
                <b>{fmt1(ind.tch)}</b>
                <span>TCH (t de caña/ha)</span>
                {prod && <small>Sector {prod.anio}: {fmtCant(prod.tch)}<Delta c={comparar(ind.tch, prod.tch, 'pct')} /></small>}
              </div>
              <div className="af-kpi">
                <b>{ind.tah != null ? fmt1(ind.tah) : '—'}</b>
                <span>TAH (t de azúcar/ha)</span>
                {prod && <small>Sector {prod.anio}: {fmtCant(prod.tah)}<Delta c={comparar(ind.tah, prod.tah, 'pct')} /></small>}
              </div>
              <div className="af-kpi">
                <b>{ind.rendimiento != null ? `${fmtCant(ind.rendimiento)} %` : '—'}</b>
                <span>Rendimiento comercial</span>
                {prod && <small>Sector {prod.anio}: {fmtCant(prod.rendimiento)} %<Delta c={comparar(ind.rendimiento, prod.rendimiento, 'pts')} /></small>}
              </div>
              <div className="af-kpi">
                <b>{ind.sacarosa != null ? `${fmtCant(ind.sacarosa)} %` : '—'}</b>
                <span>Sacarosa % caña</span>
                {ind.sacarosa == null
                  ? <small>Falta el dato del ingenio</small>
                  : prod && <small>Sector {prod.anio}: {fmtCant(prod.sacarosa)} %<Delta c={comparar(ind.sacarosa, prod.sacarosa, 'pts')} /></small>}
              </div>
              <div className="af-kpi">
                <b>{ind.tchm != null ? fmt1(ind.tchm) : '—'}</b>
                <span>TCHM (t caña/ha/mes)</span>
                {prod && <small>Sector {prod.anio}: {fmtCant(prod.tchm)}<Delta c={comparar(ind.tchm, prod.tchm, 'pct')} /></small>}
              </div>
              <div className="af-kpi">
                <b>{ind.tahm != null ? fmt2(ind.tahm) : '—'}</b>
                <span>TAHM (t azúcar/ha/mes)</span>
                {prod && <small>Sector {prod.anio}: {fmtCant(prod.tahm)}<Delta c={comparar(ind.tahm, prod.tahm, 'abs')} /></small>}
              </div>
              <div className="af-kpi">
                <b>{ind.edadMeses != null ? `${fmt1(ind.edadMeses)} meses` : '—'}</b>
                <span>Edad de cosecha</span>
                {prod && <small>Sector {prod.anio}: {fmtCant(prod.edadMeses)} meses</small>}
              </div>
              <div className="af-kpi">
                <b>{`${fmt0(ind.toneladas)} t`}</b>
                <span>Toneladas cosechadas</span>
                <small>{ind.azucar != null ? `${fmt0(ind.azucar)} t de azúcar` : 'Falta el rendimiento del ingenio'}</small>
              </div>
            </div>
            <p className="af-nota">
              Última cosecha de {ind.suertes} {ind.suertes === 1 ? 'suerte' : 'suertes'} ({fmtCant(ind.areaHa)} ha). Referencia: {prod ? prod.fuente : 'sin cargar'}.
            </p>
          </>
        )}
      </div>

      {VER_PLATA && (
        <div className="af-card af-card--ancha">
          <h3>Costos del ciclo, como los mide el gremio</h3>
          {!costos ? (
            <p className="af-nota">Sin ciclos abiertos en esta finca.</p>
          ) : !conCostos ? (
            <p className="af-nota">Todavía no hay costos registrados en el ciclo en curso (desde el corte del {fechaCorta(costos.desde)}).</p>
          ) : (
            <>
              <div className="af-kpis">
                <div className="af-kpi">
                  <b>{costos.costoHa != null ? fmtPesos(costos.costoHa) : '—'}</b>
                  <span>Costo por hectárea</span>
                  <small>
                    {costos.costoHa != null && refCostos
                      ? `${fuenteCorta(refCostos.fuente, refCostos.anio)}: ${fmtPesos(refCostos.costoHa)}`
                      : costos.costoHa != null ? 'Sin referencia del sector cargada' : 'Falta el área de los ciclos abiertos'}
                  </small>
                </div>
                <div className="af-kpi">
                  <b>{costos.costoTc != null ? fmtPesos(costos.costoTc) : '—'}</b>
                  <span>Costo por tonelada de caña</span>
                  <small>
                    {costos.costoTc == null
                      ? costos.tchEsperado == null ? 'Falta el TCH de la última cosecha' : 'Falta el área de los ciclos abiertos'
                      : refCostos ? `${fuenteCorta(refCostos.fuente, refCostos.anio)}: ${fmtPesos(refCostos.costoTc)}` : 'Sin referencia del sector cargada'}
                  </small>
                </div>
                <div className="af-kpi">
                  <b>{costos.costoKgAzucar != null ? fmtPesos(costos.costoKgAzucar) : '—'}</b>
                  <span>Costo por kg de azúcar liquidado</span>
                  <small>
                    {costos.costoKgAzucar == null
                      ? costos.kgAzucarTc == null
                        ? 'Falta el kg de azúcar por tonelada (lo define administración)'
                        : 'Falta el TCH de la última cosecha'
                      : refCostoKg != null && refCostos ? `${fuenteCorta(refCostos.fuente, refCostos.anio)}: ${fmtPesos(refCostoKg)}` : 'Sin referencia del sector cargada'}
                  </small>
                </div>
                <div className="af-kpi">
                  <b>{costos.puntoEquilibrio != null ? `${fmt1(costos.puntoEquilibrio)} t/ha` : '—'}</b>
                  <span>Punto de equilibrio</span>
                  <small>
                    {costos.puntoEquilibrio == null
                      ? costos.precioKg == null
                        ? 'Falta el precio del kg de azúcar (lo fija administración)'
                        : costos.tchEsperado == null
                          ? 'Falta el TCH de la última cosecha'
                          : costos.kgAzucarTc == null
                            ? 'Falta el kg de azúcar por tonelada (lo define administración)'
                            : 'Falta el costo por hectárea'
                      : (() => {
                        const sobra = (costos.tchEsperado ?? 0) - costos.puntoEquilibrio
                        return `Produjo ${fmt1(costos.tchEsperado ?? 0)}: ${sobra >= 0 ? 'le sobran' : 'le faltan'} ${fmt1(Math.abs(sobra))} t/ha`
                      })()}
                  </small>
                </div>
              </div>
              <p className="af-nota">
                Ciclo en curso: lo gastado desde el corte ({fechaCorta(costos.desde)}), sobre el TCH de la última cosecha.
              </p>
            </>
          )}
        </div>
      )}

      {puedeAzucar && costos && kgLiq != null && kaTc != null && kgLibres != null && (
        <div className={`af-card af-card--ancha af-azucar${kgLibres < 0 ? ' af-azucar--perdida' : ''}`}>
          <h3>De los {fmtCant(kgLiq)} kg de azúcar que le liquidan por cada tonelada de caña</h3>
          <p className="af-azucar__cifra">
            <b>{fmt1(kgLibres)} kg</b>{' '}
            <span>
              {kgLibres < 0 ? 'Los costos superan lo que se liquida' : 'le quedan a usted'} · {fmt1(kaTc)} kg pagan los costos
            </span>
          </p>
          <div
            className="af-azucar__barra" role="img"
            aria-label={`De ${fmtCant(kgLiq)} kg de azúcar por tonelada, ${fmt1(kaTc)} kg se van en costos y ${fmt1(kgLibres)} kg le quedan`}
          >
            <i className="af-azucar__costo" style={{ width: `${pctCosto}%` }} />
            <i className="af-azucar__libre" style={{ width: `${pctLibre}%` }} />
          </div>
          <div className="af-azucar__leyenda">
            <span>Costos {fmt1(kaTc)} kg · {fmt0(pctCosto)} %</span>
            <span>Para usted {fmt1(kgLibres)} kg · {fmt0(pctLibre)} %</span>
          </div>
          <p className="af-nota">{notaAzucar}</p>
        </div>
      )}

      {VER_PLATA && conCostos && rubros.length > 0 && (
        <div className="af-card af-card--ancha">
          <h3>En qué se fue la plata, por hectárea y en kilos de azúcar</h3>
          <div className="af-rubros">
            <div className="af-rubros__fila af-rubros__fila--cab">
              <span>Rubro</span>
              <span />
              <span>$/ha</span>
              <span>kg/t</span>
            </div>
            {rubros.map((r) => (
              <div key={r.id} className="af-rubros__fila">
                <span>{r.nombre}</span>
                <span className="af-barra">
                  <i style={{ width: `${mayorRubro > 0 ? Math.max(0, Math.min(100, (r.valor / mayorRubro) * 100)) : 0}%` }} />
                </span>
                <span>{fmtPesos(r.porHa)}</span>
                <span>{r.kgTc != null ? fmtCant(r.kgTc) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="af-nota af-card--ancha">
        Referencias: {prod?.fuente ?? 'sin referencia'} · {refCostos?.fuente ?? 'sin referencia'}. Precio de liquidación: {precioTexto} por kg (lo fija administración).
      </p>
    </>
  )
}
