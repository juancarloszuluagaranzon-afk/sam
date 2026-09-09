import { useMemo, useState } from 'react'
import type { Assignment, InsumoKardex } from '../domain/sam'
import { Donut, BarrasH, plegarOtros, SERIES, type Punto } from '../components/Charts'
import {
  type Catalogo, porMaterial, materialPorMaquina, combustiblePorMaquina,
  ganchosPorMaquina, materialesDeMaquina, galonesPorHectarea,
} from '../lib/insumosDash'

/**
 * «Insumos y materiales» del tablero de Operación general.
 *
 * Tres tortas y un número. Las tortas: entregas por material, combustible por
 * máquina, ganchos por máquina. El número: **galones por hectárea** — el
 * combustible del periodo contra las hectáreas del mismo periodo, con el mismo
 * filtro de fechas que todo lo demás. Es lo que une las dos mitades de este
 * tablero: lo que se hizo y lo que costó hacerlo.
 *
 * 🔴 **Todo se toca y cada toque segrega un nivel más.** Torta → ese material
 * por máquina → las entregas de esa máquina → la entrega completa. O al revés:
 * máquina → sus materiales → entregas. El nivel vive en `vista`; el «← Insumos»
 * siempre vuelve al principio.
 *
 * 🔴 **La torta por material cuenta ENTREGAS, no cantidades.** 40 ganchos + 24
 * galones es un número que no significa nada; 94 entregas de ganchos y 517 de
 * combustible sí son comparables.
 *
 * La regla del gal/ha que más importa: **compárese por labor, no por máquina**.
 * Las PUMA gastan 3–5 gal/ha contra 0,8–1,4 del resto porque hacen TRIPLE,
 * SUBSUELO y FERTILIZACIÓN, no porque sean peores. Por eso cada máquina sale con su labor
 * dominante al lado.
 */

type Vista =
  | { nivel: 'inicio' }
  /** Un material, repartido por máquina. */
  | { nivel: 'material'; insumoId: string }
  /** Una máquina, repartida por material. */
  | { nivel: 'maquina'; maquina: string }
  /** Una labor: las máquinas que la hicieron, con su gal/ha. */
  | { nivel: 'labor'; labor: string }
  /** La cola de «Otros» de alguna torta, desplegada. */
  | { nivel: 'otros'; de: 'material' | 'combustible' | 'ganchos'; ids: string[] }

const nf = (n: number, d = 2) => n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })

