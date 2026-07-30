import { useMemo, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { useTaller } from './TallerContext'
import { savePlan, deletePlan, crearOrden } from '../../services/tallerApi'
import { SearchableSelect } from '../../components/SearchableSelect'
import { vencimientosDe } from '../../lib/indicadores'
import type { MttoPlan } from '../../domain/sam'

/**
 * Plan preventivo — se dispara por HORÓMETRO.
 *
 * Es maquinaria: el desgaste va por uso, no por calendario. Un plan se define
 * para una máquina puntual o para un MODELO, y en ese caso aplica solo a las
 * máquinas de ese modelo — así no hay que repetir "cambio de aceite cada 250 h"
 * veinte veces.
 *
 * Lo vencido va arriba. Un tablero de preventivo que hay que leer entero para
 * saber qué corre prisa no sirve de nada.
 */

const nf = (v: number, d = 0) => v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })

export function PreventivoTab() {
  const { equipment, session, busy, setBusy, setError, setInfo } = useAppData()
  const { planes, horasDe, refrescar } = useTaller()

  const [editar, setEditar] = useState<Partial<MttoPlan> | null>(null)
  const [verTodo, setVerTodo] = useState(false)

  const equiposMin = useMemo(
    () => equipment.map((e) => ({ codigo: e.code, marca: undefined, modelo: undefined })),
    [equipment],
  )

  const vencimientos = useMemo(
    () => vencimientosDe(planes, horasDe, equiposMin),
    [planes, horasDe, equiposMin],
  )

  const urgentes = useMemo(
    () => vencimientos.filter((v) => v.estado === 'VENCIDO' || v.estado === 'PROXIMO'),
    [vencimientos],
  )
  const visibles = verTodo ? vencimientos : urgentes

  async function guardar() {
    if (!editar?.tarea?.trim()) { setError('Escribe la tarea.'); return }
    if (!editar.cadaHoras || editar.cadaHoras <= 0) { setError('Escribe cada cuántas horas se hace.'); return }
    if (!editar.equipoCodigo && !editar.modelo && !editar.marca) {
      setError('Elige a qué máquina o a qué modelo aplica.'); return
    }
    setBusy(true); setError('')
    try {
      await savePlan({ ...editar, tarea: editar.tarea })
      setInfo('Plan guardado.')
      setEditar(null)
      await refrescar()
    } catch (err) {
      setError(`No se pudo guardar. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function generarOt(codigo: string, plan: MttoPlan, horometro: number) {
    setBusy(true); setError('')
    try {
      await crearOrden({
        equipoCodigo: codigo,
        tipo: 'PREVENTIVO',
        descripcion: plan.tarea,
        horometro,
        planId: plan.id,
        // Un preventivo programado no siempre saca la máquina de servicio; el
        // paro se marca a mano en la orden si de verdad quedó parada.
        responsable: session?.name,
        creadoPor: session?.id,
        creadoNombre: session?.name,
      })
      setInfo(`Orden preventiva creada para ${codigo}.`)
      await refrescar()
    } catch (err) {
      setError(`No se pudo crear. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <div className="bod-head">
        <h2 className="bod-head__title">🗓️ Mantenimiento preventivo</h2>
        <button type="button" className="primary-button bod-head__btn"
          onClick={() => { setEditar({ avisarAntesHoras: 50, activo: true }); setError('') }} disabled={busy}>
          + Nuevo plan
        </button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Cada tarea se programa por horas de máquina. Lo vencido va de primero.
      </p>

      {visibles.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 12 }}>
          {planes.length === 0
            ? 'Todavía no hay planes. Crea el primero: por ejemplo "Cambio de aceite motor" cada 250 h.'
            : 'Nada vencido ni próximo. Todo al día.'}
        </p>
      ) : (
        <div className="inv-list" style={{ marginTop: 12 }}>
          {visibles.map((v) => (
            <div key={`${v.plan.id}-${v.equipoCodigo}`} className={`taller-venc taller-venc--${v.estado.toLowerCase()}`}>
              <div className="taller-venc__main">
                <div className="aval-row__top">
                  <strong>{v.equipoCodigo}</strong>
                  <span className={`aval-tag aval-tag--${v.estado === 'VENCIDO' ? 'vehiculo' : v.estado === 'PROXIMO' ? 'maquina' : 'carro'}`}>
                    {v.estado === 'VENCIDO' ? '🔴 Vencido'
                      : v.estado === 'PROXIMO' ? '🟡 Próximo'
                      : v.estado === 'SIN_LECTURA' ? '⚪ Sin lectura' : '🟢 Al día'}
                  </span>
                </div>
                <span className="subtle-copy">{v.plan.tarea} · cada {nf(v.plan.cadaHoras ?? 0)} h</span>
                <span className="subtle-copy">
                  {v.estado === 'SIN_LECTURA'
                    ? 'Esta máquina no tiene lectura de horómetro'
                    : v.faltan <= 0
                      ? `Pasado por ${nf(Math.abs(v.faltan))} h · toca a las ${nf(v.proximaEn)} h (va en ${nf(v.horometro)})`
                      : `Faltan ${nf(v.faltan)} h · toca a las ${nf(v.proximaEn)} h (va en ${nf(v.horometro)})`}
                </span>
              </div>
              {v.estado !== 'SIN_LECTURA' && (
                <button type="button" className="inline-button" disabled={busy}
                  onClick={() => void generarOt(v.equipoCodigo, v.plan, v.horometro)}>
                  Generar orden
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {vencimientos.length > urgentes.length && (
        <div className="dash-vertodo">
          <span className="dash-vertodo__res">
            {visibles.length} de {vencimientos.length} · {urgentes.length} requieren atención
          </span>
          <button type="button" className="dash-vertodo__btn" onClick={() => setVerTodo(!verTodo)}>
            {verTodo ? 'Solo lo urgente' : `Mostrar todos (${vencimientos.length})`}
          </button>
        </div>
      )}

      <p className="ins-res__lbl" style={{ marginTop: 16 }}>Planes definidos ({planes.filter((p) => p.activo).length})</p>
      <div className="inv-list">
        {planes.filter((p) => p.activo).map((p) => (
          <div key={p.id} className="inv-row">
            <div className="inv-row__main">
              <strong>{p.tarea}</strong>
              <span className="subtle-copy">
                cada {nf(p.cadaHoras ?? 0)} h · avisa {nf(p.avisarAntesHoras)} h antes ·{' '}
                {p.equipoCodigo ? `solo ${p.equipoCodigo}` : `modelo ${[p.marca, p.modelo].filter(Boolean).join(' ')}`}
              </span>
            </div>
            <div className="inv-row__actions">
              <button type="button" className="inline-button" onClick={() => setEditar(p)} disabled={busy}>Editar</button>
              <button type="button" className="inline-button" disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try { await deletePlan(p.id); await refrescar(); setInfo('Plan desactivado.') }
                  catch { setError('No se pudo') } finally { setBusy(false) }
                }}>Quitar</button>
            </div>
          </div>
        ))}
      </div>

      {editar && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setEditar(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Preventivo</p><h3>{editar.id ? 'Editar plan' : 'Nuevo plan'}</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEditar(null)} disabled={busy}>&#x2715;</button>
            </div>
            <label>Tarea <span style={{ color: '#b3261e' }}>*</span>
              <input type="text" value={editar.tarea ?? ''} placeholder="Cambio de aceite motor"
                onChange={(e) => setEditar({ ...editar, tarea: e.target.value })} disabled={busy} />
            </label>
            <div className="flota-grid" style={{ marginTop: 8 }}>
              <label>Cada cuántas horas <span style={{ color: '#b3261e' }}>*</span>
                <input type="number" min={1} step="any" value={editar.cadaHoras ?? ''} placeholder="250"
                  onChange={(e) => setEditar({ ...editar, cadaHoras: Number(e.target.value) })} disabled={busy} />
              </label>
              <label>Avisar cuántas horas antes
                <input type="number" min={0} step="any" value={editar.avisarAntesHoras ?? 50}
                  onChange={(e) => setEditar({ ...editar, avisarAntesHoras: Number(e.target.value) })} disabled={busy} />
              </label>
            </div>

            <p className="tq-lbl">¿A qué aplica?</p>
            <label>Una máquina puntual
              <SearchableSelect value={editar.equipoCodigo ?? ''}
                onChange={(v) => setEditar({ ...editar, equipoCodigo: v, marca: undefined, modelo: undefined })}
                options={equipment.map((e) => ({ value: e.code, label: e.code, rightLabel: e.name }))}
                placeholder="Buscar máquina…" disabled={busy} />
            </label>
            <p className="subtle-copy" style={{ margin: '6px 0' }}>…o a todas las de un modelo:</p>
            <div className="flota-grid">
              <label>Marca
                <input type="text" value={editar.marca ?? ''} placeholder="CASE"
                  onChange={(e) => setEditar({ ...editar, marca: e.target.value, equipoCodigo: undefined })} disabled={busy} />
              </label>
              <label>Modelo
                <input type="text" value={editar.modelo ?? ''} placeholder="JX95"
                  onChange={(e) => setEditar({ ...editar, modelo: e.target.value, equipoCodigo: undefined })} disabled={busy} />
              </label>
            </div>

            <label style={{ marginTop: 8 }}>Horómetro de la última vez <span className="field-optional">(opcional)</span>
              <input type="number" min={0} step="any" value={editar.ultimaHoras ?? ''}
                onChange={(e) => setEditar({ ...editar, ultimaHoras: Number(e.target.value) })} disabled={busy} />
            </label>
            <p className="subtle-copy">
              Si se deja vacío, se asume que la próxima cae al terminar el ciclo en curso.
            </p>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEditar(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardar()} disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
