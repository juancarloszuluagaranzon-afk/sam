import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import SearchableSelect from '../components/SearchableSelect'
import { fmtCantidad } from '../lib/cantidad'
import { consumoInsumoPorMaquina } from '../lib/insumoPorMaquina'
import { fmtFechaHora } from '../lib/fechas'
import { loadKardexReporte } from '../services/samApi'
import type { InsumoKardex } from '../domain/sam'
import './olaReunion.css'

export function ConsumoOtrosInsumos({ desde, hasta, periodoTexto }: { desde: string; hasta: string; periodoTexto: string }) {
  const { insumos } = useAppData()
  const opciones = useMemo(() => insumos.filter((i) => i.activo && i.categoria !== 'COMBUSTIBLE' && i.nombre.trim().toUpperCase() !== 'GANCHOS')
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((i) => ({ value: i.id, label: `${i.nombre} (${i.unidad})` })), [insumos])
  const [insumoId, setInsumoId] = useState('')
  const [kardex, setKardex] = useState<InsumoKardex[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setErrorLocal] = useState('')
  const insumo = insumos.find((i) => i.id === insumoId)
  useEffect(() => {
    if (!desde || !hasta) return
    let vivo = true
    setCargando(true); setErrorLocal('')
    loadKardexReporte({ desde, hasta }).then((datos) => { if (vivo) setKardex(datos) })
      .catch((e: Error) => { if (vivo) setErrorLocal(e.message || 'No se pudo cargar el kardex del periodo.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [desde, hasta])
  const filas = useMemo(() => consumoInsumoPorMaquina(kardex, insumoId), [kardex, insumoId])
  const max = Math.max(1, ...filas.map((f) => Number(f.cantidad) || 0))
  return <section aria-label={`Otros insumos · ${periodoTexto}`}>
    <label>Insumo<SearchableSelect value={insumoId} onChange={setInsumoId} options={opciones} placeholder="Insumo" /></label>
    {cargando && <p className="muted-text">Cargando…</p>}
    {error && <p role="alert" className="ola-error">No se pudo cargar el consumo: {error}</p>}
    {!insumoId && <p className="muted-text">Escoge un insumo para ver cuánto se le ha entregado a cada máquina.</p>}
    {insumo && !cargando && !error && filas.length === 0 && <p className="muted-text">Ninguna máquina recibió este insumo en el periodo.</p>}
    {insumo && filas.length > 0 && <>
      <div aria-label="Cantidad entregada por máquina">{filas.map((f) => {
        const cantidad = Number(f.cantidad) || 0
        return <div className="ola-consumo-barra" key={f.maquina}>
          <span>{f.maquina}</span><span className="ola-consumo-barra__pista"><span className="ola-consumo-barra__relleno" style={{ display: 'block', width: `${Math.max(0, Math.min(100, (cantidad / max) * 100))}%` }} /></span>
          <strong>{fmtCantidad(cantidad, insumo.unidad)} {insumo.unidad}</strong>
        </div>
      })}</div>
      <div style={{ overflowX: 'auto' }}><table className="ola-consumo-tabla">
        <thead><tr><th>Máquina</th><th>Cantidad</th><th>Entregas</th><th>Última entrega</th></tr></thead>
        <tbody>{filas.map((f) => <tr key={f.maquina}><td>{f.maquina}</td><td>{fmtCantidad(Number(f.cantidad) || 0, insumo.unidad)} {insumo.unidad}</td><td>{f.entregas}</td><td>{fmtFechaHora(f.ultima)}</td></tr>)}</tbody>
      </table></div>
    </>}
  </section>
}
