import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createZona, updateZona, deleteZona } from '../services/samApi'
import type { Zona } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'

/**
 * Pestaña "Zonas" (propietario / administración) — submenú Catálogos.
 *
 * CRUD del catálogo de zonas. Cada supervisor se asigna a una zona (en Usuarios)
 * y al aprobar labores la zona se auto-llena con la del supervisor. Sembrado con
 * Norte/Sur (migración 20260621120000); se pueden crear más.
 */
export function ZonasTab() {
  const { zonas, setZonas, users, busy, setBusy, setError, setInfo } = useAppData()

  const [nuevo, setNuevo] = useState('')
  const [editTarget, setEditTarget] = useState<Zona | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Zona | null>(null)

  const ordenadas = useMemo(
    () => [...zonas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [zonas],
  )
  const activas = ordenadas.filter((z) => z.activo).length

  // Cuántos supervisores tiene asignada cada zona (por código).
  const supsPorZona = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of users) {
      if (u.role === 'supervisor' && u.zona) map.set(u.zona, (map.get(u.zona) ?? 0) + 1)
    }
    return map
  }, [users])

  async function handleCreate() {
    const nombre = nuevo.trim()
    if (!nombre) {
      setError('Escribe el nombre de la zona.')
      return
    }
    if (zonas.some((z) => z.nombre.toLowerCase() === nombre.toLowerCase())) {
      setError(`La zona "${nombre}" ya existe.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const zona = await createZona(nombre)
      setZonas((prev) => [...prev, zona])
      setNuevo('')
      setInfo(`Zona "${zona.nombre}" creada.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo crear la zona. (${e?.message ?? 'error'}) — revisa conexión.`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleActiva(zona: Zona) {
    setBusy(true)
    setError('')
    try {
      const updated = await updateZona(zona.id, { activo: !zona.activo })
      setZonas((prev) => prev.map((z) => (z.id === updated.id ? updated : z)))
      setInfo(updated.activo ? `"${updated.nombre}" activada.` : `"${updated.nombre}" desactivada.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar el estado. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  function openEdit(zona: Zona) {
    setEditTarget(zona)
    setEditNombre(zona.nombre)
    setError('')
  }

  async function saveEdit() {
    if (!editTarget) return
    const nombre = editNombre.trim()
    if (!nombre) {
      setError('El nombre no puede quedar vacío.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await updateZona(editTarget.id, { nombre })
      setZonas((prev) => prev.map((z) => (z.id === updated.id ? updated : z)))
      setInfo(`Zona renombrada a "${updated.nombre}".`)
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
      await deleteZona(t.id)
      setZonas((prev) => prev.filter((z) => z.id !== t.id))
      setInfo(`Zona "${t.nombre}" eliminada.`)
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
        <h2>Zonas — catálogo</h2>
        <span className="subtle-copy">
          {activas} activa{activas === 1 ? '' : 's'} de {ordenadas.length}
        </span>
      </div>
      <Ayuda>
        <p>Zonas de trabajo. Asigna una zona a cada <strong>supervisor</strong> en Usuarios; al aprobar
        labores, la zona se llena sola con la del supervisor.</p>
      </Ayuda>

      <div className="labor-cat-add">
        <input
          type="text"
          placeholder="Nueva zona (ej. Zona Centro)"
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
              <th>Zona</th>
              <th className="num">Supervisores</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((z) => (
              <tr key={z.id} className={z.activo ? '' : 'labor-cat-row--off'}>
                <td><strong>{z.nombre}</strong></td>
                <td className="num">{supsPorZona.get(z.codigo) ?? 0}</td>
                <td>
                  <span className={`labor-cat-chip ${z.activo ? 'on' : 'off'}`}>
                    {z.activo ? 'Activa' : 'Inactiva'}
                  </span>
                </td>
                <td>
                  <div className="maestro-row-actions">
                    <button type="button" className="inline-button" onClick={() => void toggleActiva(z)} disabled={busy}>
                      {z.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button type="button" className="inline-button" onClick={() => openEdit(z)} disabled={busy}>
                      Renombrar
                    </button>
                    <button
                      type="button"
                      className="inline-button maestro-delete-btn"
                      onClick={() => { setDeleteTarget(z); setError('') }}
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
                <td colSpan={4} className="validacion-empty">
                  Sin zonas en el catálogo. Agrega la primera arriba.
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
                <p className="eyebrow">Zonas</p>
                <h3>Renombrar zona</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setEditTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>
              Nombre
              <input type="text" value={editNombre} onChange={(e) => setEditNombre(e.target.value)} disabled={busy} autoFocus />
            </label>
            <p className="subtle-copy">El código interno no cambia; las labores ya aprobadas conservan su zona.</p>
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
                <p className="eyebrow">Zonas</p>
                <h3>¿Eliminar esta zona?</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}><strong>{deleteTarget.nombre}</strong></p>
            <p className="subtle-copy">
              {(supsPorZona.get(deleteTarget.codigo) ?? 0) > 0 ? (
                <>Tiene <strong>{supsPorZona.get(deleteTarget.codigo)}</strong> supervisor(es) asignado(s); quedarán sin zona. </>
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

export default ZonasTab
