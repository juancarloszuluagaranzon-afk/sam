import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createIngenio, updateIngenio, deleteIngenio } from '../services/samApi'
import { slugIngenio } from '../data/ingenios'
import type { Ingenio } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'

/**
 * Pestaña "Ingenios" (propietario / administración) — submenú Catálogos.
 *
 * CRUD del catálogo de ingenios/compradores. El `id` es un slug estable (ej.
 * 'trapiche_lucerna') porque amarra `maestro.ingenio_id`: al crear se deriva del
 * nombre y NO se cambia al renombrar. Nuevos ingenios quedan disponibles de
 * inmediato en el cargue masivo, los formularios y los reportes.
 * Requiere la migración 20260708120000_ingenios_catalogo.
 */
export function IngeniosTab() {
  const { ingenios, setIngenios, maestro, busy, setBusy, setError, setInfo } = useAppData()

  const [nuevo, setNuevo] = useState('')
  const [editTarget, setEditTarget] = useState<Ingenio | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Ingenio | null>(null)

  const ordenados = useMemo(
    () => [...ingenios].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [ingenios],
  )
  const activos = ordenados.filter((i) => i.activo).length

  // Cuántas suertes del maestro usan cada ingenio (para avisar antes de borrar).
  const usoPorIngenio = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of maestro) m.set(r.ingenio_id, (m.get(r.ingenio_id) ?? 0) + 1)
    return m
  }, [maestro])

  const slugPreview = slugIngenio(nuevo.trim())

  async function handleCreate() {
    const nombre = nuevo.trim()
    if (!nombre) {
      setError('Escribe el nombre del ingenio.')
      return
    }
    const id = slugIngenio(nombre)
    if (!id) {
      setError('El nombre no genera un identificador válido.')
      return
    }
    if (ingenios.some((i) => i.id === id)) {
      setError(`Ya existe un ingenio con ese identificador ("${id}").`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const ing = await createIngenio(nombre)
      setIngenios((prev) => [...prev, ing])
      setNuevo('')
      setInfo(`Ingenio "${ing.nombre}" creado (id: ${ing.id}).`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo crear el ingenio. (${e?.message ?? 'error'}) — revisa conexión.`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleActivo(ing: Ingenio) {
    setBusy(true)
    setError('')
    try {
      const updated = await updateIngenio(ing.id, { activo: !ing.activo })
      setIngenios((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
      setInfo(updated.activo ? `"${updated.nombre}" activado.` : `"${updated.nombre}" desactivado.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar el estado. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  function openEdit(ing: Ingenio) {
    setEditTarget(ing)
    setEditNombre(ing.nombre)
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
      const updated = await updateIngenio(editTarget.id, { nombre })
      setIngenios((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
      setInfo(`Ingenio renombrado a "${updated.nombre}".`)
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
      await deleteIngenio(t.id)
      setIngenios((prev) => prev.filter((i) => i.id !== t.id))
      setInfo(`Ingenio "${t.nombre}" eliminado.`)
      setDeleteTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo eliminar. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  const delUso = deleteTarget ? (usoPorIngenio.get(deleteTarget.id) ?? 0) : 0

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Ingenios — catálogo</h2>
        <span className="subtle-copy">
          {activos} activo{activos === 1 ? '' : 's'} de {ordenados.length}
        </span>
      </div>
      <Ayuda>
        <p>Ingenios/compradores a los que se presta la labor. Al crear uno, queda disponible
        de inmediato en el cargue masivo del maestro, los formularios y los reportes.</p>
      </Ayuda>

      <div className="labor-cat-add">
        <input
          type="text"
          placeholder="Nuevo ingenio (ej. Trapiche Lucerna)"
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
      {slugPreview && (
        <p className="subtle-copy" style={{ marginTop: 6 }}>
          Identificador que se guardará: <strong>{slugPreview}</strong> (no cambia al renombrar).
        </p>
      )}

      <div className="table-wrap validacion-table-wrap" style={{ marginTop: 14 }}>
        <table className="validacion-table">
          <thead>
            <tr>
              <th>Ingenio</th>
              <th>Identificador</th>
              <th>Suertes</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((i) => (
              <tr key={i.id} className={i.activo ? '' : 'labor-cat-row--off'}>
                <td><strong>{i.nombre}</strong></td>
                <td><span className="subtle-copy">{i.id}</span></td>
                <td>{usoPorIngenio.get(i.id) ?? 0}</td>
                <td>
                  <span className={`labor-cat-chip ${i.activo ? 'on' : 'off'}`}>
                    {i.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  <div className="maestro-row-actions">
                    <button type="button" className="inline-button" onClick={() => void toggleActivo(i)} disabled={busy}>
                      {i.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button type="button" className="inline-button" onClick={() => openEdit(i)} disabled={busy}>
                      Renombrar
                    </button>
                    <button
                      type="button"
                      className="inline-button maestro-delete-btn"
                      onClick={() => { setDeleteTarget(i); setError('') }}
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
                <td colSpan={5} className="validacion-empty">
                  Sin ingenios en el catálogo. Agrega el primero arriba.
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
                <p className="eyebrow">Ingenios</p>
                <h3>Renombrar ingenio</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setEditTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Identificador <strong>{editTarget.id}</strong> (no cambia — mantiene amarradas las suertes).
            </p>
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
          <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(460px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Ingenios</p>
                <h3>¿Eliminar este ingenio?</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}><strong>{deleteTarget.nombre}</strong> ({deleteTarget.id})</p>
            {delUso > 0 ? (
              <p className="subtle-copy" style={{ color: 'var(--color-danger, #b91c1c)' }}>
                ⚠️ Este ingenio tiene <strong>{delUso} suerte{delUso === 1 ? '' : 's'}</strong> en el maestro.
                Si lo eliminas, esas suertes quedan sin nombre de ingenio. Mejor usa <strong>Desactivar</strong>.
              </p>
            ) : (
              <p className="subtle-copy">
                No tiene suertes asociadas. Si solo quieres que deje de aparecer, usa <strong>Desactivar</strong>.
              </p>
            )}
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

export default IngeniosTab
