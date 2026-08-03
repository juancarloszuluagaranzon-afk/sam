import { useMemo, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { useTaller } from './TallerContext'
import { setHorometroManual, updateEquipoActivo } from '../../services/tallerApi'
import { fmtFechaHora } from '../../lib/fechas'
import { calcularIndicadores } from '../../lib/indicadores'
import { OT_TIPO_LABEL, type OrdenTrabajo } from '../../domain/sam'
import { Ayuda } from '../../components/Ayuda'

/**
 * Hoja de vida de la máquina.
 *
 * Es la pantalla que pidió el apunte: número de equipo, marca, modelo, horas, y
 * debajo TODO lo que se le ha hecho, en orden. Aquí también se corrige el
 * horómetro y se cargan valor de compra y vida útil, sin los cuales no hay
 * depreciación ni costo por hora real.
 */

const nf = (v: number, d = 1) =>
  v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })
const money = (v: number) =>
  `$${Math.round(v).toLocaleString('es-CO')}`

export function MaquinasTab() {
  const { equipment, busy, setBusy, setError, setInfo } = useAppData()
  const { horasDe, horometros, dudosos, ordenes, activos, refrescar } = useTaller()

  const [q, setQ] = useState('')
  const [abierta, setAbierta] = useState('')
  const [editH, setEditH] = useState<{ codigo: string; valor: string } | null>(null)
  const [editA, setEditA] = useState<{ codigo: string; compra: string; vida: string; residual: string } | null>(null)

  const lecturaDe = useMemo(() => {
    const m = new Map<string, { leidoEn: string; fuente: string }>()
    horometros.forEach((h) => m.set(h.codigo, { leidoEn: h.leidoEn, fuente: h.fuente }))
    return m
  }, [horometros])

  const activoDe = useMemo(() => {
    const m = new Map<string, (typeof activos)[number]>()
    activos.forEach((a) => m.set(a.codigo, a))
    return m
  }, [activos])

  const otsDe = useMemo(() => {
    const m = new Map<string, OrdenTrabajo[]>()
    ordenes.forEach((o) => {
      const arr = m.get(o.equipoCodigo) ?? []
      arr.push(o)
      m.set(o.equipoCodigo, arr)
    })
    return m
  }, [ordenes])

  const dudososDe = useMemo(() => {
    const m = new Map<string, number>()
    dudosos.forEach((d) => m.set(d.codigo, (m.get(d.codigo) ?? 0) + 1))
    return m
  }, [dudosos])

  const lista = useMemo(() => {
    const t = q.trim().toUpperCase()
    return [...equipment]
      .filter((e) => !t || e.code.toUpperCase().includes(t) || e.name.toUpperCase().includes(t))
      .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }))
  }, [equipment, q])

  async function guardarHorometro() {
    if (!editH) return
    const v = Number(editH.valor)
    if (!v || v <= 0) { setError('Escribe la lectura del horómetro.'); return }
    setBusy(true); setError('')
    try {
      await setHorometroManual(editH.codigo, v)
      setInfo(`Horómetro de ${editH.codigo} actualizado a ${nf(v)}.`)
      setEditH(null)
      await refrescar()
    } catch (err) {
      setError(`No se pudo guardar. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function guardarActivo() {
    if (!editA) return
    setBusy(true); setError('')
    try {
      await updateEquipoActivo(editA.codigo, {
        valorCompra: editA.compra ? Number(editA.compra) : null,
        vidaUtilHoras: editA.vida ? Number(editA.vida) : null,
        valorResidual: editA.residual ? Number(editA.residual) : null,
      })
      setInfo('Datos del activo guardados.')
      setEditA(null)
      await refrescar()
    } catch (err) {
      setError(`No se pudo guardar. (${(err as { message?: string })?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <h2>🚜 Hoja de vida de las máquinas</h2>
      <Ayuda>
        <p>Horómetro vigente y todo lo que se le ha hecho a cada equipo. El horómetro sale
        solo de las labores y los tanqueos; solo hay que escribirlo si la máquina no pasó
        por ninguno de los dos.</p>
      </Ayuda>

      {dudosos.length > 0 && (
        <div className="taller-aviso taller-aviso--warn">
          <strong>⚠ {dudosos.length} lectura(s) de horómetro con dedazo</strong>
          <span>
            Se descartaron para que no dañen el conteo (un dígito de más o de menos
            desplaza la máquina miles de horas). Aparecen marcadas en cada equipo.
          </span>
        </div>
      )}

      <label style={{ marginTop: 10 }}>Buscar máquina
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="CASE951, tractor…" />
      </label>

      <div className="inv-list" style={{ marginTop: 12 }}>
        {lista.map((e) => {
          const horas = horasDe.get(e.code)
          const lec = lecturaDe.get(e.code)
          const act = activoDe.get(e.code)
          const ots = otsDe.get(e.code) ?? []
          const open = abierta === e.code
          const malas = dudososDe.get(e.code) ?? 0
          return (
            <div key={e.code} className="bod-item">
              <div className={`inv-row${open ? ' bod-row--abierta' : ''}`}>
                <div className="inv-row__main">
                  <strong>{e.code}</strong>
                  <span className="subtle-copy">{e.name}</span>
                  {malas > 0 && <span className="inv-cat inv-cat--off">⚠ {malas} lectura(s) dudosa(s)</span>}
                </div>
                <div className="inv-stock" title="Horómetro vigente">
                  {horas != null ? nf(horas) : '—'} <small>h</small>
                </div>
                <div className="inv-row__actions">
                  <button type="button" className="inline-button" onClick={() => setAbierta(open ? '' : e.code)} aria-expanded={open}>
                    {open ? 'Ocultar ▴' : 'Ver hoja ▾'}
                  </button>
                </div>
              </div>

              {open && (
                <div className="bod-stock">
                  <div className="taller-ficha">
                    <div><span>Horómetro</span><strong>{horas != null ? `${nf(horas)} h` : 'sin lectura'}</strong></div>
                    <div><span>Última lectura</span><strong>{lec ? `${fmtFechaHora(lec.leidoEn)} · ${lec.fuente}` : '—'}</strong></div>
                    <div><span>Valor de compra</span><strong>{act?.valorCompra ? money(act.valorCompra) : '—'}</strong></div>
                    <div><span>Vida útil</span><strong>{act?.vidaUtilHoras ? `${nf(act.vidaUtilHoras, 0)} h` : '—'}</strong></div>
                  </div>

                  <div className="taller-acciones">
                    <button type="button" className="inline-button"
                      onClick={() => setEditH({ codigo: e.code, valor: horas ? String(horas) : '' })} disabled={busy}>
                      ⏱ Corregir horómetro
                    </button>
                    <button type="button" className="inline-button"
                      onClick={() => setEditA({
                        codigo: e.code,
                        compra: act?.valorCompra ? String(act.valorCompra) : '',
                        vida: act?.vidaUtilHoras ? String(act.vidaUtilHoras) : '',
                        residual: act?.valorResidual ? String(act.valorResidual) : '',
                      })} disabled={busy}>
                      💰 Datos del activo
                    </button>
                  </div>

                  {!act?.vidaUtilHoras && (
                    <p className="subtle-copy" style={{ marginTop: 8 }}>
                      Sin valor de compra y vida útil no se puede depreciar, y el costo por
                      hora de esta máquina se vería más barato de lo que es.
                    </p>
                  )}

                  <p className="ins-res__lbl" style={{ marginTop: 12 }}>
                    Historial de intervenciones ({ots.length})
                  </p>
                  {ots.length === 0 ? (
                    <p className="muted-text" style={{ margin: 0 }}>Todavía no tiene órdenes de trabajo.</p>
                  ) : (
                    ots.slice(0, 15).map((o) => (
                      <div key={o.id} className="bod-stock__row">
                        <span className="bod-stock__nom">
                          <span className={`aval-tag aval-tag--${o.tipo === 'CORRECTIVO' ? 'vehiculo' : 'carro'}`}>
                            {OT_TIPO_LABEL[o.tipo]}
                          </span>{' '}
                          #{o.consecutivo} · {o.descripcion}
                          <small className="bod-stock__reparto">
                            {fmtFechaHora(o.createdAt)}
                            {o.horometro ? ` · ${nf(o.horometro)} h` : ''}
                            {o.responsable ? ` · ${o.responsable}` : ''}
                            {o.estado !== 'CERRADA' ? ` · ${o.estado}` : ''}
                          </small>
                        </span>
                        <strong className="bod-stock__val">
                          {money(
                            o.repuestos.reduce((t, r) => t + r.cantidad * r.costoUnitario, 0) +
                            o.horasMo * o.valorHoraMo + o.costoExterno,
                          )}
                        </strong>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Corregir horómetro */}
      {editH && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setEditH(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(380px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">{editH.codigo}</p><h3>⏱ Horómetro</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEditH(null)} disabled={busy}>&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Solo si la lectura que trae de labores o tanqueos está mal. Esta queda como
              la vigente.
            </p>
            <label>Lectura actual
              <input type="number" min={0} step="any" value={editH.valor} autoFocus
                onChange={(e) => setEditH({ ...editH, valor: e.target.value })} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEditH(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarHorometro()} disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Datos del activo */}
      {editA && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setEditA(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">{editA.codigo}</p><h3>💰 Datos del activo</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEditA(null)} disabled={busy}>&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Con esto se calcula la depreciación <strong>por uso</strong>: una máquina
              quieta no se gasta, así que se reparte entre las horas de vida útil, no
              entre los años.
            </p>
            <div className="flota-grid">
              <label>Valor de compra
                <input type="number" min={0} step="any" value={editA.compra}
                  onChange={(e) => setEditA({ ...editA, compra: e.target.value })} disabled={busy} />
              </label>
              <label>Vida útil (horas)
                <input type="number" min={0} step="any" value={editA.vida} placeholder="10000"
                  onChange={(e) => setEditA({ ...editA, vida: e.target.value })} disabled={busy} />
              </label>
              <label>Valor residual <span className="field-optional">(opcional)</span>
                <input type="number" min={0} step="any" value={editA.residual}
                  onChange={(e) => setEditA({ ...editA, residual: e.target.value })} disabled={busy} />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEditA(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarActivo()} disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export { calcularIndicadores }
