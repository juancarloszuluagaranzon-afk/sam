import { useRef, useState } from 'react'
import type { Ciclo, LaborCiclo, LaborPaquete, SuerteFinca, TipoCiclo } from '../../services/fincasApi'
import { fmtCant, fmtPesos, fmtPesosCorto, nombreLabor } from '../../lib/fincas'
import {
  ajustesParaRpc, copiarCostos, cronograma, lineasDesdeCatalogo, totalesPlan, totalLinea, validarLinea,
  type AjusteRpc, type LineaPlan,
} from '../../lib/planCorte'
import { SearchableSelect } from '../../components/SearchableSelect'
import { CronogramaDDC } from './CronogramaDDC'
import { useCapaAtras, useVistaAtras } from '../../lib/atras'

/**
 * «Iniciar corte» como un asistente de cuatro pasos (25-oct-2026): Parámetros → Punto de partida →
 * Ajustar costos → Revisar y activar. NADA toca la finca hasta el último paso: mientras tanto el plan
 * vive solo en esta pantalla. Al activar, la base abre el corte y aplica los ajustes en una sola
 * operación (`af_abrir_ciclo_plan`). Un corte ya abierto sigue editándose labor por labor, como antes.
 */

type Origen = 'catalogo' | 'anterior' | 'otra'
const PASOS = ['Parámetros', 'Punto de partida', 'Ajustar costos', 'Revisar y activar'] as const

const dia = (f: string): string =>
  new Date(`${f}T12:00:00-05:00`).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' })
