import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import {
  createInsumo, updateInsumo, deleteInsumo,
  registrarMovimientoInsumo, ajustarStockInsumo, loadKardex,
} from '../services/samApi'
import type { Insumo, InsumoCategoria, InsumoKardex } from '../domain/sam'
import { fmtCantidad } from '../lib/cantidad'

/**
 * Inventario de insumos (módulo Insumos y Combustible) — Fase 1.
 *
 * Catálogo de insumos (combustibles/materiales) con stock actual. Permite crear,
 * editar, activar/desactivar, registrar ENTRADAS (compras) que suman al stock y
 * quedan en el kardex, y consultar el kardex (movimientos) de cada insumo.
 * Requiere la migración 20260622120000_insumos.
 */
function fmtFecha(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function InsumosInventarioTab() {
  const { insumos, setInsumos, users, session, sortedEquipment, busy, setBusy, setError, setInfo } = useAppData()

  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])

  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoCat, setNuevoCat] = useState<InsumoCategoria>('MATERIAL')
  const [nuevoUnidad, setNuevoUnidad] = useState('unidad')
  const [nuevoMinimo, setNuevoMinimo] = useState('')
  const [catFilter, setCatFilter] = useState<'TODOS' | InsumoCategoria>('TODOS')
  const [soloBajo, setSoloBajo] = useState(false)
  const [search, setSearch] = useState('')
  // Menú "⋯" abierto (acciones secundarias de una fila).
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const [editTarget, setEditTarget] = useState<Insumo | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [editCat, setEditCat] = useState<InsumoCategoria>('MATERIAL')
  const [editUnidad, setEditUnidad] = useState('unidad')
  const [editMinimo, setEditMinimo] = useState('')

  // Ajuste por conteo físico.
  const [ajusteTarget, setAjusteTarget] = useState<Insumo | null>(null)
  const [ajusteReal, setAjusteReal] = useState('')
  const [ajusteMotivo, setAjusteMotivo] = useState('')

  const esBajo = (i: Insumo) => i.stockMinimo > 0 && i.stock <= i.stockMinimo
  const bajos = useMemo(() => insumos.filter((i) => i.activo && esBajo(i)), [insumos])

  const [deleteTarget, setDeleteTarget] = useState<Insumo | null>(null)

  const [entradaTarget, setEntradaTarget] = useState<Insumo | null>(null)
  const [entradaCantidad, setEntradaCantidad] = useState('')
  const [entradaMotivo, setEntradaMotivo] = useState('')

  const [kardexTarget, setKardexTarget] = useState<Insumo | null>(null)
  const [kardexRows, setKardexRows] = useState<InsumoKardex[]>([])
  const [kardexLoading, setKardexLoading] = useState(false)

  const userName = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach((u) => m.set(u.id, u.name))
    return m
  }, [users])

  const ordenados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...insumos]
      .filter((i) => catFilter === 'TODOS' || i.categoria === catFilter)
      .filter((i) => !soloBajo || esBajo(i))
      .filter((i) => !q || i.nombre.toLowerCase().includes(q) || i.unidad.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumos, catFilter, search, soloBajo])

  async function handleCreate() {
    const nombre = nuevoNombre.trim().toUpperCase()
    if (!nombre) { setError('Escribe el nombre del insumo.'); return }
    if (insumos.some((i) => i.nombre.toUpperCase() === nombre)) {
      setError(`El insumo "${nombre}" ya existe.`); return
    }
    setBusy(true); setError('')
    try {
      const ins = await createInsumo(nombre, nuevoCat, nuevoUnidad, Number(nuevoMinimo) || 0)
      setInsumos((prev) => [...prev, ins])
      setNuevoNombre(''); setNuevoUnidad('unidad'); setNuevoCat('MATERIAL'); setNuevoMinimo('')
      setNuevoOpen(false)
      setInfo(`Insumo "${ins.nombre}" creado.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo crear el insumo. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  function openEdit(i: Insumo) {
    setEditTarget(i); setEditNombre(i.nombre); setEditCat(i.categoria); setEditUnidad(i.unidad)
    setEditMinimo(i.stockMinimo ? String(i.stockMinimo) : ''); setError('')
  }
  async function saveEdit() {
    if (!editTarget) return
    const nombre = editNombre.trim().toUpperCase()
    if (!nombre) { setError('El nombre no puede quedar vacío.'); return }
    setBusy(true); setError('')
    try {
      const upd = await updateInsumo(editTarget.id, { nombre, categoria: editCat, unidad: editUnidad, stockMinimo: Number(editMinimo) || 0 })
      setInsumos((prev) => prev.map((i) => (i.id === upd.id ? upd : i)))
      setInfo(`Insumo actualizado.`); setEditTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo actualizar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  // Frecuentes: los de uso diario. Aparecen de entrada en los selectores; el
  // resto queda detrás de "⋯ Otros" para no saturar visualmente.
  async function toggleFrecuente(i: Insumo) {
    setBusy(true); setError('')
    try {
      const upd = await updateInsumo(i.id, { frecuente: !i.frecuente })
      setInsumos((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setInfo(upd.frecuente ? `"${upd.nombre}" ahora aparece de entrada en las listas.` : `"${upd.nombre}" pasó a "Otros".`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function toggleActivo(i: Insumo) {
    setBusy(true); setError('')
    try {
      const upd = await updateInsumo(i.id, { activo: !i.activo })
      setInsumos((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setInfo(upd.activo ? `"${upd.nombre}" activado.` : `"${upd.nombre}" desactivado.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar el estado. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const t = deleteTarget
    setBusy(true); setError('')
    try {
      await deleteInsumo(t.id)
      setInsumos((prev) => prev.filter((i) => i.id !== t.id))
      setInfo(`Insumo "${t.nombre}" eliminado.`); setDeleteTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo eliminar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  function openEntrada(i: Insumo) {
    setEntradaTarget(i); setEntradaCantidad(''); setEntradaMotivo(''); setError('')
  }
  async function registrarEntrada() {
    if (!entradaTarget) return
    const cant = Number(entradaCantidad)
    if (!cant || isNaN(cant) || cant <= 0) { setError('Ingresa una cantidad válida (> 0).'); return }
    setBusy(true); setError('')
    try {
      const upd = await registrarMovimientoInsumo({
        insumoId: entradaTarget.id, tipo: 'ENTRADA', cantidad: cant,
        motivo: entradaMotivo.trim() || 'Entrada de inventario', creadoPor: session?.id,
      })
      setInsumos((prev) => prev.map((i) => (i.id === upd.id ? upd : i)))
      setInfo(`Entrada registrada: +${cant} ${upd.unidad} de ${upd.nombre}. Stock: ${upd.stock}.`)
      setEntradaTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar la entrada. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  function openAjuste(i: Insumo) {
    setAjusteTarget(i); setAjusteReal(String(i.stock)); setAjusteMotivo(''); setError('')
  }
  async function registrarAjuste() {
    if (!ajusteTarget) return
    const real = Number(ajusteReal)
    if (ajusteReal.trim() === '' || isNaN(real) || real < 0) { setError('Ingresa el stock real contado (≥ 0).'); return }
    if (real === ajusteTarget.stock) { setError('El stock contado es igual al del sistema. No hay ajuste.'); return }
    setBusy(true); setError('')
    try {
      const upd = await ajustarStockInsumo({ insumoId: ajusteTarget.id, nuevoStock: real, motivo: ajusteMotivo.trim() || undefined, creadoPor: session?.id })
      setInsumos((prev) => prev.map((i) => (i.id === upd.id ? upd : i)))
      setInfo(`Inventario ajustado: ${ajusteTarget.nombre} ahora en ${upd.stock} ${upd.unidad}.`)
      setAjusteTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo ajustar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function openKardex(i: Insumo) {
    setKardexTarget(i); setKardexRows([]); setKardexLoading(true)
    try {
      setKardexRows(await loadKardex(i.id))
    } finally { setKardexLoading(false) }
  }

  const combustibles = insumos.filter((i) => i.categoria === 'COMBUSTIBLE').length
  const materiales = insumos.filter((i) => i.categoria === 'MATERIAL').length

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Inventario de insumos</h2>
        <button type="button" className="primary-button" onClick={() => { setNuevoNombre(''); setNuevoUnidad('unidad'); setNuevoCat('MATERIAL'); setError(''); setNuevoOpen(true) }} disabled={busy}>
          + Nuevo insumo
        </button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        {combustibles} combustible(s) · {materiales} material(es). Registra <strong>entradas</strong> (compras) que
        suman al inventario; las salidas se descuentan con los despachos.
      </p>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        La cantidad de cada insumo es el <strong>total de la empresa</strong>: lo que está en la bodega
        principal más lo que llevan los carros. Para ver dónde está repartido, entra a <strong>Bodegas</strong>.
      </p>

      {bajos.length > 0 && (
        <button
          type="button"
          className={`inv-alerta${soloBajo ? ' is-on' : ''}`}
          onClick={() => setSoloBajo((v) => !v)}
        >
          ⚠️ {bajos.length} insumo{bajos.length === 1 ? '' : 's'} en <strong>stock bajo</strong>
          <span className="inv-alerta__cta">{soloBajo ? 'Ver todos' : 'Ver solo estos'}</span>
        </button>
      )}

      <div className="inv-toolbar">
        <div className="sol-filtros" style={{ marginTop: 0 }}>
          {([
            { key: 'TODOS', icon: '📋', label: 'Todos' },
            { key: 'COMBUSTIBLE', icon: '⛽', label: 'Combustibles' },
            { key: 'MATERIAL', icon: '🔩', label: 'Materiales' },
          ] as const).map((c) => (
            <button key={c.key} type="button" className={`sol-filtro${catFilter === c.key ? ' is-active' : ''}`} onClick={() => setCatFilter(c.key)}>
              <span aria-hidden>{c.icon}</span> {c.label}
            </button>
          ))}
        </div>
        <input
          className="user-search-input inv-toolbar__search"
          type="search"
          placeholder="Buscar insumo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="inv-list">
        {ordenados.map((i) => (
          <div key={i.id} className={`inv-row${i.activo ? '' : ' inv-row--off'}`}>
            <div className="inv-row__main">
              <strong>{i.nombre}</strong>
              <span className={`inv-cat ${i.categoria === 'COMBUSTIBLE' ? 'inv-cat--comb' : 'inv-cat--mat'}`}>
                {i.categoria === 'COMBUSTIBLE' ? '⛽ Combustible' : '🔩 Material'}
              </span>
              {i.frecuente && <span className="inv-cat inv-cat--frec" title="Aparece de entrada en las listas">⭐ Frecuente</span>}
              {!i.activo && <span className="inv-cat inv-cat--off">Inactivo</span>}
              {i.activo && esBajo(i) && <span className="inv-cat inv-cat--bajo">⚠ Stock bajo</span>}
            </div>
            <div className={`inv-stock${i.stock <= 0 ? ' inv-stock--zero' : esBajo(i) ? ' inv-stock--bajo' : ''}`} title={i.stockMinimo > 0 ? `Stock actual · mínimo ${fmtCantidad(i.stockMinimo, i.unidad)} ${i.unidad}` : 'Stock actual'}>
              {fmtCantidad(i.stock, i.unidad)} <small>{i.unidad}</small>
            </div>
            <div className="inv-row__actions">
              <button type="button" className="inline-button inv-entrada-btn" onClick={() => openEntrada(i)} disabled={busy}>+ Entrada</button>
              <div className="inv-kebab">
                <button
                  type="button"
                  className="inline-button inv-kebab__btn"
                  onClick={() => setMenuFor(menuFor === i.id ? null : i.id)}
                  disabled={busy}
                  aria-label="Más acciones"
                  aria-expanded={menuFor === i.id}
                >
                  ⋯
                </button>
                {menuFor === i.id && (
                  <>
                    <div className="inv-kebab__backdrop" onClick={() => setMenuFor(null)} />
                    <div className="inv-kebab__menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); void openKardex(i) }}>📒 Kardex</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); void toggleFrecuente(i) }}>
                        {i.frecuente ? '☆ Quitar de frecuentes' : '⭐ Marcar como frecuente'}
                      </button>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); openAjuste(i) }}>⚖️ Ajustar (conteo)</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); openEdit(i) }}>✏️ Editar</button>
                      <button type="button" role="menuitem" onClick={() => { setMenuFor(null); void toggleActivo(i) }}>
                        {i.activo ? '🚫 Desactivar' : '✔ Activar'}
                      </button>
                      <button type="button" role="menuitem" className="inv-kebab__danger" onClick={() => { setMenuFor(null); setDeleteTarget(i); setError('') }}>
                        🗑 Eliminar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {ordenados.length === 0 && (
          <p className="muted-text" style={{ padding: '12px 4px' }}>
            {search.trim() ? 'Sin coincidencias para la búsqueda.' : 'Sin insumos. Crea el primero con “+ Nuevo insumo”.'}
          </p>
        )}
      </div>

      {/* Modal crear insumo */}
      {nuevoOpen && (
        <div className="modal-overlay open" onClick={() => setNuevoOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Inventario</p><h3>Nuevo insumo</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevoOpen(false)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>
              Nombre
              <input
                type="text"
                placeholder="ej. DIESEL"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
                disabled={busy}
                autoFocus
              />
            </label>
            <label>
              Categoría
              <select value={nuevoCat} onChange={(e) => setNuevoCat(e.target.value as InsumoCategoria)} disabled={busy}>
                <option value="MATERIAL">Material</option>
                <option value="COMBUSTIBLE">Combustible</option>
              </select>
            </label>
            <label>
              Unidad
              <input type="text" placeholder="galón, unidad, kg…" value={nuevoUnidad} onChange={(e) => setNuevoUnidad(e.target.value)} disabled={busy} />
            </label>
            <label>
              Stock mínimo (alerta) <span className="field-optional">(0 = sin alerta)</span>
              <input type="number" min={0} step="any" placeholder="ej. 50" value={nuevoMinimo} onChange={(e) => setNuevoMinimo(e.target.value)} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNuevoOpen(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void handleCreate()} disabled={busy}>
                {busy ? 'Creando…' : 'Crear insumo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal entrada */}
      {entradaTarget && (
        <div className="modal-overlay open" onClick={() => setEntradaTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Inventario</p><h3>Registrar entrada</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEntradaTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              <strong>{entradaTarget.nombre}</strong> · stock actual {entradaTarget.stock} {entradaTarget.unidad}
            </p>
            <label>
              Cantidad a ingresar ({entradaTarget.unidad})
              <input type="number" min={0.01} step="any" value={entradaCantidad} onChange={(e) => setEntradaCantidad(e.target.value)} disabled={busy} autoFocus />
            </label>
            <label>
              Motivo <span className="field-optional">(opcional)</span>
              <input type="text" placeholder="Compra, devolución…" value={entradaMotivo} onChange={(e) => setEntradaMotivo(e.target.value)} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEntradaTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void registrarEntrada()} disabled={busy}>{busy ? 'Guardando...' : 'Registrar entrada'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ajuste por conteo físico */}
      {ajusteTarget && (() => {
        const real = Number(ajusteReal)
        const dif = ajusteReal.trim() !== '' && !isNaN(real) ? Number((real - ajusteTarget.stock).toFixed(4)) : null
        return (
        <div className="modal-overlay open" onClick={() => setAjusteTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Inventario</p><h3>⚖️ Ajustar por conteo</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setAjusteTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              <strong>{ajusteTarget.nombre}</strong> · el sistema dice <strong>{ajusteTarget.stock} {ajusteTarget.unidad}</strong>
            </p>
            <label>
              Stock real contado ({ajusteTarget.unidad})
              <input type="number" min={0} step="any" value={ajusteReal} onChange={(e) => setAjusteReal(e.target.value)} disabled={busy} autoFocus />
            </label>
            {dif != null && dif !== 0 && (
              <p className="subtle-copy" style={{ margin: '4px 0 0', color: dif < 0 ? '#b3261e' : 'var(--color-brand)' }}>
                Diferencia: {dif > 0 ? '+' : ''}{dif} {ajusteTarget.unidad} {dif < 0 ? '(faltaba en bodega)' : '(sobraba en bodega)'} — queda en el kardex.
              </p>
            )}
            <label style={{ marginTop: 10 }}>
              Motivo <span className="field-optional">(opcional)</span>
              <input type="text" placeholder="Conteo físico, merma, derrame…" value={ajusteMotivo} onChange={(e) => setAjusteMotivo(e.target.value)} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setAjusteTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void registrarAjuste()} disabled={busy}>{busy ? 'Guardando…' : 'Ajustar inventario'}</button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* Modal kardex */}
      {kardexTarget && (
        <div className="modal-overlay open" onClick={() => setKardexTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(540px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Kardex</p><h3>{kardexTarget.nombre}</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setKardexTarget(null)} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>Stock actual: <strong>{kardexTarget.stock} {kardexTarget.unidad}</strong></p>
            <div className="list-rows" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {kardexLoading ? (
                <p className="muted-text">Cargando…</p>
              ) : kardexRows.length === 0 ? (
                <p className="muted-text">Sin movimientos todavía.</p>
              ) : kardexRows.map((m) => {
                // AJUSTE lleva cantidad con signo; SALIDA resta, ENTRADA suma.
                const negativo = m.tipo === 'SALIDA' || (m.tipo === 'AJUSTE' && m.cantidad < 0)
                const magnitud = m.tipo === 'AJUSTE' ? Math.abs(m.cantidad) : m.cantidad
                return (
                <div key={m.id} className="movement-row">
                  <div>
                    <strong style={{ color: negativo ? 'var(--color-danger, #b3261e)' : 'var(--color-brand)' }}>
                      {negativo ? '−' : '+'}{fmtCantidad(magnitud, kardexTarget.unidad)} {kardexTarget.unidad}
                    </strong>
                    <span>{m.tipo}{m.equipoCodigo ? ` · 🚜 ${equipoNombre.get(m.equipoCodigo) ?? m.equipoCodigo}` : ''}{m.motivo ? ` · ${m.motivo}` : ''}{m.creadoPor ? ` · ${userName.get(m.creadoPor) ?? m.creadoPor}` : ''}</span>
                  </div>
                  <div className="movement-side">
                    <span className="status-pill">Saldo {fmtCantidad(m.saldo, kardexTarget.unidad)}</span>
                    <small>{fmtFecha(m.createdAt)}</small>
                  </div>
                </div>
                )
              })}
            </div>
            <div className="modal-footer">
              <button type="button" className="primary-button" onClick={() => setKardexTarget(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar */}
      {editTarget && (
        <div className="modal-overlay open" onClick={() => setEditTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Inventario</p><h3>Editar insumo</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEditTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>Nombre<input type="text" value={editNombre} onChange={(e) => setEditNombre(e.target.value)} disabled={busy} autoFocus /></label>
            <label>Categoría
              <select value={editCat} onChange={(e) => setEditCat(e.target.value as InsumoCategoria)} disabled={busy}>
                <option value="MATERIAL">Material</option>
                <option value="COMBUSTIBLE">Combustible</option>
              </select>
            </label>
            <label>Unidad<input type="text" value={editUnidad} onChange={(e) => setEditUnidad(e.target.value)} disabled={busy} /></label>
            <label>Stock mínimo (alerta) <span className="field-optional">(0 = sin alerta)</span>
              <input type="number" min={0} step="any" value={editMinimo} onChange={(e) => setEditMinimo(e.target.value)} disabled={busy} />
            </label>
            <p className="subtle-copy">El stock no se edita aquí; se ajusta con entradas, salidas (kardex) o <strong>⚖️ Ajustar (conteo)</strong>.</p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEditTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void saveEdit()} disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar eliminar */}
      {deleteTarget && (
        <div className="modal-overlay open" onClick={() => setDeleteTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Inventario</p><h3>¿Eliminar este insumo?</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}><strong>{deleteTarget.nombre}</strong></p>
            <p className="subtle-copy">Se elimina junto con su kardex. Si solo quieres que deje de aparecer, usa <strong>Desactivar</strong>.</p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="release-confirm-btn" onClick={() => void confirmDelete()} disabled={busy}>{busy ? 'Eliminando...' : 'Sí, eliminar'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default InsumosInventarioTab
