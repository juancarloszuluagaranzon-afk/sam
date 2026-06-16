import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { createLabor, updateLabor, deleteLabor } from '../services/samApi'
import type { Labor, LaborTipo } from '../domain/sam'

/**
 * Pestaña "Labores" (propietario / administración).
 *
 * CRUD del catálogo de labores (tabla `labores`). Permite crear, renombrar,
 * ACTIVAR/DESACTIVAR y eliminar. Las labores DESACTIVADAS dejan de ofrecerse en
 * los selectores (asignar y tomar en campo) y en el Tablero; el histórico que
 * ya las usa se conserva. Requiere la migración 20260615_labores_catalogo.
 */
export function LaboresTab() {
  const { labores, setLabores, busy, setBusy, setError, setInfo } = useAppData()

  const [nuevo, setNuevo] = useState('')
  const [nuevoTipo, setNuevoTipo] = useState<LaborTipo>('MECANIZADA')
  const [editTarget, setEditTarget] = useState<Labor | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Labor | null>(null)

  const ordenadas = useMemo(
    () =>
      [...labores].sort((a, b) =>
        a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
      ),
    [labores],
  )

  const activas = ordenadas.filter((l) => l.activa).length

  async function handleCreate() {
    const nombre = nuevo.trim().toUpperCase()
    if (!nombre) {
      setError('Escribe el nombre de la labor.')
      return
    }
    if (labores.some((l) => l.nombre.toUpperCase() === nombre)) {
      setError(`La labor "${nombre}" ya existe en el catálogo.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const labor = await createLabor(nombre, nuevoTipo)
      setLabores((prev) => [...prev, labor])
      setNuevo('')
      setNuevoTipo('MECANIZADA')
      setInfo(`Labor "${labor.nombre}" creada.`)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo crear la labor. (${e?.message ?? 'error'}) — revisa conexión.`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleActiva(labor: Labor) {
    setBusy(true)
    setError('')
    try {
      const updated = await updateLabor(labor.id, { activa: !labor.activa })
      setLabores((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
      setInfo(
        updated.activa
          ? `"${updated.nombre}" activada: vuelve a estar disponible.`
          : `"${updated.nombre}" desactivada: deja de aparecer en los selectores.`,
      )
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar el estado. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleTipo(labor: Labor) {
    const next: LaborTipo = labor.tipo === 'MANUAL' ? 'MECANIZADA' : 'MANUAL'
    setBusy(true)
    setError('')
    try {
      const updated = await updateLabor(labor.id, { tipo: next })
      setLabores((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
      setInfo(
        updated.tipo === 'MANUAL'
          ? `"${updated.nombre}" marcada como manual: el operador de tractor ya no la verá en campo.`
          : `"${updated.nombre}" marcada como mecanizada.`,
      )
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cambiar el tipo. (${e?.message ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }

  function openEdit(labor: Labor) {
    setEditTarget(labor)
    setEditNombre(labor.nombre)
    setError('')
  }

  async function saveEdit() {
    if (!editTarget) return
    const nombre = editNombre.trim().toUpperCase()
    if (!nombre) {
      setError('El nombre no puede quedar vacío.')
      return
    }
    if (
      nombre !== editTarget.nombre.toUpperCase() &&
      labores.some((l) => l.nombre.toUpperCase() === nombre)
    ) {
      setError(`Ya existe una labor "${nombre}".`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await updateLabor(editTarget.id, { nombre })
      setLabores((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
      setInfo(`Labor renombrada a "${updated.nombre}".`)
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
      await deleteLabor(t.id)
      setLabores((prev) => prev.filter((l) => l.id !== t.id))
      setInfo(`Labor "${t.nombre}" eliminada del catálogo.`)
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
        <h2>Labores — catálogo</h2>
        <span className="subtle-copy">
          {activas} activa{activas === 1 ? '' : 's'} de {ordenadas.length}
        </span>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Crea, renombra, activa o desactiva labores. Las <strong>desactivadas</strong> dejan de
        aparecer al asignar y al tomar en campo; el histórico que ya las usa se conserva.
      </p>

      {/* Crear nueva labor */}
      <div className="labor-cat-add">
        <input
          type="text"
          placeholder="Nueva labor (ej. SUBSUELO)"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate()
          }}
          disabled={busy}
        />
        <select
          className="labor-cat-tipo-select"
          value={nuevoTipo}
          onChange={(e) => setNuevoTipo(e.target.value as LaborTipo)}
          disabled={busy}
          aria-label="Tipo de labor"
        >
          <option value="MECANIZADA">Mecanizada</option>
          <option value="MANUAL">Manual</option>
        </select>
        <button type="button" className="primary-button" onClick={() => void handleCreate()} disabled={busy}>
          + Agregar
        </button>
      </div>

      {/* Listado */}
      <div className="table-wrap validacion-table-wrap" style={{ marginTop: 14 }}>
        <table className="validacion-table">
          <thead>
            <tr>
              <th>Labor</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((l) => (
              <tr key={l.id} className={l.activa ? '' : 'labor-cat-row--off'}>
                <td><strong>{l.nombre}</strong></td>
                <td>
                  <span className={`labor-cat-chip ${l.tipo === 'MANUAL' ? 'manual' : 'mec'}`}>
                    {l.tipo === 'MANUAL' ? 'Manual' : 'Mecanizada'}
                  </span>
                </td>
                <td>
                  <span className={`labor-cat-chip ${l.activa ? 'on' : 'off'}`}>
                    {l.activa ? 'Activa' : 'Inactiva'}
                  </span>
                </td>
                <td>
                  <div className="maestro-row-actions">
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => void toggleActiva(l)}
                      disabled={busy}
                    >
                      {l.activa ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => void toggleTipo(l)}
                      disabled={busy}
                    >
                      {l.tipo === 'MANUAL' ? '→ Mecanizada' : '→ Manual'}
                    </button>
                    <button type="button" className="inline-button" onClick={() => openEdit(l)} disabled={busy}>
                      Renombrar
                    </button>
                    <button
                      type="button"
                      className="inline-button maestro-delete-btn"
                      onClick={() => { setDeleteTarget(l); setError('') }}
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
                  Sin labores en el catálogo. Agrega la primera arriba.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal renombrar */}
      {editTarget && (
        <div className="modal-overlay open" onClick={() => setEditTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Labores</p>
                <h3>Renombrar labor</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setEditTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>
              Nombre
              <input
                type="text"
                value={editNombre}
                onChange={(e) => setEditNombre(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </label>
            <p className="subtle-copy">
              Renombrar no cambia el histórico ya registrado con el nombre anterior.
            </p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEditTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void saveEdit()} disabled={busy}>
                {busy ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar eliminar */}
      {deleteTarget && (
        <div className="modal-overlay open" onClick={() => setDeleteTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Labores</p>
                <h3>¿Eliminar esta labor?</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              <strong>{deleteTarget.nombre}</strong>
            </p>
            <p className="subtle-copy">
              Se quita del catálogo y deja de ofrecerse. El histórico de labores que la usan
              <strong> se conserva</strong>. Si solo quieres que deje de aparecer pero conservarla,
              usa <strong>Desactivar</strong> en vez de eliminar.
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

export default LaboresTab
