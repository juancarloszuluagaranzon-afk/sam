import { cuadreFactura } from '../lib/valorFactura'
import './cuadreFactura.css'

export function CuadreFactura({ total, suma, sinPrecio = 0, compacto = false }: {
  total: number | null
  suma: number
  sinPrecio?: number
  compacto?: boolean
}) {
  const cuadre = cuadreFactura(total, suma)
  const pesos = (valor: number) => `$${Math.round(valor).toLocaleString('es-CO')}`
  const progreso = total && total > 0 ? Math.min(100, suma / total * 100) : 0
  const estado = sinPrecio > 0 ? `Sin precio en ${sinPrecio} ${sinPrecio === 1 ? 'línea' : 'líneas'}`
    : cuadre.estado === 'sin_total' ? 'Sin total'
      : cuadre.estado === 'cuadra' ? 'Cuadra'
        : cuadre.estado === 'faltan' ? `Faltan ${pesos(cuadre.diferencia ?? 0)}`
          : `Se pasa ${pesos(Math.abs(cuadre.diferencia ?? 0))}`
  const clase = sinPrecio > 0 || cuadre.estado === 'sin_total' ? 'sin-total' : cuadre.estado
  const etiqueta = sinPrecio > 0 ? `${pesos(suma)} · Sin precio en ${sinPrecio} ${sinPrecio === 1 ? 'línea' : 'líneas'}`
    : cuadre.estado === 'sin_total' ? `${pesos(suma)} · Sin total`
      : cuadre.estado === 'cuadra' ? `${pesos(suma)} · Cuadra`
        : cuadre.estado === 'faltan' ? `${pesos(suma)} · Faltan ${pesos(cuadre.diferencia ?? 0)}`
          : `${pesos(suma)} · Se pasa ${pesos(Math.abs(cuadre.diferencia ?? 0))}`
  return (
    <div className={`cuadre-factura${compacto ? ' compacto' : ''}`}>
      {!compacto && <div className="cuadre-factura-fila"><span>Total de la factura (lo que dice el PDF)</span><b>{total == null ? 'Sin total' : pesos(total)}</b></div>}
      <div className="cuadre-factura-fila"><span>{compacto ? (total == null ? 'Sin total' : pesos(total)) : 'Suma de las líneas pegadas'}</span><b>{compacto ? etiqueta : pesos(suma)}</b></div>
      <div className="cuadre-factura-barra"><span style={{ width: `${progreso}%` }} /></div>
      <div className="cuadre-factura-fila"><span>{compacto ? 'Cuadre' : 'Diferencia'}</span><b className={`cuadre-factura-estado ${clase}`}>{estado}</b></div>
      {!compacto && <p className="cuadre-factura-ayuda">{sinPrecio > 0 ? `Hay ${sinPrecio} líneas sin precio; no se puede confirmar el cuadre.`
        : cuadre.estado === 'cuadra' ? 'Cuadra'
          : cuadre.estado === 'faltan' ? `Faltan ${pesos(cuadre.diferencia ?? 0)} · revisa las tarifas`
            : cuadre.estado === 'se_pasa' ? `Lo pegado se pasa ${pesos(Math.abs(cuadre.diferencia ?? 0))}`
              : 'Anota el total de la factura para compararlo.'}</p>}
    </div>
  )
}
