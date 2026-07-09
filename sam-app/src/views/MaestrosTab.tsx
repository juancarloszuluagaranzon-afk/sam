import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { updateMaestroRow, deleteMaestroRow } from '../services/samApi'
import { NewSuerteModal } from '../components/NewSuerteModal'
import { BulkMaestroModal } from '../components/BulkMaestroModal'
import type { MaestroRow } from '../domain/sam'

/**
 * Pestaña "Maestros" (dueño/owner, administración y supervisores).
 *
 * Lista el catálogo de suertes (maestro_risaralda) con búsqueda + panel de
 * filtros emergente (mismo patrón que Labores) y permite EDITAR el área neta
 * de una suerte. El UPDATE requiere la policy RLS de la migración
 * 20260601150000_maestro_rls_update.sql.
 *
 * El maestro tiene ~15K filas: la lista se filtra y se topa en LIMIT para no
 * renderizar todo de una. Si hay más, se pide refinar.
 */

import { ingenioNombre } from '../data/ingenios'

const LIMIT = 300

export function MaestrosTab() {
  const { session, maestro, setMaestro, assignments, busy, setBusy, setError, setInfo, ingenios } = useAppData()
  // Ingenios activos para el filtro y el alta de suertes.
  const ingeniosOpts = useMemo(() => ingenios.filter((i) => i.activo), [ingenios])

  // suerteCodes ("hacienda-suerte") con labor activa → el cargue masivo avisa
  // antes de desactivar una suerte que está en uso.
  const activeSuerteCodes = useMemo(() => {
    const s = new Set<string>()
    for (const a of assignments) {
      if (a.status === 'PENDIENTE' || a.status === 'EN_PROCESO' || a.status === 'PARCIAL') {
        s.add(`${a.haciendaCode}-${a.suerte}`)
      }
    }
    return s
  }, [assignments])

  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [ingenioFilter, setIngenioFilter] = useState('TODOS')
  const [haciendaFilter, setHaciendaFilter] = useState('TODAS')
  const [origenFilter, setOrigenFilter] = useState<'TODOS' | 'OFICIAL' | 'MANUAL'>('TODOS')

  const [editRow, setEditRow] = useState<MaestroRow | null>(null)
  const [editArea, setEditArea] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<MaestroRow | null>(null)
  const [isNewSuerteOpen, setIsNewSuerteOpen] = useState(false)
  const [isBulkOpen, setIsBulkOpen] = useState(false)

  // Haciendas conocidas (del maestro, opcionalmente filtradas al ingenio
  // seleccionado) para autocompletar en el modal de "Nueva suerte".
  const haciendasParaModal = useMemo(
    () =>
      Array.from(
        new Map(
          maestro
            .filter((r) => ingenioFilter === 'TODOS' || r.ingenio_id === ingenioFilter)
            .map((r) => [r.haciendaCode, { code: r.haciendaCode, name: r.haciendaName }]),
        ).values(),
      ),
    [maestro, ingenioFilter],
  )

  const haciendaOptions = useMemo(() => {
    const map = new Map<string, string>()
    maestro.forEach((r) => {
      if (ingenioFilter !== 'TODOS' && r.ingenio_id !== ingenioFilter) return
      if (!map.has(r.haciendaCode)) map.set(r.haciendaCode, r.haciendaName)
    })
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [maestro, ingenioFilter])

  const activeFilterCount =
    (ingenioFilter !== 'TODOS' ? 1 : 0) +
    (haciendaFilter !== 'TODAS' ? 1 : 0) +
    (origenFilter !== 'TODOS' ? 1 : 0)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out: MaestroRow[] = []
    for (const r of maestro) {
      if (ingenioFilter !== 'TODOS' && r.ingenio_id !== ingenioFilter) continue
      if (haciendaFilter !== 'TODAS' && r.haciendaCode !== haciendaFilter) continue
      if (origenFilter === 'OFICIAL' && r.creadoManual) continue
      if (origenFilter === 'MANUAL' && !r.creadoManual) continue
      if (q && !`${r.haciendaCode} ${r.haciendaName} ${r.suerte}`.toLowerCase().includes(q)) continue
      out.push(r)
      if (out.length > LIMIT + 1) break
    }
    return out
  }, [maestro, search, ingenioFilter, haciendaFilter, origenFilter])

  const shown = filtered.slice(0, LIMIT)
  const overLimit = filtered.length > LIMIT

  function clearFilters() {
    setIngenioFilter('TODOS')
    setHaciendaFilter('TODAS')
    setOrigenFilter('TODOS')
  }

  function openEdit(r: MaestroRow) {
    setEditRow(r)
    setEditArea(String(r.area))
    setError('')
  }

  async function saveEdit() {
    if (!editRow) return
    const area = Number(editArea)
    if (!area || isNaN(area) || area <= 0) {
      setError('Ingresa un área válida en hectáreas (> 0).')
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await updateMaestroRow(
        { haciendaCode: editRow.haciendaCode, suerte: editRow.suerte, ingenio_id: editRow.ingenio_id },
        { area },
      )
      setMaestro((prev) =>
        prev.map((r) =>
          r.haciendaCode === updated.haciendaCode &&
          r.suerte === updated.suerte &&
          r.ingenio_id === updated.ingenio_id
            ? updated
            : r,
        ),
      )
      setInfo(`Suerte ${updated.suerte} de ${updated.haciendaName}: área actualizada a ${updated.area.toFixed(2)} ha.`)
      setEditRow(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo actualizar el área. (${e?.message ?? 'error'}) — verifica conexión y/o avisa al admin.`)
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
      await deleteMaestroRow({ haciendaCode: t.haciendaCode, suerte: t.suerte, ingenio_id: t.ingenio_id })
      setMaestro((prev) =>
        prev.filter(
          (r) => !(r.haciendaCode === t.haciendaCode && r.suerte === t.suerte && r.ingenio_id === t.ingenio_id),
        ),
      )
      setInfo(`Suerte ${t.suerte} de ${t.haciendaName} eliminada del catálogo.`)
      setDeleteTarget(null)
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo eliminar. (${e?.message ?? 'error'}) — verifica conexión y/o avisa al admin.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Maestros — catálogo de suertes</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="primary-button outline validacion-export-btn"
            onClick={() => setIsBulkOpen(true)}
          >
            ⬆ Cargue masivo
          </button>
          <button
            type="button"
            className="primary-button outline validacion-export-btn"
            onClick={() => setIsNewSuerteOpen(true)}
          >
            + Nueva suerte
          </button>
        </div>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Edita el área neta de una suerte o elimínala del catálogo. Usa la búsqueda o los filtros para encontrarla rápido.
      </p>

      {/* Búsqueda + botón de filtros (mismo patrón que Labores) */}
      <div className="labores-search-row">
        <div className="labores-search-input-wrap">
          <svg className="labores-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="labores-search-input"
            placeholder="Buscar hacienda, código o suerte..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="labores-search-clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda">
              &#x2715;
            </button>
          )}
        </div>
        <button
          type="button"
          className={`filtros-toggle-btn${activeFilterCount > 0 ? ' filtros-toggle-btn--active' : ''}`}
          onClick={() => setDrawerOpen(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          Filtros
          {activeFilterCount > 0 && <span className="filtros-badge">{activeFilterCount}</span>}
        </button>
      </div>

      {/* Panel emergente de filtros */}
      <div className={`filter-drawer-overlay${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`filter-drawer${drawerOpen ? ' open' : ''}`} aria-hidden={!drawerOpen}>
        <div className="filter-drawer__head">
          <button type="button" className="filter-drawer__back" onClick={() => setDrawerOpen(false)} aria-label="Cerrar filtros">
            &#x2190;
          </button>
          <h3>Filtrar</h3>
          <button type="button" className="filter-drawer__clear" onClick={clearFilters} disabled={activeFilterCount === 0}>
            Limpiar
          </button>
        </div>
        <div className="filter-drawer__body">
          <label className="filter-drawer__field">
            Ingenio
            <select
              value={ingenioFilter}
              onChange={(e) => {
                setIngenioFilter(e.target.value)
                setHaciendaFilter('TODAS')
              }}
            >
              <option value="TODOS">Todos los ingenios</option>
              {ingeniosOpts.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
          </label>
          <label className="filter-drawer__field">
            Hacienda
            <select value={haciendaFilter} onChange={(e) => setHaciendaFilter(e.target.value)}>
              <option value="TODAS">Todas las haciendas</option>
              {haciendaOptions.map((h) => (
                <option key={h.code} value={h.code}>{h.code} - {h.name}</option>
              ))}
            </select>
          </label>
          <label className="filter-drawer__field">
            Origen
            <select value={origenFilter} onChange={(e) => setOrigenFilter(e.target.value as 'TODOS' | 'OFICIAL' | 'MANUAL')}>
              <option value="TODOS">Todas</option>
              <option value="OFICIAL">Solo oficiales</option>
              <option value="MANUAL">Solo creadas a mano</option>
            </select>
          </label>
        </div>
        <div className="filter-drawer__footer">
          <p className="filter-drawer__count">
            Mostrando <strong>{shown.length}{overLimit ? '+' : ''}</strong> {shown.length === 1 ? 'suerte' : 'suertes'}
          </p>
          <button type="button" className="primary-button" onClick={() => setDrawerOpen(false)}>
            Ver resultados
          </button>
        </div>
      </aside>

      {/* Listado */}
      <div className="table-wrap validacion-table-wrap">
        <table className="validacion-table">
          <thead>
            <tr>
              <th>Ingenio</th>
              <th>Hacienda</th>
              <th>Suerte</th>
              <th className="num">Área (ha)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.ingenio_id}-${r.haciendaCode}-${r.suerte}`}>
                <td className="nowrap">{ingenioNombre(r.ingenio_id)}</td>
                <td>
                  {r.haciendaCode} · {r.haciendaName}
                  {r.creadoManual && (
                    <span className="suerte-manual-tag" title="Creada manualmente desde la app">manual</span>
                  )}
                </td>
                <td>{r.suerte}</td>
                <td className="num">{r.area.toFixed(2)}</td>
                <td>
                  <div className="maestro-row-actions">
                    <button type="button" className="inline-button" onClick={() => openEdit(r)}>Editar</button>
                    <button
                      type="button"
                      className="inline-button maestro-delete-btn"
                      onClick={() => { setDeleteTarget(r); setError('') }}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="validacion-empty">
                  Sin suertes para estos filtros. Usa la búsqueda o cambia los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {overLimit && (
          <p className="field-hint" style={{ padding: '8px 12px' }}>
            Mostrando las primeras {LIMIT}. Refina la búsqueda o los filtros para ver el resto.
          </p>
        )}
      </div>

      {/* Modal de edición */}
      {editRow && (
        <div className="modal-overlay open" onClick={() => setEditRow(null)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}
          >
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Maestro</p>
                <h3>Editar área de la suerte</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setEditRow(null)} disabled={busy} aria-label="Cerrar">
                &#x2715;
              </button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {ingenioNombre(editRow.ingenio_id)} · {editRow.haciendaCode} {editRow.haciendaName} · Suerte <strong>{editRow.suerte}</strong>
            </p>
            <label>
              Área neta (hectáreas)
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={editArea}
                onChange={(e) => setEditArea(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEditRow(null)} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className="primary-button" onClick={() => void saveEdit()} disabled={busy}>
                {busy ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación de eliminar (desactivar) */}
      {deleteTarget && (
        <div className="modal-overlay open" onClick={() => setDeleteTarget(null)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 'min(440px, calc(100vw - 32px))' }}
          >
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Maestro</p>
                <h3>¿Eliminar esta suerte?</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDeleteTarget(null)} disabled={busy} aria-label="Cerrar">
                &#x2715;
              </button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              <strong>{ingenioNombre(deleteTarget.ingenio_id)} · {deleteTarget.haciendaCode} {deleteTarget.haciendaName} · Suerte {deleteTarget.suerte}</strong>
            </p>
            <p className="subtle-copy">
              Se quitará del catálogo (deja de aparecer en los listados y dropdowns).
              El histórico de labores que la usan <strong>se conserva</strong>; un administrador puede reactivarla si hace falta.
            </p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setDeleteTarget(null)} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className="release-confirm-btn" onClick={() => void confirmDelete()} disabled={busy}>
                {busy ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para crear una suerte nueva (reusa el del operario/supervisor) */}
      <NewSuerteModal
        open={isNewSuerteOpen}
        onClose={() => setIsNewSuerteOpen(false)}
        createdBy={session?.id ?? ''}
        haciendas={haciendasParaModal}
        ingenios={ingeniosOpts}
        maestro={maestro}
        prefillIngenioId={ingenioFilter !== 'TODOS' ? ingenioFilter : undefined}
        onCreated={(row) => {
          setMaestro((prev) => [...prev, row])
          setInfo(`Suerte ${row.suerte} creada en ${row.haciendaName}.`)
        }}
      />

      <BulkMaestroModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        maestro={maestro}
        createdBy={session?.id ?? ''}
        ingenios={ingeniosOpts}
        activeSuerteCodes={activeSuerteCodes}
        onApplied={({ inserted, updated, deactivated }) => {
          const key = (r: { ingenio_id: string; haciendaCode: string; suerte: string }) =>
            `${r.ingenio_id}|${r.haciendaCode}|${r.suerte}`
          setMaestro((prev) => {
            let next = prev
            // Agregar nuevas/reactivadas (sin duplicar).
            if (inserted.length) {
              const have = new Set(next.map(key))
              const add = inserted.filter((r) => !have.has(key(r)))
              if (add.length) next = [...next, ...add]
            }
            // Aplicar áreas cambiadas.
            if (updated.length) {
              const upMap = new Map(updated.map((u) => [key(u), u.area]))
              next = next.map((r) => {
                const a = upMap.get(key(r))
                return a !== undefined ? { ...r, area: a } : r
              })
            }
            // Quitar desactivadas.
            if (deactivated.length) {
              const del = new Set(deactivated.map(key))
              next = next.filter((r) => !del.has(key(r)))
            }
            return next
          })
          if (inserted.length === 0 && updated.length === 0 && deactivated.length === 0) {
            setInfo('Catálogo revisado: no había cambios que aplicar.')
          } else {
            setInfo(
              `Catálogo actualizado: ${inserted.length} agregada(s)/reactivada(s), ${updated.length} área(s) cambiada(s), ${deactivated.length} desactivada(s).`,
            )
          }
        }}
      />
    </section>
  )
}

export default MaestrosTab
