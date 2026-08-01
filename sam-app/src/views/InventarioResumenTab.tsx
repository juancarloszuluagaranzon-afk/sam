import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadBodegas, loadStockBodega, loadKardexReporte, updateInsumo } from '../services/samApi'
import type { Bodega, StockBodega, InsumoKardex, Insumo } from '../domain/sam'
import { fmtCantidad } from '../lib/cantidad'

/**
 * Resumen de inventario: cuánto hay, dónde está y qué se mueve.
 *
 * Antes había que sumar a mano: Inventario daba el total de la empresa y
 * Bodegas el reparto, pero en dos pantallas distintas y sin decir qué se está
 * gastando. La pregunta de todos los días —"¿cuánto combustible me queda y en
 * qué carro está?"— no tenía dónde responderse de un vistazo.
 *
 * DESTACADOS: en la práctica el negocio se mueve con dos o tres materiales
 * (hoy combustible y ganchos). Esos van cada uno con su tarjeta y su columna;
 * los demás se resumen en "Otros" para que la pantalla no se vuelva una lista
 * de 16 renglones donde 14 están en cero. Cuáles son destacados se elige aquí
 * mismo, y es la misma marca ⭐ que hace que salgan de primeras en los
 * selectores (`insumos.frecuente`).
 *
 * ⚠️ NO se suman cantidades de insumos distintos: galones y unidades no se
 * suman. "Otros" cuenta MATERIALES, no cantidades.
 */

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Periodo = 'HOY' | 'PRIMERA' | 'SEGUNDA' | 'MES'
const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'HOY', label: 'Hoy' },
  { value: 'PRIMERA', label: '1ra quinc.' },
  { value: 'SEGUNDA', label: '2da quinc.' },
  { value: 'MES', label: 'Mes' },
]

