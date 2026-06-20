import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createTercero, updateTercero, deleteTercero } from '../services/samApi'
import type { Tercero } from '../domain/sam'

/**
 * Pestaña "Terceros" (propietario / administración) — submenú Catálogos.
 *
 * CRUD del catálogo de terceros (clientes a los que se presta la labor). Los
 * ingenios ya existentes se sembraron como terceros (migración
 * 20260619120000); se pueden crear más y asignarlos a las suertes en Maestros.
 */
export function TercerosTab() {
  const { terceros, setTerceros, maestro, busy, setBusy, setError, setInfo } = useAppData()

  const [nuevo, setNuevo] = useState('')
  const [editTarget, setEditTarget] = useState<Tercero | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Tercero | null>(null)

  const ordenados = useMemo(
    () => [...terceros].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [terceros],
  )
  const activos = ordenados.filter((t) => t.activo).length

  // Cuántas suertes tiene asignada cada tercero (para avisar antes de eliminar).
  const suertesPorTercero = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of maestro) {
      if (r.terceroId) map.set(r.terceroId, (map.get(r.terceroId) ?? 0) + 1)
    }
    return map
  }, [maestro])

  async function handleCreate() {
    const nombre = nuevo.trim().toUpperCase()
    if (!nombre) {
      setError('Escribe el nombre del tercero.')
      return
    }
    if (terceros.some((t) => t.nombre.toUpperCase() === nombre)) {
      setError(`El tercero "${nombre}" ya existe.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const tercero = await createTercero(nombre)
      setTerceros((prev) => [...prev, tercero])
      setNuevo('')
      setInfo(`Tercero "${tercero.nombre}" creado.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo crear el tercero. (${e?.message ?? 'error'}) — revisa conexión.`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleActivo(tercero: Tercero) {
    setBusy(true)
    setError('')
    try {
      const updated = await updateTercero(tercero.id, { activo: !tercero.activo })
      setTerceros((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      setInfo(updated.activo ? `"${updated.nombre}" activado.` : `"${updated.nombre}" desactivado.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar el estado. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  function openEdit(tercero: Tercero) {
    setEditTarget(tercero)
    setEditNombre(tercero.nombre)
    setError('')
  }

  async function saveEdit() {
    if (!editTarget) return
    const nombre = editNombre.trim().toUpperCase()
    if (!nombre) {
      setError('El nombre no puede quedar vacío.')
      return
    }
    if (nombre !== editTarget.nombre.toUpperCase() && terceros.some((t) => t.nombre.toUpperCase() === nombre)) {
      setError(`Ya existe un tercero "${nombre}".`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await updateTercero(editTarget.id, { nombre })
      setTerceros((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      setInfo(`Tercero renombrado a "${updated.nombre}".`)
      setEditTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo renombrar. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const t = deleteTarget
    setBusy(true)
    setError('')
    try {
      await deleteTercero(t.id)
      setTerceros((prev) => prev.filter((x) => x.id !== t.id))
      setInfo(`Tercero "${t.nombre}" eliminado. Las suertes que lo tenían quedan sin tercero.`)
      setDeleteTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo eliminar. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Terceros — catálogo de clientes</h2>
        <span className="subtle-copy">
          {activos} activo{activos === 1 ? '' : 's'} de {ordenados.length}
        </span>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Clientes a los que se les presta la labor (los ingenios ya están sembrados como terceros).
        Crea, renombra, activa o desactiva. Asigna terceros a las suertes desde <strong>Maestros</strong>.
      </p>

      <div className="labor-cat-add">
        <input
          type="text"
          placeholder="Nuevo tercero (ej. INGENIO X)"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate()
          }}
          disabled={busy}
        />
        <button type="button" className="primary-button" onClick={() => void handleCreate()} disabled={busy}>
          + Agregar
        </button>
      </div>

      <div className="table-wrap validacion-table-wrap" style={{ marginTop: 14 }}>
        <table className="validacion-table">
          <thead>
            <tr>
              <th>Tercero</th>
              <th className="num">Suertes</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((t) => (
              <tr key={t.id} className={t.activo ? '' : 'labor-cat-row--off'}>
                <td><strong>{t.nombre}</strong></td>
                <td className="num">{suertesPorTercero.get(t.id) ?? 0}</td>
                <td>
                  <span className={`labor-cat-chip ${t.activo ? 'on' : 'off'}`}>
                    {t.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  <div className="maestro-row-actions">
                    <button type="button" className="inline-button" onClick={() => void toggleActivo(t)} disabled={busy}>
                      {t.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button type="button" className="inline-button" onClick={() => openEdit(t)} disabled={busy}>
                      Renombrar
                    </button>
                    <button
                      type="button"
                      className="inline-button maestro-delete-btn"
                      onClick={() => { setDeleteTarget(t); setError('') }}
                      disabled={busy}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {ordenados.length === 0 && (
              <tr>
                <td colSpan={4} className="validacion-empty">
                  Sin terceros en el catálogo. Agrega el primero arriba.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <div className="modal-overlay open" onClick={() => setEditTarget(null)}>
          <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Terceros</p>
                <h3>Renombrar tercero</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setEditTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>
              Nombre
              <input type="text" value={editNombre} onChange={(e) => setEditNombre(e.target.value)} disabled={busy} autoFocus />
            </label>
            <p className="subtle-copy">Renombrar no afecta las suertes ya asignadas (siguen apuntando al mismo tercero).</p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEditTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void saveEdit()} disabled={busy}>
                {busy ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay open" onClick={() => setDeleteTarget(null)}>
          <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Terceros</p>
                <h3>¿Eliminar este tercero?</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}><strong>{deleteTarget.nombre}</strong></p>
            <p className="subtle-copy">
              {(suertesPorTercero.get(deleteTarget.id) ?? 0) > 0 ? (
                <>Tiene <strong>{suertesPorTercero.get(deleteTarget.id)}</strong> suerte(s) asignada(s); quedarán <strong>sin tercero</strong> (no se borran). </>
              ) : null}
              Si solo quieres que deje de aparecer, usa <strong>Desactivar</strong>.
            </p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="release-confirm-btn" onClick={() => void confirmDelete()} disabled={busy}>
                {busy ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default TercerosTab