export function InsumosCard({
  movs, cerradas, catalogo, nombreMaq, unSoloDia, cargando, onVerEntregas, compacta,
}: {
  /** Solo los consumos: SALIDA con máquina. */
  movs: InsumoKardex[]
  cerradas: Assignment[]
  catalogo: Catalogo
  nombreMaq: (codigo: string) => string
  /** Hoy / Ayer: un tanqueo alimenta varios días y el gal/ha de un día es ruidoso. */
  unSoloDia: boolean
  cargando: boolean
  /** Abre la lista de entregas (y de ahí la entrega completa). */
  onVerEntregas: (titulo: string, items: InsumoKardex[]) => void
  /**
   * Sin las tres cajas de resumen. Para el host que YA tiene su propia fila
   * de KPI justo arriba (el tablero de insumos): dos filas de cifras
   * seguidas es lo que el cliente llamó «saturado».
   */
  compacta?: boolean
}) {
  const [vista, setVista] = useState<Vista>({ nivel: 'inicio' })
  const [verMaq, setVerMaq] = useState(false)

  const material = useMemo(() => porMaterial(movs, catalogo), [movs, catalogo])
  const combustible = useMemo(() => combustiblePorMaquina(movs, catalogo, nombreMaq), [movs, catalogo, nombreMaq])
  const ganchos = useMemo(() => ganchosPorMaquina(movs, catalogo, nombreMaq), [movs, catalogo, nombreMaq])
  const galha = useMemo(() => galonesPorHectarea(movs, cerradas, catalogo), [movs, cerradas, catalogo])

  const materialPlegado = useMemo(() => plegarOtros(material), [material])
  const combustiblePlegado = useMemo(() => plegarOtros(combustible), [combustible])
  const ganchosPlegado = useMemo(() => plegarOtros(ganchos), [ganchos])

  const maquinasAtendidas = useMemo(() => new Set(movs.map((k) => k.equipoCodigo)).size, [movs])
  const totalGal = useMemo(() => combustible.reduce((s, p) => s + p.valor, 0), [combustible])
  const totalGanchos = useMemo(() => ganchos.reduce((s, p) => s + p.valor, 0), [ganchos])

  /** La cola de una torta: los puntos que quedaron dentro de «Otros». */
  const colaDe = (todos: Punto[], plegado: Punto[]) =>
    todos.filter((p) => !plegado.some((q) => q.id === p.id)).map((p) => p.id)

  const tocarMaterial = (p: Punto) => {
    if (p.id === '__otros') setVista({ nivel: 'otros', de: 'material', ids: colaDe(material, materialPlegado) })
    else setVista({ nivel: 'material', insumoId: p.id })
  }
  const tocarMaquina = (de: 'combustible' | 'ganchos') => (p: Punto) => {
    if (p.id === '__otros') {
      setVista({ nivel: 'otros', de, ids: colaDe(de === 'combustible' ? combustible : ganchos, de === 'combustible' ? combustiblePlegado : ganchosPlegado) })
    } else setVista({ nivel: 'maquina', maquina: p.id })
  }

  const volver = () => setVista({ nivel: 'inicio' })

  const cabecera = (titulo: string, miga: string) => (
    <div className="dash-card__head">
      <h3>{titulo}</h3>
      <div className="dash-miga">
        <button type="button" onClick={volver}>← Insumos</button>
        <span>› {miga}</span>
      </div>
    </div>
  )

  if (cargando) {
    return (
      <div className="dash-card">
        <div className="dash-card__head"><h3>Insumos y materiales</h3></div>
        <p className="dash-vacio">Cargando insumos…</p>
      </div>
    )
  }
  if (movs.length === 0) {
    return (
      <div className="dash-card">
        <div className="dash-card__head"><h3>Insumos y materiales</h3></div>
        <p className="dash-vacio">Sin entregas de insumos en este periodo.</p>
      </div>
    )
  }

  /* ── Nivel 2: un material, por máquina ─────────────────────────────────── */
  if (vista.nivel === 'material') {
    const info = catalogo.get(vista.insumoId)
    const nombre = info?.nombre ?? vista.insumoId
    const unidad = info?.unidad ?? ''
    const datos = materialPorMaquina(movs, vista.insumoId, nombreMaq)
    return (
      <div className="dash-card">
        {cabecera('Insumos y materiales', `${nombre} por máquina`)}
        <p className="subtle-copy" style={{ marginTop: 0 }}>
          {nf(datos.reduce((s, p) => s + p.valor, 0), unidad === 'unidad' ? 0 : 1)} {unidad} en{' '}
          {datos.length} máquina{datos.length === 1 ? '' : 's'}. Toca una para ver sus entregas.
        </p>
        <BarrasH
          datos={datos}
          unidad={unidad}
          color={SERIES[3]}
          onPick={(p) => onVerEntregas(
            `${nombre} · ${p.label}`,
            movs.filter((k) => k.insumoId === vista.insumoId && k.equipoCodigo === p.id),
          )}
        />
      </div>
    )
  }

  /* ── Nivel 2: una máquina, por material ────────────────────────────────── */
  if (vista.nivel === 'maquina') {
    const datos = materialesDeMaquina(movs, vista.maquina, catalogo)
    const fila = galha.porMaquina.find((r) => r.maquina === vista.maquina)
    return (
      <div className="dash-card">
        {cabecera('Insumos y materiales', nombreMaq(vista.maquina))}
        {fila && (
          <p className="subtle-copy" style={{ marginTop: 0 }}>
            {nf(fila.gal, 1)} gal
            {fila.ha > 0 && <> en {nf(fila.ha, 1)} ha</>}
            {fila.ratio != null && <> → <strong>{nf(fila.ratio)} gal/ha</strong></>}
            {fila.laborDominante && <> · sobre todo {fila.laborDominante}</>}
          </p>
        )}
        <p className="ins-res__lbl">Qué recibió (entregas)</p>
        <BarrasH
          datos={datos}
          unidad="entregas"
          color={SERIES[4]}
          onPick={(p) => onVerEntregas(
            `${p.label} · ${nombreMaq(vista.maquina)}`,
            movs.filter((k) => k.insumoId === p.id && k.equipoCodigo === vista.maquina),
          )}
        />
      </div>
    )
  }

  /* ── Nivel 2: una labor, las máquinas que la hicieron ──────────────────── */
  if (vista.nivel === 'labor') {
    const filas = galha.porMaquina.filter((r) => r.labores.includes(vista.labor))
    const lab = galha.porLabor.find((l) => l.labor === vista.labor)
    return (
      <div className="dash-card">
        {cabecera('Insumos y materiales', `${vista.labor} por máquina`)}
        {lab && (
          <p className="subtle-copy" style={{ marginTop: 0 }}>
            <strong>{nf(lab.ratio)} gal/{lab.unidad}</strong> en la labor: {nf(lab.gal, 0)} gal para{' '}
            {nf(lab.area, 1)} {lab.unidad}. El gal/ha de cada máquina es de <em>todo</em> lo que hizo,
            no solo de esta labor.
          </p>
        )}
        {filas.map((r) => (
          <button key={r.maquina} type="button" className="dash-galha__fila"
                  onClick={() => onVerEntregas(
                    `Combustible · ${nombreMaq(r.maquina)}`,
                    movs.filter((k) => k.equipoCodigo === r.maquina && catalogo.get(k.insumoId)?.nombre === 'COMBUSTIBLE'),
                  )}>
            <span>{nombreMaq(r.maquina)}<small> · {r.laborDominante}</small></span>
            <b>{r.ratio != null ? `${nf(r.ratio)} gal/ha` : '—'}</b>
            <small>{nf(r.gal, 0)} gal</small>
          </button>
        ))}
      </div>
    )
  }

  /* ── Nivel 2: la cola de «Otros» desplegada ────────────────────────────── */
  if (vista.nivel === 'otros') {
    const fuente = vista.de === 'material' ? material : vista.de === 'combustible' ? combustible : ganchos
    const datos = fuente.filter((p) => vista.ids.includes(p.id))
    const unidad = vista.de === 'material' ? 'entregas' : vista.de === 'combustible' ? 'gal' : 'unidades'
    return (
      <div className="dash-card">
        {cabecera('Insumos y materiales', `Otros · ${vista.de === 'material' ? 'materiales' : 'máquinas'}`)}
        <BarrasH
          datos={datos}
          unidad={unidad}
          color={SERIES[5]}
          onPick={(p) => setVista(vista.de === 'material'
            ? { nivel: 'material', insumoId: p.id }
            : { nivel: 'maquina', maquina: p.id })}
        />
      </div>
    )
  }

  /* ── Nivel 1 ───────────────────────────────────────────────────────────── */
  const pctCobertura = galha.cobertura.total > 0
    ? Math.round((galha.cobertura.conTanqueo / galha.cobertura.total) * 100) : 0
  const filasMaq = galha.porMaquina.filter((r) => r.ratio != null)

  return (
    <div className="dash-card">
      <div className="dash-card__head">
        <h3>Insumos y materiales</h3>
        <button type="button" className="dash-card__link" onClick={() => onVerEntregas('Todas las entregas', movs)}>
          Ver todo →
        </button>
      </div>

      {!compacta && (
        <div className="dash-maq" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="dash-maq__box"><strong>{movs.length}</strong><span>entregas</span></div>
          <div className="dash-maq__box"><strong>{maquinasAtendidas}</strong><span>máquinas</span></div>
          <div className="dash-maq__box"><strong>{material.length}</strong><span>materiales</span></div>
        </div>
      )}

      {/* ── El número que une las dos mitades del tablero ─────────────────── */}
      {galha.global != null && (
        <>
          <div className="dash-galha">
            <span className="dash-galha__num">{nf(galha.global)}</span>
            <span className="dash-galha__uni">galones por hectárea</span>
            <span className="dash-galha__sub">
              {nf(galha.galones, 0)} gal de combustible para {nf(galha.hectareas, 1)} ha cerradas
              {unSoloDia && ` · cobertura ${pctCobertura}%`}
            </span>
          </div>
          {/* Una línea, no un párrafo. El detalle que se recorta no se pierde:
              la cobertura viaja en el subtítulo del número y los días con varias
              labores salen al entrar a la labor. Tres renglones de advertencia
              encima de un dato es lo que hace que nadie lea ninguno. */}
          <p className="dash-galha__nota">
            {unSoloDia
              ? `En un solo día es orientativo: un tanqueo alimenta varios (cobertura ${pctCobertura}%).`
              : 'Compárese por labor, no por máquina: TRIPLE gasta tres a cuatro veces más que DESPEJE.'}
          </p>
        </>
      )}

      {/* ── Qué salió ─────────────────────────────────────────────────────── */}
      <p className="ins-res__lbl" style={{ marginTop: 14 }}>Qué salió y a qué máquina</p>
      <div className="dash-tres">
        <div>
          <h4>Entregas por material</h4>
          <Donut datos={materialPlegado} total={movs.length} unidad="entregas" decimales={0} onPick={tocarMaterial} />
        </div>
        <div>
          <h4>Combustible por máquina</h4>
          <Donut datos={combustiblePlegado} total={totalGal} unidad="gal" decimales={1} onPick={tocarMaquina('combustible')} />
        </div>
        <div>
          <h4>Ganchos por máquina</h4>
          <Donut datos={ganchosPlegado} total={totalGanchos} unidad="ganchos" decimales={0} onPick={tocarMaquina('ganchos')} />
        </div>
      </div>

      {/* ── Galones por hectárea ───────────────────────────────────────────
          Estaba DOS veces en la vista inicial: aquí por labor y más arriba una
          lista de ocho máquinas. Es el mismo indicador partido en dos sitios, y
          por eso la pantalla se sentía saturada. Ahora es UNA sección: la labor
          de primeras, que es donde está el hallazgo —la máquina que hace TRIPLE
          siempre va a parecer peor—, y las máquinas plegadas detrás de un
          botón, para el que quiera bajar a ese nivel. */}
      {galha.porLabor.length > 0 && (
        <>
          <p className="ins-res__lbl" style={{ marginTop: 18 }}>Galones por hectárea, por labor</p>
          <BarrasH
            datos={galha.porLabor.map((l) => ({
              id: l.labor, label: l.labor, valor: l.ratio,
              // ACEQUIAS va en hectómetros: su unidad viaja en el punto.
              sufijo: l.unidad === 'ha' ? undefined : `gal/${l.unidad}`,
            }))}
            unidad="gal/ha"
            color={SERIES[0]}
            onPick={(p) => setVista({ nivel: 'labor', labor: p.id })}
          />
        </>
      )}

      {filasMaq.length > 0 && (
        <>
          <button type="button" className="dash-card__link" style={{ marginTop: 10 }}
                  onClick={() => setVerMaq((v) => !v)}>
            {verMaq ? 'Ocultar el detalle por máquina' : `Ver las ${filasMaq.length} máquinas, una por una →`}
          </button>
          {verMaq && filasMaq.map((r) => (
            <button key={r.maquina} type="button" className="dash-galha__fila"
                    onClick={() => setVista({ nivel: 'maquina', maquina: r.maquina })}>
              <span>{nombreMaq(r.maquina)}<small> · {r.laborDominante || 'sin labor'}</small></span>
              <b>{nf(r.ratio!)} gal/ha</b>
              <small>{nf(r.gal, 0)} gal · {nf(r.ha, 0)} ha</small>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

export default InsumosCard
