import { useMemo } from 'react'
import { SearchableSelect } from './SearchableSelect'
import { buildMonthOptions } from './EntityHistoryModal'
import { opcionesFiltros, type FiltrosLabor, type PeriodoFiltro } from '../lib/filtrosPeriodoLabor'
import type { Assignment, Ingenio } from '../domain/sam'

/**
 * Los filtros del Reporte (período, mes, fechas, ingenio, hacienda, suerte y operador) para Facturación y
 * Cartera. Misma apariencia y mismo orden que el Reporte (clases `report-filter-*`). Las listas largas llevan
 * búsqueda (`SearchableSelect`). `conTodo` agrega «Todo el realizado» / «Todas las fechas» como período.
 */
interface Props {
  filtros: FiltrosLabor
  onChange: (f: FiltrosLabor) => void
  asignaciones: Assignment[]
  ingenios: Ingenio[]
  ingenioDe: (a: Assignment) => string | null
  todayKey: string
  textoTodo: string
}

export function FiltrosPeriodoLabor({ filtros, onChange, asignaciones, ingenios, ingenioDe, todayKey, textoTodo }: Props) {
  const meses = useMemo(() => buildMonthOptions(todayKey.slice(0, 7)), [todayKey])
  const opciones = useMemo(() => opcionesFiltros(asignaciones, filtros, ingenioDe), [asignaciones, filtros.ingenioId, filtros.haciendaCode, ingenioDe]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (cambio: Partial<FiltrosLabor>) => onChange({ ...filtros, ...cambio })
  const usaMes = filtros.period === 'PRIMERA' || filtros.period === 'SEGUNDA' || filtros.period === 'MES'

  return (
    <div className="report-filters filtros-labor">
      <div className="report-filter-row">
        <label className="report-filter-label">
          Período
          <select value={filtros.period} onChange={(e) => set({ period: e.target.value as PeriodoFiltro })}>
            <option value="TODO">{textoTodo}</option>
            <option value="HOY">Hoy</option>
            <option value="AYER">Ayer</option>
            <option value="PRIMERA">1ra quincena (1-15)</option>
            <option value="SEGUNDA">2da quincena (16-fin)</option>
            <option value="MES">Mes completo</option>
            <option value="CUSTOM">Personalizado</option>
          </select>
        </label>
        {usaMes && (
          <label className="report-filter-label">
            Mes
            <select value={filtros.mes} onChange={(e) => set({ mes: e.target.value })}>
              {meses.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        )}
        {filtros.period === 'CUSTOM' && (
          <>
            <label className="report-filter-label">
              Desde
              <input type="date" value={filtros.desde} onChange={(e) => set({ desde: e.target.value })} />
            </label>
            <label className="report-filter-label">
              Hasta
              <input type="date" value={filtros.hasta} onChange={(e) => set({ hasta: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <div className="filtros-labor-grid">
        <SearchableSelect
          value={filtros.ingenioId}
          onChange={(v) => set({ ingenioId: v, haciendaCode: '', suerte: '' })}
          placeholder="Todos los ingenios"
          options={ingenios.filter((i) => i.activo).map((i) => ({ value: i.id, label: i.nombre }))}
        />
        <SearchableSelect
          value={filtros.haciendaCode}
          onChange={(v) => set({ haciendaCode: v, suerte: '' })}
          placeholder="Todas las haciendas"
          options={opciones.haciendas.map((h) => ({ value: h.code, label: h.name }))}
        />
        <SearchableSelect
          value={filtros.suerte}
          onChange={(v) => set({ suerte: v })}
          placeholder="Todas las suertes"
          options={opciones.suertes.map((s) => ({ value: s, label: s }))}
        />
        <SearchableSelect
          value={filtros.operatorId}
          onChange={(v) => set({ operatorId: v })}
          placeholder="Todos los operadores"
          options={opciones.operadores.map((o) => ({ value: o.id, label: o.name, rightLabel: o.id }))}
        />
      </div>
    </div>
  )
}