function rangoDe(p: Periodo, hoy: string): { desde: string; hasta: string } {
  const [y, m] = hoy.split('-')
  const finMes = `${y}-${m}-${String(new Date(Number(y), Number(m), 0).getDate()).padStart(2, '0')}`
  if (p === 'PRIMERA') return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-15` }
  if (p === 'SEGUNDA') return { desde: `${y}-${m}-16`, hasta: finMes }
  if (p === 'MES') return { desde: `${y}-${m}-01`, hasta: finMes }
  return { desde: hoy, hasta: hoy }
}

export function InventarioResumenTab() {
  const { insumos, setInsumos, busy, setBusy, setError, setInfo } = useAppData()
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [stock, setStock] = useState<StockBodega[]>([])
  const [movs, setMovs] = useState<InsumoKardex[]>([])
  const [cargando, setCargando] = useState(true)

  const [periodo, setPeriodo] = useState<Periodo>('MES')
  /** '' = todas. Filtra existencias Y movimiento a la vez. */
  const [bodegaFiltro, setBodegaFiltro] = useState('')
  const [verOtros, setVerOtros] = useState(false)
  const [eligiendo, setEligiendo] = useState(false)

  const { desde, hasta } = useMemo(() => rangoDe(periodo, hoyISO()), [periodo])

  const cargar = useCallback(async () => {
    setCargando(true)
    const [bs, st, mv] = await Promise.all([
      loadBodegas(), loadStockBodega(), loadKardexReporte({ desde, hasta: `${hasta}T23:59:59` }),
    ])
    setBodegas(bs.filter((b) => b.activo !== false))
    setStock(st)
    setMovs(mv)
    setCargando(false)
  }, [desde, hasta])

  useEffect(() => { void cargar() }, [cargar])

  const info = useMemo(() => {
    const m = new Map<string, Insumo>()
    insumos.forEach((i) => m.set(i.id, i))
    return m
  }, [insumos])

  const destacados = useMemo(
    () => insumos.filter((i) => i.frecuente && i.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [insumos],
  )
  const esDestacado = useCallback((id: string) => destacados.some((d) => d.id === id), [destacados])

  /** El stock que se está mirando: todo, o el de una sola bodega. */
  const stockVisible = useMemo(
    () => (bodegaFiltro ? stock.filter((s) => s.bodegaId === bodegaFiltro) : stock),
    [stock, bodegaFiltro],
  )

  /** Existencias por insumo, ya filtradas por bodega. */
  const existencias = useMemo(() => {
    const m = new Map<string, number>()
    stockVisible.forEach((s) => m.set(s.insumoId, (m.get(s.insumoId) ?? 0) + s.stock))
    return m
  }, [stockVisible])

  /**
   * "Otros" cuenta MATERIALES, no cantidades: sumar galones con unidades no
   * significa nada. Se listan aparte con su propia unidad.
   */
  const otros = useMemo(
    () => insumos
      .filter((i) => i.activo && !esDestacado(i.id))
      .map((i) => ({ insumo: i, cantidad: existencias.get(i.id) ?? 0 }))
      .filter((x) => x.cantidad !== 0)
      .sort((a, b) => b.cantidad - a.cantidad),
    [insumos, esDestacado, existencias],
  )

  /** En cuántas bodegas hay existencia de este insumo. */
  const bodegasCon = useCallback(
    (insumoId: string) => stockVisible.filter((s) => s.insumoId === insumoId && s.stock > 0).length,
    [stockVisible],
  )

  /**
   * Consumo del periodo: lo que de verdad se gastó.
   *
   * ⚠️ Consumo NO es "todo lo que salió de la bodega". Surtir un carro es un
   * MOVIMIENTO entre bodegas: el material sigue siendo de la empresa, está en
   * el carro, no se gastó. Contarlo aquí inflaba el consumo de la principal
   * con los 330 galones que solo se habían pasado a los carros.
   *
   * Se gasta cuando va a una MÁQUINA. Por eso el criterio es `equipoCodigo`:
   * lo mismo que usa el reporte de consumo por equipo, para que los dos den
   * el mismo número.
   */
  const consumo = useMemo(() => {
    const enRango = bodegaFiltro ? movs.filter((m) => m.bodegaId === bodegaFiltro) : movs
    const m = new Map<string, number>()
    for (const k of enRango) {
      if (!k.equipoCodigo) continue
      if (k.tipo === 'SALIDA') m.set(k.insumoId, (m.get(k.insumoId) ?? 0) + k.cantidad)
      // Lo que el operario devolvió por diferencia: descuenta del consumo.
      else if (k.tipo === 'ENTRADA') m.set(k.insumoId, (m.get(k.insumoId) ?? 0) - k.cantidad)
    }
    return Array.from(m.entries())
      .map(([id, total]) => ({ id, total, insumo: info.get(id) }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [movs, bodegaFiltro, info])

  const maxConsumo = consumo[0]?.total ?? 0

  async function alternarDestacado(i: Insumo) {
    setBusy(true); setError('')
    try {
      const upd = await updateInsumo(i.id, { frecuente: !i.frecuente })
      setInsumos((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setInfo(upd.frecuente ? `${upd.nombre} queda destacado.` : `${upd.nombre} pasa a Otros.`)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'No se pudo guardar')
    } finally { setBusy(false) }
  }

  const bodegaNombre = bodegaFiltro ? bodegas.find((b) => b.id === bodegaFiltro)?.nombre : null

  return (
    <section className="panel">
      <div className="panel-title split">
        <h2>📊 Resumen de inventario</h2>
        <button type="button" className="inline-button" onClick={() => void cargar()} disabled={cargando}>
          ↻ Actualizar
        </button>
      </div>
      <p className="subtle-copy">
        Cuánto hay, en qué bodega está y qué se está gastando.
        {bodegaNombre && <> Mostrando solo <strong>{bodegaNombre}</strong>.</>}
      </p>

      {/* Filtro por bodega: manda sobre TODO lo de abajo, existencias y consumo */}
      <div className="sol-filtros" style={{ marginTop: 10 }}>
        <button type="button" className={`sol-filtro${!bodegaFiltro ? ' is-active' : ''}`} onClick={() => setBodegaFiltro('')}>
          🏢 Toda la empresa
        </button>
        {bodegas.map((b) => (
          <button key={b.id} type="button"
            className={`sol-filtro${bodegaFiltro === b.id ? ' is-active' : ''}`}
            onClick={() => setBodegaFiltro(b.id)}>
            {b.tipo === 'PRINCIPAL' ? '🏢' : '🚚'} {b.nombre}
          </button>
        ))}
      </div>

      {/* El catálogo llega por el contexto compartido, no con esta pantalla.
          Sin esperarlo se ve un parpadeo feo: el UUID crudo del insumo y un
          "no has elegido destacados" que no es cierto. */}
      {cargando || insumos.length === 0 ? (
        <p className="muted-text">Cargando…</p>
      ) : (
        <>
          {/* ── Lo que hay hoy ── */}
          <p className="ins-res__lbl" style={{ marginTop: 16 }}>Existencias hoy</p>
          {destacados.length === 0 ? (
            <p className="muted-text">
              Todavía no has elegido materiales destacados. Sin eso no hay nada que resumir:
              marca los dos o tres que manejas a diario con el botón de abajo.
            </p>
          ) : (
            <div className="res-tarjetas">
              {destacados.map((d) => (
                <div key={d.id} className="res-tarjeta">
                  <span className="res-tarjeta__nom">
                    {d.categoria === 'COMBUSTIBLE' ? '⛽' : '🔩'} {d.nombre}
                  </span>
                  <strong className="res-tarjeta__val">
                    {fmtCantidad(existencias.get(d.id) ?? 0, d.unidad)} <small>{d.unidad}</small>
                  </strong>
                  <span className="res-tarjeta__pie">
                    {bodegaFiltro ? 'en esta bodega' : `en ${bodegasCon(d.id)} bodega(s)`}
                  </span>
                </div>
              ))}
              <button type="button" className="res-tarjeta res-tarjeta--otros" onClick={() => setVerOtros(!verOtros)}>
                <span className="res-tarjeta__nom">📦 Otros</span>
                <strong className="res-tarjeta__val">{otros.length} <small>con existencia</small></strong>
                <span className="res-tarjeta__pie">
                  {otros.length > 0 ? (verOtros ? 'ocultar ▴' : 'ver cuáles ▾') : 'todos en cero'}
                </span>
              </button>
            </div>
          )}

          {verOtros && otros.length > 0 && (
            <div className="inv-list" style={{ marginTop: 8 }}>
              {otros.map(({ insumo: i, cantidad }) => (
                <div key={i.id} className="bod-stock__row">
                  <span className="bod-stock__nom">{i.nombre}</span>
                  <strong className="bod-stock__val">
                    {fmtCantidad(cantidad, i.unidad)} <small>{i.unidad}</small>
                  </strong>
                </div>
              ))}
            </div>
          )}

          {/* ── Dónde está: la tabla que responde "¿en qué carro?" ── */}
          {!bodegaFiltro && destacados.length > 0 && (
            <>
              <p className="ins-res__lbl" style={{ marginTop: 18 }}>Dónde está</p>
              <div className="res-tabla-wrap">
                <table className="res-tabla">
                  <thead>
                    <tr>
                      <th>Bodega</th>
                      {destacados.map((d) => <th key={d.id}>{d.nombre}</th>)}
                      <th>Otros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bodegas.map((b) => {
                      const suyo = stock.filter((s) => s.bodegaId === b.id && s.stock !== 0)
                      const cuantosOtros = suyo.filter((s) => !esDestacado(s.insumoId)).length
                      return (
                        <tr key={b.id}>
                          <th scope="row">{b.tipo === 'PRINCIPAL' ? '🏢' : '🚚'} {b.nombre}</th>
                          {destacados.map((d) => {
                            const n = suyo.find((s) => s.insumoId === d.id)?.stock ?? 0
                            return (
                              <td key={d.id} className={n === 0 ? 'res-tabla__cero' : undefined}>
                                {n === 0 ? '—' : fmtCantidad(n, d.unidad)}
                              </td>
                            )
                          })}
                          <td className={cuantosOtros === 0 ? 'res-tabla__cero' : undefined}>
                            {cuantosOtros === 0 ? '—' : `${cuantosOtros} mat.`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="subtle-copy">
                Cada bodega muestra lo que tiene ella. Lo que está en los carros ya salió de la
                principal, así que no se cuenta dos veces.
              </p>
            </>
          )}

          {/* ── Lo que más se mueve ── */}
          <p className="ins-res__lbl" style={{ marginTop: 18 }}>Lo que más se gasta <span className="field-optional">(lo cargado a máquinas)</span></p>
          <div className="sol-filtros">
            {PERIODOS.map((p) => (
              <button key={p.value} type="button"
                className={`sol-filtro${periodo === p.value ? ' is-active' : ''}`}
                onClick={() => setPeriodo(p.value)}>
                {p.label}
              </button>
            ))}
          </div>

          {consumo.length === 0 ? (
            <p className="muted-text">Sin salidas en este periodo.</p>
          ) : (
            <div className="res-barras">
              {consumo.map((c) => (
                <div key={c.id} className="res-barra">
                  <div className="res-barra__top">
                    <span>{c.insumo?.nombre ?? c.id}</span>
                    <strong>{fmtCantidad(c.total, c.insumo?.unidad)} {c.insumo?.unidad ?? ''}</strong>
                  </div>
                  <div className="res-barra__pista">
                    <div
                      className="res-barra__fill"
                      style={{ width: `${maxConsumo > 0 ? Math.max(2, (c.total / maxConsumo) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Qué es destacado: aquí mismo, que es donde se nota ── */}
          <div className="res-destacados">
            <button type="button" className="inline-button" onClick={() => setEligiendo(!eligiendo)}>
              ⭐ {eligiendo ? 'Listo' : 'Elegir materiales destacados'}
            </button>
            {eligiendo && (
              <>
                <p className="subtle-copy" style={{ marginTop: 8 }}>
                  Los destacados llevan su propia tarjeta y su columna aquí arriba, y salen de
                  primeras cuando alguien busca un insumo en el celular. El resto se resume en
                  "Otros". Dos o tres es lo sano.
                </p>
                <div className="inv-list" style={{ marginTop: 8 }}>
                  {insumos.filter((i) => i.activo)
                    .sort((a, b) => Number(b.frecuente) - Number(a.frecuente) || a.nombre.localeCompare(b.nombre, 'es'))
                    .map((i) => (
                      <button key={i.id} type="button" className="cat-row" disabled={busy}
                        onClick={() => void alternarDestacado(i)}>
                        <span className="cat-row__val">
                          {i.frecuente ? '⭐ ' : ''}{i.nombre}
                          <small className="bod-stock__reparto">
                            {i.frecuente ? 'destacado' : 'va en Otros'}
                          </small>
                        </span>
                        <span className="consumo-maq__ver">{i.frecuente ? 'quitar' : 'destacar'}</span>
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default InventarioResumenTab
