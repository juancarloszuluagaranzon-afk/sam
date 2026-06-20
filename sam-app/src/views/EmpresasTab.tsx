import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createEmpresa, updateEmpresa, deleteEmpresa } from '../services/samApi'
import type { Empresa } from '../domain/sam'

/**
 * Pestaña "Empresas" (propietario / administración) — submenú Catálogos.
 *
 * CRUD del catálogo de empresas (compañías operadas en el aplicativo, p. ej.
 * Agroservicios Morales). Crear, renombrar, activar/desactivar y eliminar.
 * Por ahora es solo catálogo; queda listo para enlazarlo más adelante.
 * Requiere la migración 20260619120000_empresas_terceros.
 */
export function EmpresasTab() {
  const { empresas, setEmpresas, busy, setBusy, setError, setInfo } = useAppData()

  const [nuevo, setNuevo] = useState('')
  const [editTarget, setEditTarget] = useState<Empresa | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Empresa | null>(null)

  const ordenadas = useMemo(
    () => [...empresas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [empresas],
  )
  const activas = ordenadas.filter((e) => e.activo).length

  async function handleCreate() {
    const nombre = nuevo.trim().toUpperCase()
    if (!nombre) {
      setError('Escribe el nombre de la empresa.')
      return
    }
    if (empresas.some((e) => e.nombre.toUpperCase() === nombre)) {
      setError(`La empresa "${nombre}" ya existe.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const empresa = await createEmpresa(nombre)
      setEmpresas((prev) => [...prev, empresa])
      setNuevo('')
      setInfo(`Empresa "${empresa.nombre}" creada.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo crear la empresa. (${e?.message ?? 'error'}) — revisa conexión.`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleActivo(empresa: Empresa) {
    setBusy(true)
    setError('')
    try {
      const updated = await updateEmpresa(empresa.id, { activo: !empresa.activo })
      setEmpresas((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
      setInfo(updated.activo ? `"${updated.nombre}" activada.` : `"${updated.nombre}" desactivada.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar el estado. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  function openEdit(empresa: Empresa) {
    setEditTarget(empresa)
    setEditNombre(empresa.nombre)
    setError('')
  }

  async function saveEdit() {
    if (!editTarget) return
    const nombre = editNombre.trim().toUpperCase()
    if (!nombre) {
      setError('El nombre no puede quedar vacío.')
      return
    }
    if (nombre !== editTarget.nombre.toUpperCase() && empresas.some((e) => e.nombre.toUpperCase() === nombre)) {
      setError(`Ya existe una empresa "${nombre}".`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await updateEmpresa(editTarget.id, { nombre })
      setEmpresas((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
      setInfo(`Empresa renombrada a "${updated.nombre}".`)
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
      await deleteEmpresa(t.id)
      setEmpresas((prev) => prev.filter((e) => e.id !== t.id))
      setInfo(`Empresa "${t.nombre}" eliminada.`)
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
        <h2>Empresas — catálogo</h2>
        <span className="subtle-copy">
          {activas} activa{activas === 1 ? '' : 's'} de {ordenadas.length}
        </span>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Compañías operadas en el aplicativo (p. ej. Agroservicios Morales). Crea, renombra,
        activa o desactiva. Por ahora es solo catálogo.
      </p>

      <div className="labor-cat-add">
        <input
          type="text"
          placeholder="Nueva empresa (ej. AGROSERVICIOS MORALES)"
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
              <th>Empresa</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((e) => (
              <tr key={e.id} className={e.activo ? '' : 'labor-cat-row--off'}>
                <td><strong>{e.nombre}</strong></td>
                <td>
                  <span className={`labor-cat-chip ${e.activo ? 'on' : 'off'}`}>
                    {e.activo ? 'Activa' : 'Inactiva'}
                  </span>
                </td>
                <td>
                  <div className="maestro-row-actions">
                    <button type="button" className="inline-button" onClick={() => void toggleActivo(e)} disabled={busy}>
                      {e.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button type="button" className="inline-button" onClick={() => openEdit(e)} disabled={busy}>
                      Renombrar
                    </button>
                    <button
                      type="button"
                      className="inline-button maestro-delete-btn"
                      onClick={() => { setDeleteTarget(e); setError('') }}
                      disabled={busy}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {ordenadas.length === 0 && (
              <tr>
                <td colSpan={3} className="validacion-empty">
                  Sin empresas en el catálogo. Agrega la primera arriba.
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
                <p className="eyebrow">Empresas</p>
                <h3>Renombrar empresa</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setEditTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>
              Nombre
              <input type="text" value={editNombre} onChange={(e) => setEditNombre(e.target.value)} disabled={busy} autoFocus />
            </label>
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
                <p className="eyebrow">Empresas</p>
                <h3>¿Eliminar esta empresa?</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}><strong>{deleteTarget.nombre}</strong></p>
            <p className="subtle-copy">
              Se quita del catálogo. Si solo quieres que deje de aparecer, usa <strong>Desactivar</strong>.
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

export default EmpresasTab
