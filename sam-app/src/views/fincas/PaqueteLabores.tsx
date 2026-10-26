import { useEffect, useState } from 'react'
import type { CtxFincas } from './FincasView'
import { cargarReferencias, guardarPaquete, mensajeDeError, type LaborPaquete, type RubroCosto } from '../../services/fincasApi'
import { fmtPesos, fmtPesosCorto, RUBROS, VER_PLATA } from '../../lib/fincas'
import { agruparCatalogo, costoReferenciaPorHa, resumenCatalogo, sinCosto, totalPorHa } from '../../lib/catalogoFincas'
import { Ayuda } from '../../components/Ayuda'
import { useCapaAtras } from '../../lib/atras'

/**
 * El paquete de labores: la plantilla con la que nace cada ciclo. Costo por
 * unidad y ventana de oportunidad (días desde el corte). Cambiarlo NO toca los
 * ciclos ya abiertos: cada ciclo guarda su propio presupuesto, que es el que el
 * dueño aprobó.
 */

/** «ROTURACIÓN» → «Roturación»: el catálogo se digita en mayúscula; el título de la tarjeta no la repite. */
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

const APLICA: Record<LaborPaquete['aplica'], string> = { AMBOS: 'Soca y plantilla', SOCA: 'Soca', PLANTILLA: 'Plantilla' }

/** Ventana en DDC (días después del corte). Las que se repiten (riego, malezas) no llevan ventana a propósito: no es un faltante. */
function celdaVentana(p: LaborPaquete) {
  const { ventanaIdeal: ideal, ventanaNormal: normal } = p
  if (p.repetible) {
    const pasadas = Math.max(1, Number(p.pasadasPlan) || 1)
    return <><b>Se repite</b><small>{pasadas} {pasadas === 1 ? 'pasada' : 'pasadas'}</small></>
  }
  if (ideal != null && normal != null) return <><b>ideal ≤ {ideal}</b><small>normal ≤ {normal}</small></>
  if (ideal != null || normal != null) return <small>falta la {ideal == null ? 'ideal' : 'normal'}</small>
  return <small>sin ventana</small>
}

/** «—» cuando la cifra es cero: un cero grande en la columna parece un dato y no una falta. */
const pesosOGuion = (v: number | undefined) => ((Number(v) || 0) > 0 ? fmtPesos(Number(v)) : '—')

