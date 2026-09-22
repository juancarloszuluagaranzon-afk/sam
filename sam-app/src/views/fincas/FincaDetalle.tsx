import { useMemo, useState } from 'react'
import type { CtxFincas } from './FincasView'
import {
  abrirCiclo, anularLabor, anularMovimiento, actualizarLaborPlan, mensajeDeError, registrarMovimiento, subirFotoFinca,
  type TipoCiclo, type TipoMovimiento,
} from '../../services/fincasApi'
import {
  bitacoraFinca, cicloAbiertoDe, cuentaFinca, diasEntre, fmtCant, fmtPesos, fmtPesosCorto,
  laboresDeFinca, presupuestoFinca, resumenParaDueno, type NivelOportunidad,
} from '../../lib/fincas'
import { ingenioNombre } from '../../data/ingenios'
import { fmtFechaHora } from '../../lib/fechas'
import { AccesoDueno } from './AccesoDueno'

type Sub = 'resumen' | 'labores' | 'cuenta' | 'bitacora'

const CHIP: Record<NivelOportunidad, { c: string; t: string }> = {
  ideal: { c: 'af-chip--ok', t: '✓ a tiempo' },
  normal: { c: 'af-chip--ojo', t: '▲ normal' },
  tardia: { c: 'af-chip--mal', t: '⚠ tardía' },
}

/**
 * Una finca, como la vería su dueño. La pestaña «Resumen» ES la vista del dueño:
 * el día, la plata contra lo que aprobó, si se hizo a tiempo, su cuenta y la
 * bitácora — las mismas cifras que usa ASM, no una versión preparada.
 * Con `ctx.modoDueno` es la página que abre el dueño con su enlace: solo lectura,
 * sin volver a la lista, sin editar y sin nada de la administración.
 */
