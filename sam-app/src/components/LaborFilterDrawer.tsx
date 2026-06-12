import { useAppData } from '../context/AppDataContext'

interface StatusOption {
  value: string
  label: string
}

interface Ingenio {
  id: string
  nombre: string
}

interface LaborFilterDrawerProps {
  open: boolean
  onClose: () => void
  activeFilterCount: number
  onClear: () => void
  statusFilter: string
  setStatusFilter: (v: string) => void
  statusOptions: StatusOption[]
  operatorFilter: string
  setOperatorFilter: (v: string) => void
  ingenioFilter: string
  setIngenioFilter: (v: string) => void
  ingenios: Ingenio[]
  haciendaFilter: string
  setHaciendaFilter: (v: string) => void
  haciendaFilterOptions: { code: string; name: string }[]
  resultCount: number
}

/**
 * Drawer lateral de filtros (Estado, Operario, Ingenio, Hacienda) compartido por
 * las pestañas Labores y Resumen. El estado de los filtros vive en App.tsx y se
 * comparte: filtrar en una pestaña aplica en la otra. Las opciones de Estado se
 * pasan por prop porque difieren (Labores incluye "Por aprobar"; el Resumen
 * incluye "Parcial").
 */
export function LaborFilterDrawer({
  open,
  onClose,
  activeFilterCount,
  onClear,
  statusFilter,
  setStatusFilter,
  statusOptions,
  operatorFilter,
  setOperatorFilter,
  ingenioFilter,
  setIngenioFilter,
  ingenios,
  haciendaFilter,
  setHaciendaFilter,
  haciendaFilterOptions,
  resultCount,
}: LaborFilterDrawerProps) {
  const { operators } = useAppData()

  return (
    <>
      <div
        className={`filter-drawer-overlay${open ? ' open' : ''}`}
        onClick={onClose}
      />
      <aside className={`filter-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="filter-drawer__head">
          <button
            type="button"
            className="filter-drawer__back"
            onClick={onClose}
            aria-label="Cerrar filtros"
          >
            &#x2190;
          </button>
          <h3>Filtrar</h3>
          <button
            type="button"
            className="filter-drawer__clear"
            onClick={onClear}
            disabled={activeFilterCount === 0}
          >
            Limpiar
          </button>
        </div>

        <div className="filter-drawer__body">
          <label className="filter-drawer__field">
            Estado
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="filter-drawer__field">
            Operario
            <select value={operatorFilter} onChange={(event) => setOperatorFilter(event.target.value)}>
              <option value="TODOS">Todos los operarios</option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>{operator.name}</option>
              ))}
            </select>
          </label>

          <label className="filter-drawer__field">
            Ingenio
            <select
              value={ingenioFilter}
              onChange={(event) => {
                setIngenioFilter(event.target.value)
                setHaciendaFilter('TODAS')
              }}
            >
              <option value="TODOS">Todos los ingenios</option>
              {ingenios.map((ing) => (
                <option key={ing.id} value={ing.id}>{ing.nombre}</option>
              ))}
            </select>
          </label>

          <label className="filter-drawer__field">
            Hacienda
            <select value={haciendaFilter} onChange={(event) => setHaciendaFilter(event.target.value)}>
              <option value="TODAS">Todas las haciendas</option>
              {haciendaFilterOptions.map(({ code, name }) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="filter-drawer__footer">
          <p className="filter-drawer__count">
            Mostrando <strong>{resultCount}</strong>{' '}
            {resultCount === 1 ? 'resultado' : 'resultados'}
          </p>
          <button type="button" className="primary-button" onClick={onClose}>
            Ver resultados
          </button>
        </div>
      </aside>
    </>
  )
}