export function PaqueteLabores({ ctx }: { ctx: CtxFincas }) {
  const { datos: d, token, recargar, esAdmin } = ctx
  const [editando, setEditando] = useState<Partial<LaborPaquete> & { labor: string } | null>(null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  // «Atrás» del celular cierra el editor abierto (como Cancelar) en vez de sacar de la app; mientras guarda, no cierra.
  useCapaAtras(editando !== null, () => { if (!guardando) setEditando(null) })
  // El rubro de cada labor es un dato de `af_config` (referencias del gremio): si no llega,
  // el catálogo se dibuja igual, solo que sin chip de rubro.
  const [rubros, setRubros] = useState<Record<string, RubroCosto>>({})
  useEffect(() => {
    let vivo = true
    cargarReferencias()
      .then((r) => { if (vivo && r) setRubros(r.rubroPorLabor) })
      .catch(() => { /* sin referencias se dibuja sin rubros */ })
    return () => { vivo = false }
  }, [])
  if (!esAdmin) return <p className="subtle-copy">Solo administración edita el catálogo de labores.</p>

  async function guardar() {
    if (!editando) return
    if (editando.repetible && (!Number.isInteger(editando.pasadasPlan) || (editando.pasadasPlan ?? 0) < 1)) {
      setError('Las pasadas presupuestadas deben ser un entero mayor o igual a 1.')
      return
    }
    setGuardando(true); setError('')
    try { await guardarPaquete(editando, token); setEditando(null); await recargar() }
    catch (e) { setError(mensajeDeError(e)) } finally { setGuardando(false) }
  }
  const nulo = (v: string) => (v.trim() === '' ? null : Number(v))
  // El formulario vive arriba de la lista: al abrirlo desde una fila de abajo hay que llevar la vista hasta él.
  const abrirEditor = (x: Partial<LaborPaquete> & { labor: string }) => {
    setEditando(x)
    requestAnimationFrame(() => document.getElementById('af-p-labor')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }
  const hayFilas = (d.paquete ?? []).length > 0
  const resumen = resumenCatalogo(d.paquete)
  const grupos = agruparCatalogo(d.paquete, rubros)
  const referencia = costoReferenciaPorHa(d.paquete, 'SOCA')

  return (
    <div className="af-stack">
      <div className="af-cab">
        <div><p className="eyebrow">Plantilla</p><h2>Catálogo de labores</h2></div>
        <button type="button" className="primary-button" onClick={() => setEditando({ labor: '', unidad: 'ha', cantidadPorHa: 1, costoUnitario: 0, costoAparteUnitario: 0, pasadasPlan: 1, aplica: 'AMBOS', orden: 100, activa: true, repetible: false })}>+ Labor</button>
      </div>
      <Ayuda>Con esto nace cada corte: sus labores, su costo y hasta qué día después del corte (DDC) están a tiempo. Una labor puede tener una ventana distinta por variedad: esa fila manda para las suertes de esa variedad. Cambiar el catálogo no toca los cortes en curso.</Ayuda>
      {error && <p className="feedback error">{error}</p>}

      {editando && (
        <div className="af-card">
          <h3>{editando.id ? `Editar ${editando.labor}` : 'Nueva labor'}</h3>
          <div className="af-form">
            <label>Labor<input id="af-p-labor" value={editando.labor} onChange={(e) => setEditando({ ...editando, labor: e.target.value })} /></label>
            <label>Unidad
              <select id="af-p-unidad" value={editando.unidad ?? 'ha'} onChange={(e) => setEditando({ ...editando, unidad: e.target.value })}>
                <option value="ha">Hectárea</option><option value="jornal">Jornal</option><option value="h">Hora</option><option value="kg">Kilo</option><option value="gal">Galón</option>
              </select>
            </label>
            <label>Cantidad por hectárea<input id="af-p-cxha" inputMode="decimal" value={String(editando.cantidadPorHa ?? 1)} onChange={(e) => setEditando({ ...editando, cantidadPorHa: Number(e.target.value.replace(',', '.')) || 1 })} /></label>
            {VER_PLATA && <>
              <label>Tarifa del servicio por unidad (pesos)<input id="af-p-costo" inputMode="numeric" value={String(editando.costoUnitario ?? 0)} onChange={(e) => setEditando({ ...editando, costoUnitario: Number(e.target.value.replace(/\./g, '')) || 0 })} /></label>
              <label>Ppto por {editando.unidad || 'ha'} y pasada (pesos)<input id="af-p-aparte" inputMode="numeric" value={String(editando.costoAparteUnitario ?? 0)} onChange={(e) => setEditando({ ...editando, costoAparteUnitario: Number(e.target.value.replace(/\./g, '')) || 0 })} /><small className="af-nota">Insumos, agua o mano de obra. Entra al presupuesto; no se cobra al aceptar el reporte.</small></label>
            </>}
            <label>A tiempo hasta (días del corte)<input id="af-p-vi" inputMode="numeric" value={editando.ventanaIdeal ?? ''} onChange={(e) => setEditando({ ...editando, ventanaIdeal: nulo(e.target.value) })} placeholder="sin ventana" /></label>
            <label>Tardía después de (días)<input id="af-p-vn" inputMode="numeric" value={editando.ventanaNormal ?? ''} onChange={(e) => setEditando({ ...editando, ventanaNormal: nulo(e.target.value) })} placeholder="sin ventana" /></label>
            <label>Aplica a
              <select id="af-p-aplica" value={editando.aplica ?? 'AMBOS'} onChange={(e) => setEditando({ ...editando, aplica: e.target.value as LaborPaquete['aplica'] })}>
                <option value="AMBOS">Soca y plantilla</option><option value="SOCA">Solo soca</option><option value="PLANTILLA">Solo plantilla</option>
              </select>
            </label>
            {/* Ventana POR VARIEDAD (17-oct-2026): una fila con variedad manda sobre la genérica
                para las suertes de esa variedad; las demás siguen con la genérica. */}
            <label>Variedad (opcional)
              <input id="af-p-variedad" value={editando.variedad ?? ''} autoCapitalize="characters"
                     onChange={(e) => setEditando({ ...editando, variedad: e.target.value.toUpperCase() })}
                     placeholder="todas · ej. CC 01-1940" />
            </label>
            <label>Orden<input id="af-p-orden" inputMode="numeric" value={String(editando.orden ?? 100)} onChange={(e) => setEditando({ ...editando, orden: Number(e.target.value) || 100 })} /></label>
            <label className="af-form__ancho af-check">
              <input id="af-p-repetible" type="checkbox" checked={!!editando.repetible} onChange={(e) => setEditando({ ...editando, repetible: e.target.checked, ...(!e.target.checked ? { pasadasPlan: 1 } : {}) })} />
              Se hace varias veces en el corte (riego, malezas): cada pasada se reporta aparte y la labor no se cierra sola
            </label>
            {editando.repetible && <label>Pasadas presupuestadas<input id="af-p-pasadas" inputMode="numeric" value={String(editando.pasadasPlan ?? 1)} onChange={(e) => setEditando({ ...editando, pasadasPlan: Number(e.target.value) })} /></label>}
          </div>
          <div className="af-acciones">
            <button type="button" className="primary-button" disabled={guardando || !editando.labor.trim()} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="inline-button" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {!hayFilas ? (
        <div className="af-card af-vacio">
          <h3>Todavía no hay labores</h3>
          <p className="af-nota">Cree la primera con «+ Labor». Sin catálogo, cada corte nuevo nace sin presupuesto.</p>
        </div>
      ) : (
        <>
          <div className="af-kpis af-kpis--compacto">
            <div className="af-kpi">
              <b>{resumen.laboresActivas}</b>
              <span>Labores activas</span>
              <small>{resumen.filasActivas} {resumen.filasActivas === 1 ? 'fila' : 'filas'} con variedades y tipos de corte</small>
            </div>
            <div className={`af-kpi${resumen.filasSinCosto > 0 ? ' af-kpi--mal' : ''}`}>
              <b>{resumen.filasSinCosto}</b>
              <span>Sin costo</span>
              <small>no suman al presupuesto</small>
            </div>
            <div className={`af-kpi${resumen.filasSinVentana > 0 ? ' af-kpi--ojo' : ''}`}>
              <b>{resumen.filasSinVentana}</b>
              <span>Sin ventana</span>
              <small>falta ideal o normal en DDC</small>
            </div>
            {VER_PLATA && (
              <div className="af-kpi">
                <b>{fmtPesosCorto(referencia.total)}</b>
                <span>Costo de referencia por ha</span>
                <small>corte de soca · labores genéricas</small>
              </div>
            )}
          </div>

          {grupos.map((g) => {
            const rubroId = g.rubro
            const rubro = rubroId ? RUBROS.find((r) => r.id === rubroId)?.nombre ?? null : null
            return (
              <div key={g.labor} className="af-card">
                <div className="af-cat__cab">
                  <h3>{capitalizar(g.labor)}</h3>
                  {rubro && <span className="af-chip af-chip--neutro">{rubro}</span>}
                  {g.sinCosto > 0 && <span className="af-chip af-chip--mal">{g.sinCosto} sin costo</span>}
                  <small>{g.activas} {g.activas === 1 ? 'fila activa' : 'filas activas'}</small>
                </div>
                <div className="af-tabla-wrap">
                  <table className="af-tabla af-cat__tabla">
                    <thead>
                      <tr>
                        <th>Tipo y variedad</th><th>Ventana (DDC)</th>
                        {VER_PLATA && <><th>Servicio</th><th>Ppto por ha</th><th>Total por ha</th></>}
                        <th><span className="af-cat__solo-lector">Acciones</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.filas.map((p) => (
                        <tr key={p.id} className={p.activa ? '' : 'af-anulada'}>
                          <td data-label="Tipo y variedad" className="af-cat__tipo">
                            <b>{APLICA[p.aplica]}</b>
                            <small>{p.variedad ? `🌱 ${p.variedad}` : 'Todas las variedades'}</small>
                            {!p.activa && <span className="af-chip af-chip--neutro">Inactiva</span>}
                          </td>
                          <td data-label="Ventana (DDC)">{celdaVentana(p)}</td>
                          {VER_PLATA && <>
                            <td data-label="Servicio">{pesosOGuion(p.costoUnitario)}<small>/ {p.unidad}</small></td>
                            <td data-label="Ppto por ha">{pesosOGuion(p.costoAparteUnitario)}</td>
                            <td data-label="Total por ha">{sinCosto(p) ? <span className="af-rojo">sin costo</span> : <b>{fmtPesos(totalPorHa(p))}</b>}</td>
                          </>}
                          <td className="af-td-acc af-cat__acc">
                            <button type="button" className="af-link" onClick={() => abrirEditor({ ...p })}>Editar</button>
                            <button type="button" className="af-link" onClick={() => abrirEditor({ ...p, id: undefined, activa: true })}>Duplicar</button>
                            <button type="button" className="af-link" onClick={async () => {
                              try { await guardarPaquete({ ...p, activa: !p.activa }, token); await recargar() } catch (e) { setError(mensajeDeError(e)) }
                            }}>{p.activa ? 'Desactivar' : 'Activar'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