const aNumero = (v: string): number => Number(v.replace(/\./g, '').replace(',', '.')) || 0
const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`

export function PlanCorte({ suerte, hoy, paquete, ciclos, labores, otras, hayCicloAbierto, ocupado, onCancelar, onActivar }: {
  suerte: SuerteFinca
  hoy: string
  paquete: LaborPaquete[]
  ciclos: Ciclo[]
  labores: LaborCiclo[]
  /** Las demás suertes activas de la finca, para copiarles el presupuesto. */
  otras: SuerteFinca[]
  hayCicloAbierto: boolean
  ocupado: boolean
  onCancelar: () => void
  /** Devuelve null si salió bien, o el texto del problema para mostrarlo aquí mismo. */
  onActivar: (fecha: string, tipo: TipoCiclo, ajustes: AjusteRpc[]) => Promise<string | null>
}) {
  const [paso, setPaso] = useState(1)
  const [fecha, setFecha] = useState('')
  const [tipo, setTipo] = useState<TipoCiclo>('SOCA')
  const [origen, setOrigen] = useState<Origen>('catalogo')
  const [otraId, setOtraId] = useState('')
  const [lineas, setLineas] = useState<LineaPlan[]>([])
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  // Con qué parámetros se armó el plan: si el usuario vuelve atrás y no cambia nada, no se le pierden sus ajustes.
  const armadoCon = useRef('')

  // «Atrás» del celular: dentro del asistente regresa de paso (4→3→2→1) y desde el paso 1 lo cierra (como Cancelar),
  // en vez de sacar de la app. Mientras se está activando el corte no cierra nada. Nada se ha guardado antes del paso 4.
  useCapaAtras(true, () => { if (!ocupado) onCancelar() })
  useVistaAtras(paso, setPaso, 'plan-corte-paso')

  const cortesDe = (suerteId: string): Ciclo[] =>
    ciclos.filter((c) => c.suerteId === suerteId).sort((a, b) => b.fechaCorte.localeCompare(a.fechaCorte))
  const anterior = cortesDe(suerte.id)[0] ?? null
  const otrasConCorte = otras.filter((o) => o.id !== suerte.id && cortesDe(o.id).length > 0)
  const origenCiclo = origen === 'anterior' ? anterior : origen === 'otra' ? (cortesDe(otraId)[0] ?? null) : null

  function armar() {
    const base = lineasDesdeCatalogo(paquete, tipo, suerte.areaHa, suerte.variedad)
    if (origen === 'catalogo' || !origenCiclo) { setLineas(base); setAviso(''); return }
    const r = copiarCostos(base, labores.filter((l) => l.cicloId === origenCiclo.id))
    setLineas(r.lineas)
    setAviso(
      `Se copiaron los costos de ${plural(r.copiadas, 'labor', 'labores')} del corte del ${dia(origenCiclo.fechaCorte)}.` +
      (r.sinOrigen.length ? ` Quedaron con el catálogo: ${r.sinOrigen.map(nombreLabor).join(', ')}.` : ''),
    )
  }

  function siguiente() {
    setError('')
    if (paso === 1) {
      if (!fecha) { setError('Escriba la fecha del corte.'); return }
      if (fecha > hoy) { setError('El corte no puede ser después de hoy.'); return }
    }
    if (paso === 2) {
      if (origen === 'otra' && !otraId) { setError('Escoja la suerte de la que va a copiar.'); return }
      const llave = `${fecha}|${tipo}|${origen}|${origenCiclo?.id ?? ''}`
      if (llave !== armadoCon.current) { armar(); armadoCon.current = llave }
    }
    if (paso === 3) {
      if (lineas.length === 0) { setError('El catálogo no tiene labores que apliquen a este corte. Agréguelas en «Catálogo de labores».'); return }
      for (const l of lineas) { const p = validarLinea(l); if (p) { setError(p); return } }
    }
    setPaso((p) => Math.min(4, p + 1))
  }

  function cambiar(clave: string, parche: Partial<LineaPlan>) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...parche } : l)))
  }

  async function activar() {
    setError('')
    const problema = await onActivar(fecha, tipo, ajustesParaRpc(lineas))
    if (problema) setError(problema)
  }

  const totales = totalesPlan(lineas, suerte.areaHa)
  const hitos = paso === 4 ? cronograma(lineas, fecha) : []

  return (
    <div className="af-card af-plan">
      <div className="af-cab af-cab--chica">
        <div>
          <p className="eyebrow">Iniciar corte · suerte {suerte.codigo}</p>
          <h3>Plan y presupuesto del corte</h3>
        </div>
        <button type="button" className="af-link" onClick={onCancelar} disabled={ocupado}>Cancelar</button>
      </div>

      <ol className="af-plan__pasos" aria-label="Pasos del asistente">
        {PASOS.map((t, i) => (
          <li key={t} className={i + 1 === paso ? 'is-actual' : i + 1 < paso ? 'is-hecho' : ''} aria-current={i + 1 === paso ? 'step' : undefined}>
            <span>{i + 1 < paso ? '✓' : i + 1}</span><b>{t}</b>
          </li>
        ))}
      </ol>
      <p className="af-plan__paso-txt">Paso {paso} de 4 · {PASOS[paso - 1]}</p>

      {paso === 1 && (
        <>
          <div className="af-form">
            <label>Fecha del corte<input id="af-plan-fecha" type="date" max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
            <label>Tipo de corte
              <select id="af-plan-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoCiclo)}>
                <option value="SOCA">Soca</option><option value="PLANTILLA">Plantilla</option>
              </select>
            </label>
          </div>
          <p className="af-nota">Suerte {suerte.codigo} · {fmtCant(suerte.areaHa)} ha · {suerte.variedad ? `variedad ${suerte.variedad}` : 'sin variedad registrada'}</p>
          {hayCicloAbierto && <p className="af-nota">El corte en curso se cierra con esta fecha.</p>}
        </>
      )}

      {paso === 2 && (
        <div className="af-plan__opciones" role="radiogroup" aria-label="Punto de partida del presupuesto">
          <label className={`af-plan__opcion${origen === 'catalogo' ? ' is-sel' : ''}`}>
            <input type="radio" name="af-plan-origen" checked={origen === 'catalogo'} onChange={() => setOrigen('catalogo')} />
            <span><b>Catálogo de labores</b><small>Las labores y los costos vigentes del catálogo, con las ventanas de su variedad.</small></span>
          </label>
          <label className={`af-plan__opcion${origen === 'anterior' ? ' is-sel' : ''}${anterior ? '' : ' is-off'}`}>
            <input type="radio" name="af-plan-origen" disabled={!anterior} checked={origen === 'anterior'} onChange={() => setOrigen('anterior')} />
            <span><b>Copiar el corte anterior de esta suerte</b>
              <small>{anterior ? `Corte del ${dia(anterior.fechaCorte)}: trae sus costos y pasadas.` : 'Esta suerte todavía no tiene cortes anteriores.'}</small></span>
          </label>
          <label className={`af-plan__opcion${origen === 'otra' ? ' is-sel' : ''}${otrasConCorte.length ? '' : ' is-off'}`}>
            <input type="radio" name="af-plan-origen" disabled={otrasConCorte.length === 0} checked={origen === 'otra'} onChange={() => setOrigen('otra')} />
            <span><b>Copiar de otra suerte de la finca</b>
              <small>{otrasConCorte.length ? 'Trae los costos y pasadas de su corte más reciente.' : 'Ninguna otra suerte de esta finca tiene un corte.'}</small></span>
          </label>
          {origen === 'otra' && (
            <SearchableSelect value={otraId} onChange={setOtraId} placeholder="Escoja la suerte…"
              options={otrasConCorte.map((o) => ({ value: o.id, label: `Suerte ${o.codigo} · ${fmtCant(o.areaHa)} ha${o.variedad ? ` · ${o.variedad}` : ''}` }))} />
          )}
          <p className="af-nota">Las labores y las ventanas de tiempo siempre salen del catálogo y de la variedad de la suerte; copiar solo trae los costos.</p>
        </div>
      )}

      {paso === 3 && (
        <>
          {aviso && <p className="af-nota">{aviso}</p>}
          {lineas.length === 0 ? (
            <p className="feedback error">El catálogo no tiene labores activas que apliquen a un corte de {tipo.toLowerCase()}.</p>
          ) : (
            <div className="af-tabla-wrap">
              <table className="af-tabla af-cat__tabla af-plan__tabla">
                <thead>
                  <tr><th>Labor</th><th>Cantidad</th><th>Servicio</th><th>Ppto por ha</th><th>Pasadas</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.clave}>
                      <td data-label="Labor" className="af-cat__tipo">
                        <b>{nombreLabor(l.labor)}</b>
                        <small>{l.ventanaIdeal != null ? `ideal ≤ ${l.ventanaIdeal} · normal ≤ ${l.ventanaNormal ?? '—'} DDC` : l.repetible ? 'se repite' : 'sin ventana'}{l.variedadFila ? ` · 🌱 ${l.variedadFila}` : ''}</small>
                      </td>
                      <td data-label="Cantidad">{fmtCant(l.cantidad)} {l.unidad}</td>
                      <td data-label="Servicio"><input className="af-plan__in" inputMode="numeric" aria-label={`Servicio de ${l.labor}`} value={String(l.servicio)} onChange={(e) => cambiar(l.clave, { servicio: aNumero(e.target.value) })} /></td>
                      <td data-label="Ppto por ha"><input className="af-plan__in" inputMode="numeric" aria-label={`Ppto por ha de ${l.labor}`} value={String(l.ppto)} onChange={(e) => cambiar(l.clave, { ppto: aNumero(e.target.value) })} /></td>
                      <td data-label="Pasadas" className={l.repetible ? '' : 'af-plan__fija'}>{l.repetible
                        ? <input className="af-plan__in" inputMode="numeric" aria-label={`Pasadas de ${l.labor}`} value={String(l.pasadas)} onChange={(e) => cambiar(l.clave, { pasadas: Math.max(0, Math.round(aNumero(e.target.value))) })} />
                        : <span>1</span>}</td>
                      <td data-label="Total">{totalLinea(l) > 0 ? <b>{fmtPesos(totalLinea(l))}</b> : <span className="af-rojo">sin costo</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="af-fila2 af-fila2--total"><span>Presupuesto del corte<small>{fmtCant(suerte.areaHa)} ha</small></span><b>{fmtPesos(totales.total)}</b></div>
        </>
      )}

      {paso === 4 && (
        <>
          <div className="af-kpis af-kpis--compacto">
            <div className="af-kpi"><b>{fmtPesosCorto(totales.total)}</b><span>Presupuesto del corte</span><small>{plural(lineas.length, 'labor', 'labores')} · {fmtCant(suerte.areaHa)} ha</small></div>
            <div className="af-kpi"><b>{totales.porHa != null ? fmtPesosCorto(totales.porHa) : '—'}</b><span>Por hectárea</span><small>servicio + ppto por ha</small></div>
            <div className="af-kpi"><b>{fmtPesosCorto(totales.servicio)}</b><span>Servicio de AgroMorales</span><small>se cobra al aceptar cada reporte</small></div>
            <div className="af-kpi"><b>{fmtPesosCorto(totales.ppto)}</b><span>Insumos y otros costos</span><small>suma del Ppto por ha</small></div>
          </div>
          {totales.sinCosto > 0 && <p className="af-nota af-rojo">▲ {plural(totales.sinCosto, 'labor sin costo', 'labores sin costo')}: no suman al presupuesto. Puede volver al paso 3 para cargarlo.</p>}
          <CronogramaDDC lineas={lineas} />
          <details className="af-plan__fechas">
            <summary>Ver las fechas de cada labor</summary>
            <ul className="af-plan__crono">
              {hitos.map((h) => (
                <li key={h.linea.clave}>
                  <b>{nombreLabor(h.linea.labor)}{h.linea.variedadFila ? ` ${h.linea.variedadFila}` : ''}</b>
                  <span>{h.ideal ? <>ideal hasta el {dia(h.ideal)}{h.normal ? <small> · normal hasta el {dia(h.normal)}</small> : null}</> : <small>{h.linea.repetible ? 'se repite durante el corte' : 'sin ventana'}</small>}</span>
                </li>
              ))}
            </ul>
          </details>
          <p className="af-nota">
            Fecha del corte: {dia(fecha)} · {tipo === 'SOCA' ? 'soca' : 'plantilla'}.
            {hayCicloAbierto ? ' Al activar, el corte en curso se cierra con esta fecha.' : ''} Hasta aquí no se ha guardado nada.
          </p>
        </>
      )}

      {error && <p className="feedback error" role="alert">{error}</p>}

      <div className="af-acciones af-plan__nav">
        {paso > 1 && <button type="button" className="inline-button" disabled={ocupado} onClick={() => { setError(''); window.history.back() }}>← Atrás</button>}
        {paso < 4
          ? <button type="button" className="primary-button" onClick={siguiente}>Siguiente →</button>
          : <button type="button" className="primary-button" disabled={ocupado || lineas.length === 0} onClick={() => void activar()}>{ocupado ? 'Activando…' : 'Activar corte'}</button>}
      </div>
    </div>
  )
}