export function FincaDetalle({ ctx, fincaId, onVolver, onEditar }: {
  ctx: CtxFincas; fincaId: string; onVolver: () => void; onEditar: () => void
}) {
  const { datos: d, hoy, esAdmin, token, nombre, recargar, modoDueno } = ctx
  const finca = d.fincas.find((f) => f.id === fincaId)
  const [sub, setSub] = useState<Sub>('resumen')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const filas = useMemo(() => laboresDeFinca(fincaId, d, hoy), [fincaId, d, hoy])
  const p = presupuestoFinca(fincaId, d)
  const cuenta = cuentaFinca(fincaId, d.movimientos)
  const bitacora = useMemo(() => bitacoraFinca(fincaId, d, nombre), [fincaId, d, nombre])
  if (!finca) return <p className="subtle-copy">No se encontró la finca.</p>

  const suertes = d.suertes.filter((s) => s.fincaId === fincaId && s.activa)
  const reportesFinca = d.reportes.filter((r) => filas.some((x) => x.labor.id === r.laborId))
  const aceptadosHoy = reportesFinca.filter((r) => r.estado === 'ACEPTADO' && (r.revisadoEn ?? '').slice(0, 10) === hoy)
  const porAceptar = reportesFinca.filter((r) => r.estado === 'PENDIENTE')
  const haHoy = aceptadosHoy.filter((r) => filas.find((x) => x.labor.id === r.laborId)?.labor.unidad.toLowerCase() === 'ha')
    .reduce((s, r) => s + r.cantidad, 0)
  const enCurso = filas.filter((x) => x.labor.estado === 'EN_CURSO')
  const conVentana = filas.filter((x) => x.oport && x.labor.estado !== 'ANULADA')

  async function hacer(fn: () => Promise<unknown>): Promise<boolean> {
    setOcupado(true); setError('')
    try { await fn(); await recargar(); return true } catch (e) { setError(mensajeDeError(e)); return false } finally { setOcupado(false) }
  }

  const tel = (finca.duenoTelefono ?? '').replace(/\D/g, '')
  const whatsapp = tel ? `https://wa.me/${tel.length === 10 ? `57${tel}` : tel}?text=${encodeURIComponent(resumenParaDueno(finca, d, hoy, nombre))}` : null

  return (
    <div className="af-stack">
      <div className="af-cab">
        <div>
          {!modoDueno && <button type="button" className="af-link" onClick={onVolver}>← Fincas</button>}
          <h2>{finca.nombre}</h2>
          <p className="subtle-copy" style={{ margin: 0 }}>
            Dueño: <b>{finca.duenoNombre}</b>{finca.duenoTelefono ? ` · ${finca.duenoTelefono}` : ''}
            {finca.ingenioId ? ` · entrega a ${ingenioNombre(finca.ingenioId)}` : ''}{finca.municipio ? ` · ${finca.municipio}` : ''}
          </p>
        </div>
        {!modoDueno && <div className="af-acciones">
          {whatsapp && <a className="primary-button" href={whatsapp} target="_blank" rel="noreferrer">Enviar resumen al dueño</a>}
          {esAdmin && <button type="button" className="inline-button" onClick={onEditar}>Editar finca y suertes</button>}
        </div>}
      </div>

      <nav className="af-sub" aria-label="Secciones de la finca">
        {([['resumen', modoDueno ? 'Resumen' : 'Lo que ve el dueño'], ['labores', 'Labores por suerte'], ['cuenta', 'Cuenta'], ['bitacora', 'Bitácora']] as [Sub, string][]).map(([k, t]) => (
          <button key={k} type="button" aria-pressed={sub === k} onClick={() => setSub(k)}>{t}</button>
        ))}
      </nav>
      {error && <p className="feedback error">{error}</p>}

      {sub === 'resumen' && (
        <div className="af-dueno">
          {esAdmin && !modoDueno && <AccesoDueno ctx={ctx} finca={finca} />}
          <div className="af-card">
            <h3>Hoy en su finca</h3>
            <div className="af-fila2"><span>Labores en curso</span><b>{enCurso.length}</b></div>
            {/* Solo se suman hectáreas: un jornal o una hora no son terreno. */}
            <div className="af-fila2"><span>Aceptadas hoy</span><b>{aceptadosHoy.length}{haHoy > 0 ? ` · ${fmtCant(haHoy)} ha` : ''}</b></div>
            <div className="af-fila2"><span>Reportes por aceptar</span><b>{porAceptar.length}</b></div>
          </div>
          <div className="af-card">
            <h3>El ciclo contra lo presupuestado</h3>
            <p className="af-grande">{fmtPesosCorto(p.ejecutado)} <span>de {p.presupuesto > 0 ? fmtPesosCorto(p.presupuesto) : 'sin presupuesto'}</span></p>
            <span className="af-barra" aria-hidden="true"><i style={{ width: `${Math.min(100, p.pct ?? 0)}%` }} /></span>
            <div className="af-fila2"><span>Ejecutado del presupuesto</span><b>{p.pct != null ? `${p.pct} %` : '—'}</b></div>
            {p.sinCosto > 0 && <p className="af-nota">▲ {p.sinCosto} labor{p.sinCosto === 1 ? '' : 'es'} sin costo: no suman al presupuesto.</p>}
          </div>
          <div className="af-card">
            <h3>¿A tiempo?</h3>
            {conVentana.length === 0 ? <p className="af-nota">Sin labores con ventana en los ciclos abiertos.</p> : conVentana.slice(0, 8).map((x) => (
              <div key={x.labor.id} className="af-fila2">
                <span>{x.labor.labor.toLowerCase()} · suerte {x.suerte.codigo} <small>{x.oport!.hecha ? `hecha a los ${x.oport!.ddc} días` : `${x.oport!.ddc} días del corte, sin hacer`}</small></span>
                <span className={`af-chip ${CHIP[x.oport!.nivel].c}`}>{CHIP[x.oport!.nivel].t}</span>
              </div>
            ))}
          </div>
          <div className="af-card">
            <h3>Su cuenta</h3>
            <div className="af-fila2"><span>Anticipos girados</span><b>{fmtPesos(cuenta.anticipos)}</b></div>
            <div className="af-fila2"><span>Gastado con soporte</span><b>{fmtPesos(cuenta.gastos)}</b></div>
            {cuenta.honorarios > 0 && <div className="af-fila2"><span>Honorarios de administración</span><b>{fmtPesos(cuenta.honorarios)}</b></div>}
            <div className="af-fila2 af-fila2--total"><span>{cuenta.saldo >= 0 ? 'Saldo a su favor' : 'Saldo por girar'}</span><b className={cuenta.saldo < 0 ? 'af-rojo' : ''}>{fmtPesos(Math.abs(cuenta.saldo))}</b></div>
          </div>
          <div className="af-card af-card--ancha">
            <h3>Bitácora</h3>
            <Bitacora eventos={bitacora.slice(0, 6)} />
            {bitacora.length > 6 && <button type="button" className="af-link" onClick={() => setSub('bitacora')}>Ver toda la bitácora ({bitacora.length}) →</button>}
          </div>
        </div>
      )}

      {sub === 'labores' && (
        <div className="af-stack">
          {suertes.length === 0 && <p className="subtle-copy">Esta finca no tiene suertes. {esAdmin && 'Agréguelas en «Editar finca y suertes».'}</p>}
          {suertes.map((s) => {
            const ciclo = cicloAbiertoDe(s.id, d.ciclos)
            const propias = filas.filter((x) => x.suerte.id === s.id)
            return (
              <div key={s.id} className="af-card">
                <div className="af-cab af-cab--chica">
                  <div>
                    <h3>Suerte {s.codigo} <small className="subtle-copy">{fmtCant(s.areaHa)} ha{s.variedad ? ` · ${s.variedad}` : ''}</small></h3>
                    <p className="af-nota" style={{ margin: 0 }}>
                      {ciclo ? `Ciclo ${ciclo.tipo.toLowerCase()} desde el corte del ${ciclo.fechaCorte} · ${diasEntre(ciclo.fechaCorte, hoy)} días` : 'Sin ciclo abierto'}
                    </p>
                  </div>
                  {esAdmin && <AbrirCiclo hayCiclo={!!ciclo} ocupado={ocupado}
                    onAbrir={(fecha, tipo) => hacer(() => abrirCiclo(s.id, fecha, tipo, token))} />}
                </div>
                {propias.length > 0 && (
                  <div className="af-tabla-wrap">
                    <table className="af-tabla">
                      <thead><tr><th>Labor</th><th>Avance</th><th>Presupuesto</th><th>¿A tiempo?</th><th>Estado</th>{esAdmin && <th />}</tr></thead>
                      <tbody>
                        {propias.map((x) => (
                          <tr key={x.labor.id} className={x.labor.estado === 'ANULADA' ? 'af-anulada' : ''}>
                            <td><b>{x.labor.labor.toLowerCase()}</b><small>{fmtCant(x.labor.cantidadPlan)} {x.labor.unidad}</small></td>
                            <td>
                              <span className="af-barra af-barra--chica" aria-hidden="true"><i style={{ width: `${x.avance.pct}%` }} /></span>
                              <small>{fmtCant(x.avance.aceptado)} aceptado{x.avance.porAceptar ? ` · ${fmtCant(x.avance.porAceptar)} por aceptar` : ''}</small>
                            </td>
                            <td>{x.labor.costoUnitarioPlan > 0 ? fmtPesosCorto(x.labor.cantidadPlan * x.labor.costoUnitarioPlan) : <span className="af-rojo">sin costo</span>}
                              <small>{x.labor.costoUnitarioPlan > 0 ? `${fmtPesos(x.labor.costoUnitarioPlan)} / ${x.labor.unidad}` : ''}</small></td>
                            <td>{x.oport ? <span className={`af-chip ${CHIP[x.oport.nivel].c}`}>{CHIP[x.oport.nivel].t}</span> : <small>sin ventana</small>}</td>
                            <td><small>{x.labor.estado === 'ANULADA' ? `anulada: ${x.labor.anuladaMotivo}` : x.labor.estado.replace('_', ' ').toLowerCase()}</small></td>
                            {esAdmin && (
                              <td className="af-td-acc">
                                {x.labor.estado !== 'ANULADA' && x.labor.estado !== 'TERMINADA' && (
                                  <>
                                    <button type="button" className="af-link" disabled={ocupado} onClick={() => {
                                      const v = window.prompt(`Costo por ${x.labor.unidad} de ${x.labor.labor.toLowerCase()} (suerte ${s.codigo}):`, String(x.labor.costoUnitarioPlan || ''))
                                      const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'))
                                      if (v != null && Number.isFinite(n) && n >= 0) void hacer(() => actualizarLaborPlan(x.labor.id, { costoUnitarioPlan: n }, token))
                                    }}>Costo</button>
                                    <button type="button" className="af-link" disabled={ocupado} onClick={() => {
                                      const m = window.prompt('¿Por qué se anula esta labor? (queda registrado)')
                                      if (m && m.trim()) void hacer(() => anularLabor(x.labor.id, m, token))
                                    }}>Anular</button>
                                  </>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {sub === 'cuenta' && (
        <div className="af-stack">
          <div className="af-kpis">
            <div className="af-kpi"><b>{fmtPesosCorto(cuenta.anticipos)}</b><span>anticipos</span></div>
            <div className="af-kpi"><b>{fmtPesosCorto(cuenta.gastos)}</b><span>gastos con soporte</span></div>
            <div className="af-kpi"><b>{fmtPesosCorto(cuenta.honorarios)}</b><span>honorarios</span></div>
            <div className={`af-kpi${cuenta.saldo < 0 ? ' af-kpi--mal' : ''}`}><b>{fmtPesosCorto(cuenta.saldo)}</b><span>saldo</span></div>
          </div>
          {esAdmin && <NuevoMovimiento ocupado={ocupado} suertes={suertes.map((s) => ({ id: s.id, codigo: s.codigo }))} hoy={hoy}
            onGuardar={(m) => hacer(() => registrarMovimiento({ ...m, fincaId }, token))} onError={setError} />}
          <div className="af-card">
            <h3>Movimientos</h3>
            <ul className="af-lista">
              {d.movimientos.filter((m) => m.fincaId === fincaId).map((m) => (
                <li key={m.id} className={`af-mov${m.anulado ? ' af-anulada' : ''}`}>
                  {m.soporteUrl ? <a href={m.soporteUrl} target="_blank" rel="noreferrer"><img className="af-foto" src={m.soporteUrl} alt="soporte" loading="lazy" /></a> : <span className="af-foto af-foto--vacia">sin soporte</span>}
                  <span>
                    <b>{m.tipo === 'ANTICIPO' ? 'Anticipo' : m.tipo === 'HONORARIO' ? 'Honorario' : 'Gasto'}</b> · {m.concepto}
                    <small>{m.fecha} · {nombre(m.registradoPor)}{m.reporteId ? ' · por labor aceptada' : ''}{m.anulado ? ` · ANULADO por ${nombre(m.anuladoPor ?? '')}: ${m.anuladoMotivo}` : ''}</small>
                  </span>
                  <span className={`af-valor${m.tipo === 'ANTICIPO' ? ' af-valor--entra' : ''}`}>{m.tipo === 'ANTICIPO' ? '+' : '−'}{fmtPesos(m.valor)}</span>
                  {esAdmin && !m.anulado && (
                    <button type="button" className="af-link" disabled={ocupado} onClick={() => {
                      const mo = window.prompt('¿Por qué se anula? El movimiento no se borra: queda anulado con este motivo.')
                      if (mo && mo.trim()) void hacer(() => anularMovimiento(m.id, mo, token))
                    }}>Anular</button>
                  )}
                </li>
              ))}
              {d.movimientos.filter((m) => m.fincaId === fincaId).length === 0 && <li className="af-nota">Sin movimientos todavía.</li>}
            </ul>
          </div>
        </div>
      )}

      {sub === 'bitacora' && (
        <div className="af-card">
          <h3>Bitácora completa</h3>
          <p className="af-nota">Cada reporte de campo y cada movimiento de plata, en orden. Nada se borra: lo anulado aparece como anulado.</p>
          <Bitacora eventos={bitacora} />
        </div>
      )}
    </div>
  )
}

function Bitacora({ eventos }: { eventos: ReturnType<typeof bitacoraFinca> }) {
  if (!eventos.length) return <p className="af-nota">Todavía no hay movimientos.</p>
  return (
    <ul className="af-lista">
      {eventos.map((e) => (
        <li key={e.id} className="af-mov">
          {e.foto ? <a href={e.foto} target="_blank" rel="noreferrer"><img className="af-foto" src={e.foto} alt="evidencia" loading="lazy" /></a> : <span className="af-foto af-foto--vacia">—</span>}
          <span><b>{e.titulo}</b><small>{fmtFechaHora(e.cuando)} · {e.detalle}</small></span>
          <span className={`af-chip ${e.estado === 'ACEPTADO' || e.estado === 'ANTICIPO' ? 'af-chip--ok' : e.estado === 'PENDIENTE' ? 'af-chip--ojo' : e.estado === 'RECHAZADO' || e.estado === 'ANULADO' ? 'af-chip--mal' : 'af-chip--neutro'}`}>
            {e.estado.toLowerCase()}
          </span>
        </li>
      ))}
    </ul>
  )
}

function AbrirCiclo({ hayCiclo, ocupado, onAbrir }: { hayCiclo: boolean; ocupado: boolean; onAbrir: (fecha: string, tipo: TipoCiclo) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [fecha, setFecha] = useState('')
  const [tipo, setTipo] = useState<TipoCiclo>('SOCA')
  if (!abierto) return <button type="button" className="inline-button" onClick={() => setAbierto(true)}>{hayCiclo ? 'Registrar nuevo corte' : 'Abrir ciclo'}</button>
  return (
    <div className="af-mini-form">
      <label>Fecha del corte<input id="af-fecha-corte" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      <label>Tipo
        <select id="af-tipo-ciclo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoCiclo)}>
          <option value="SOCA">Soca</option><option value="PLANTILLA">Plantilla</option>
        </select>
      </label>
      {hayCiclo && <small className="af-nota">El ciclo actual se cierra con esta fecha.</small>}
      <div className="af-acciones">
        <button type="button" className="primary-button" disabled={!fecha || ocupado} onClick={() => { onAbrir(fecha, tipo); setAbierto(false) }}>Abrir ciclo</button>
        <button type="button" className="inline-button" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </div>
  )
}

function NuevoMovimiento({ ocupado, suertes, hoy, onGuardar, onError }: {
  ocupado: boolean; suertes: { id: string; codigo: string }[]; hoy: string
  onGuardar: (m: { tipo: TipoMovimiento; fecha: string; concepto: string; valor: number; suerteId: string | null; soporteUrl: string | null }) => Promise<boolean>
  onError: (m: string) => void
}) {
  const [tipo, setTipo] = useState<TipoMovimiento>('ANTICIPO')
  const [fecha, setFecha] = useState(hoy)
  const [concepto, setConcepto] = useState('')
  const [valor, setValor] = useState('')
  const [suerteId, setSuerteId] = useState('')
  const [soporte, setSoporte] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const n = Number(valor.replace(/\./g, '').replace(',', '.'))
  const faltaSoporte = tipo === 'GASTO' && !soporte

  return (
    <div className="af-card">
      <h3>Registrar en la cuenta</h3>
      <div className="af-form">
        <label>Tipo
          <select id="af-mov-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimiento)}>
            <option value="ANTICIPO">Anticipo del dueño (entra)</option>
            <option value="GASTO">Gasto (sale, con soporte)</option>
            <option value="HONORARIO">Honorario de administración (sale)</option>
          </select>
        </label>
        <label>Fecha<input id="af-mov-fecha" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="af-form__ancho">Concepto<input id="af-mov-concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder={tipo === 'ANTICIPO' ? 'Transferencia del dueño' : 'Ej.: compra de herbicida'} /></label>
        <label>Valor (pesos)<input id="af-mov-valor" inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" /></label>
        {tipo === 'GASTO' && (
          <label>Suerte (opcional)
            <select id="af-mov-suerte" value={suerteId} onChange={(e) => setSuerteId(e.target.value)}>
              <option value="">Toda la finca</option>
              {suertes.map((s) => <option key={s.id} value={s.id}>Suerte {s.codigo}</option>)}
            </select>
          </label>
        )}
        <label className="af-form__ancho">Soporte {tipo === 'GASTO' ? '(obligatorio: factura o remisión)' : '(opcional: foto de la consignación)'}
          <input id="af-mov-soporte" type="file" accept="image/*" disabled={subiendo} onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setSubiendo(true)
            try { setSoporte(await subirFotoFinca(f, 'soportes')) } catch (er) { onError(`No se pudo subir el soporte: ${(er as Error).message}`) } finally { setSubiendo(false) }
          }} />
          {subiendo ? <small>Subiendo…</small> : soporte ? <small>✓ soporte cargado</small> : null}
        </label>
      </div>
      <div className="af-acciones">
        <button type="button" className="primary-button"
                disabled={ocupado || subiendo || !concepto.trim() || !(n > 0) || faltaSoporte}
                onClick={async () => {
                  // Si la base lo rechaza, el formulario se queda lleno para corregir.
                  if (await onGuardar({ tipo, fecha, concepto, valor: n, suerteId: suerteId || null, soporteUrl: soporte })) {
                    setConcepto(''); setValor(''); setSoporte(null); setSuerteId('')
                  }
                }}>
          Registrar {n > 0 ? fmtPesos(n) : ''}
        </button>
        {faltaSoporte && <small className="af-nota">Un gasto sin soporte no entra: así lo ve el dueño.</small>}
      </div>
    </div>
  )
}
