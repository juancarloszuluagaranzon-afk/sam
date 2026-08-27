import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { loadHorometros } from '../services/tallerApi'
import { fmtFechaHora } from '../lib/fechas'
import { MAX_HORAS_ENTRE_LECTURAS, guardarReferencias } from '../lib/horometro'

/**
 * El último horómetro de cada máquina — la referencia con la que se juzga si un
 * registro nuevo es creíble.
 *
 * **Por qué existe.** El aviso de las 24 horas compara contra un número que
 * hasta ahora no se veía en ninguna parte: si a alguien le sale la alarma y no
 * está de acuerdo, no tenía cómo comprobar contra qué se lo están comparando.
 * Una regla que no se puede auditar se convierte en un estorbo y la gente
 * aprende a ignorarla.
 *
 * 🔴 El número que se muestra es el LIMPIO, no la última fila cruda: sale de
 * `equipo_horometro_v`, que descarta las lecturas cuya magnitud no cuadra con la
 * de esa máquina —unos digitan 5407 y otros 54030— y le da prioridad a la
 * corrección manual del taller. Es exactamente el mismo dato contra el que
 * compara el aviso, y eso es el punto: lo que se ve aquí es lo que decide allá.
 */

function n1(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)
}

/** Días transcurridos desde la lectura. Sirve para ver cuál está quedando vieja. */
function diasDesde(iso: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

export function HorometrosTab() {
  const { sortedEquipment } = useAppData()
  const [filas, setFilas] = useState<Array<{ codigo: string; horometro: number; leidoEn: string; fuente: string }>>([])
  const [cargando, setCargando] = useState(true)
  const [busca, setBusca] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const datos = await loadHorometros()
      setFilas(datos.map((d) => ({
        codigo: d.codigo, horometro: d.horometro, leidoEn: d.leidoEn, fuente: d.fuente,
      })))
      // De paso se refresca el espejo que usa el aviso sin señal: quien abre
      // esta pantalla deja el dato actualizado en su equipo.
      const refs: Record<string, number> = {}
      for (const d of datos) if (d.horometro > 0) refs[d.codigo] = d.horometro
      if (Object.keys(refs).length) guardarReferencias(refs)
    } finally { setCargando(false) }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const nombreDe = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const con = filas.map((f) => ({
      ...f,
      nombre: nombreDe.get(f.codigo) ?? f.codigo,
      dias: diasDesde(f.leidoEn),
      // El techo que aceptaría el aviso para el próximo registro de esa máquina.
      techo: f.horometro > 0 ? f.horometro + MAX_HORAS_ENTRE_LECTURAS : null,
    }))
    const filtradas = q
      ? con.filter((f) => `${f.codigo} ${f.nombre}`.toLowerCase().includes(q))
      : con
    // Las de lectura más vieja arriba: son las que hay que ir a mirar.
    return filtradas.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))
  }, [filas, nombreDe, busca])

  const sinLectura = useMemo(
    () => sortedEquipment.filter((e) => !filas.some((f) => f.codigo === e.code)),
    [sortedEquipment, filas],
  )

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Horómetros por máquina</h2>
        <button type="button" className="inline-button" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? 'Actualizando…' : '↻ Actualizar'}
        </button>
      </div>

      <Ayuda>
        <p>
          Esta es la <strong>última lectura buena</strong> de cada máquina, y es contra la que
          el sistema juzga los registros nuevos: si alguien escribe un horómetro que supera
          en más de <strong>{MAX_HORAS_ENTRE_LECTURAS} horas</strong> el que aparece aquí,
          le sale un aviso al guardar.
        </p>
        <p>
          <strong>No es la última fila registrada:</strong> se descartan las lecturas cuya
          magnitud no cuadra con la de esa máquina —unos digitan 5407 y otros 54030 para lo
          mismo— y manda la corrección manual del taller. Por eso el número de aquí puede no
          ser el último que alguien tecleó, y está bien que así sea.
        </p>
      </Ayuda>

      <input type="search" className="labores-search-input" placeholder="Buscar máquina…"
             value={busca} onChange={(e) => setBusca(e.target.value)} style={{ margin: '12px 0' }} />

      {cargando && <p className="muted-text">Cargando horómetros…</p>}

      {!cargando && (
        <div className="tabla-scroll">
          <table className="horometros-tabla">
            <thead>
              <tr>
                <th>Máquina</th>
                <th className="n">Último horómetro</th>
                <th className="n">Tope que acepta</th>
                <th>Cuándo se leyó</th>
                <th>De dónde salió</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.codigo} className={f.dias != null && f.dias > 7 ? 'fila-vieja' : ''}>
                  <td>
                    <strong>{f.nombre}</strong>
                    <span className="field-optional"> {f.codigo}</span>
                  </td>
                  <td className="n"><strong>{n1(f.horometro)}</strong></td>
                  <td className="n field-optional">{n1(f.techo)}</td>
                  <td>
                    {f.leidoEn ? fmtFechaHora(f.leidoEn) : '—'}
                    {f.dias != null && f.dias > 7 && (
                      <span className="field-optional"> · hace {f.dias} días</span>
                    )}
                  </td>
                  <td className="field-optional">{f.fuente || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cargando && sinLectura.length > 0 && (
        <div className="horometros-sin">
          <h4>Sin ninguna lectura ({sinLectura.length})</h4>
          <p className="subtle-copy">
            A estas máquinas el aviso <strong>no les dice nada</strong>: sin un dato con qué
            comparar, inventar una alarma es peor que callarse. Empiezan a validarse en cuanto
            alguien les registre el primer horómetro.
          </p>
          <div className="horometros-sin__lista">
            {sinLectura.map((e) => (
              <span key={e.code} className="madera-chip">{e.name}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default HorometrosTab
