import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import {
  createInsumo, updateInsumo, deleteInsumo,
  registrarMovimientoInsumo, loadKardex,
} from '../services/samApi'
import type { Insumo, InsumoCategoria, InsumoKardex } from '../domain/sam'

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
  const { insumos, setInsumos, users, session, busy, setBusy, setError, setInfo } = useAppData()

  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoCat, setNuevoCat] = useState<InsumoCategoria>('MATERIAL')
  const [nuevoUnidad, setNuevoUnidad] = useState('unidad')
  const [catFilter, setCatFilter] = useState<'TODOS' | InsumoCategoria>('TODOS')

  const [editTarget, setEditTarget] = useState<Insumo | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [editCat, setEditCat] = useState<InsumoCategoria>('MATERIAL')
  const [editUnidad, setEditUnidad] = useState('unidad')

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
    return [...insumos]
      .filter((i) => catFilter === 'TODOS' || i.categoria === catFilter)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  }, [insumos, catFilter])

  async function handleCreate() {
    const nombre = nuevoNombre.trim().toUpperCase()
    if (!nombre) { setError('Escribe el nombre del insumo.'); return }
    if (insumos.some((i) => i.nombre.toUpperCase() === nombre)) {
      setError(`El insumo "${nombre}" ya existe.`); return
    }
    setBusy(true); setError('')
    try {
      const ins = await createInsumo(nombre, nuevoCat, nuevoUnidad)
      setInsumos((prev) => [...prev, ins])
      setNuevoNombre(''); setNuevoUnidad('unidad'); setNuevoCat('MATERIAL')
      setInfo(`Insumo "${ins.nombre}" creado.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo crear el insumo. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  function openEdit(i: Insumo) {
    setEditTarget(i); setEditNombre(i.nombre); setEditCat(i.categoria); setEditUnidad(i.unidad); setError('')
  }
  async function saveEdit() {
    if (!editTarget) return
    const nombre = editNombre.trim().toUpperCase()
    if (!nombre) { setError('El nombre no puede quedar vacío.'); return }
    setBusy(true); setError('')
    try {
      const upd = await updateInsumo(editTarget.id, { nombre, categoria: editCat, unidad: editUnidad })
      setInsumos((prev) => prev.map((i) => (i.id === upd.id ? upd : i)))
      setInfo(`Insumo actualizado.`); setEditTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo actualizar. (${e?.message ?? 'error'})`)
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
        <span className="subtle-copy">{combustibles} combustible(s) · {materiales} material(es)</span>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Catálogo con stock. Registra <strong>entradas</strong> (compras) que suman al inventario y quedan en el kardex.
        Las salidas se descontarán con los despachos.
      </p>

      {/* Crear insumo */}
      <div className="labor-cat-add" style={{ flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Nuevo insumo (ej. DIESEL)"
          value={nuevoNombre}
          onChange={(e) => setNuevoNombre(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
          disabled={busy}
        />
        <select value={nuevoCat} onChange={(e) => setNuevoCat(e.target.value as InsumoCategoria)} disabled={busy} className="labor-cat-tipo-select" aria-label="Categoría">
          <option value="MATERIAL">Material</option>
          <option value="COMBUSTIBLE">Combustible</option>
        </select>
        <input
          type="text"
          placeholder="Unidad (galón, unidad, kg…)"
          value={nuevoUnidad}
          onChange={(e) => setNuevoUnidad(e.target.value)}
          disabled={busy}
          style={{ maxWidth: 160 }}
        />
        <button type="button" className="primary-button" onClick={() => void handleCreate()} disabled={busy}>+ Agregar</button>
      </div>

      <div className="realizadas-seg" style={{ marginTop: 12 }}>
        {(['TODOS', 'COMBUSTIBLE', 'MATERIAL'] as const).map((c) => (
          <button key={c} type="button" className={catFilter === c ? 'is-active' : ''} onClick={() => setCatFilter(c)}>
            {c === 'TODOS' ? 'Todos' : c === 'COMBUSTIBLE' ? 'Combustibles' : 'Materiales'}
          </button>
        ))}
      </div>

      <div className="table-wrap validacion-table-wrap" style={{ marginTop: 12 }}>
        <table className="validacion-table">
          <thead>
            <tr>
              <th>Insumo</th>
              <th>Categoría</th>
              <th className="num">Stock</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((i) => (
              <tr key={i.id} className={i.activo ? '' : 'labor-cat-row--off'}>
                <td><strong>{i.nombre}</strong></td>
                <td>
                  <span className={`labor-cat-chip ${i.categoria === 'COMBUSTIBLE' ? 'manual' : 'mec'}`}>
                    {i.categoria === 'COMBUSTIBLE' ? 'Combustible' : 'Material'}
                  </span>
                </td>
                <td className="num"><strong>{i.stock}</strong> <span className="subtle-copy">{i.unidad}</span></td>
                <td>
                  <div className="maestro-row-actions">
                    <button type="button" className="inline-button" onClick={() => openEntrada(i)} disabled={busy}>+ Entrada</button>
                    <button type="button" className="inline-button" onClick={() => void openKardex(i)} disabled={busy}>Kardex</button>
                    <button type="button" className="inline-button" onClick={() => openEdit(i)} disabled={busy}>Editar</button>
                    <button type="button" className="inline-button" onClick={() => void toggleActivo(i)} disabled={busy}>{i.activo ? 'Desactivar' : 'Activar'}</button>
                    <button type="button" className="inline-button maestro-delete-btn" onClick={() => { setDeleteTarget(i); setError('') }} disabled={busy}>Eliminar</button>
                  </div>
                </td>
              </tr>
            ))}
            {ordenados.length === 0 && (
              <tr><td colSpan={4} className="validacion-empty">Sin insumos. Agrega el primero arriba.</td></tr>
            )}
          </tbody>
        </table>
      </div>

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
              ) : kardexRows.map((m) => (
                <div key={m.id} className="movement-row">
                  <div>
                    <strong style={{ color: m.tipo === 'SALIDA' ? 'var(--color-danger, #b3261e)' : 'var(--color-brand)' }}>
                      {m.tipo === 'SALIDA' ? '−' : '+'}{m.cantidad} {kardexTarget.unidad}
                    </strong>
                    <span>{m.tipo}{m.motivo ? ` · ${m.motivo}` : ''}{m.creadoPor ? ` · ${userName.get(m.creadoPor) ?? m.creadoPor}` : ''}</span>
                  </div>
                  <div className="movement-side">
                    <span className="status-pill">Saldo {m.saldo}</span>
                    <small>{fmtFecha(m.createdAt)}</small>
                  </div>
                </div>
              ))}
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
            <p className="subtle-copy">El stock no se edita aquí; se ajusta con entradas y salidas (kardex).</p>
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
