import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { DictateInlineButton } from '../components/DictateInlineButton'
import {
  chequeoDelDia, guardarChequeo, loadChequeoItems, ordenarDelDia, ultimoHorometro,
} from '../services/chequeoApi'
import type {
  Chequeo, ChequeoItem, ChequeoRespuesta, ChequeoSeveridad,
} from '../domain/sam'
import { diaKey } from '../lib/fechas'

/**
 * Chequeo diario de la máquina, para el operario.
 *
 * **Un ítem por pantalla, no una lista de 30 filas.** Es la decisión de diseño
 * que sostiene todo lo demás: con una lista, el pulgar barre la columna "Bien"
 * en cuatro segundos y el dato nace muerto. Con una tarjeta por ítem hay que
 * tomar treinta decisiones conscientes, los botones caben bajo el pulgar con
 * guantes, y no hay que rodar la pantalla con una mano mientras se sostiene un
 * trapo con la otra.
 *
 * **Tres vueltas que siguen el recorrido físico**, no el orden del Excel: capó
 * arriba, alrededor del tractor, y encendido. Agrupar por dónde está parado el
 * operario corta el tiempo a la mitad y hace imposible contestar sin moverse.
 *
 * **El orden rota cada día** (ver `ordenarDelDia`). Es lo más barato contra el
 * "todo bien" sin mirar y lo único que no castiga al que sí revisa.
 *
 * Lo que NO hace, a propósito: no pide foto en cada ítem (serían 30), no exige
 * GPS (falla bajo la caña y bloquearía), y no bloquea la máquina. Un semáforo
 * automático a las 5:30 de la mañana en un lote produce que al día siguiente
 * contesten "bien" a todo.
 */

const VUELTAS: Record<number, { titulo: string; pista: string }> = {
  1: { titulo: 'Con el capó arriba', pista: 'Motor apagado. Revisa niveles y lo que se ve dentro.' },
  2: { titulo: 'Dando la vuelta', pista: 'Camina alrededor de la máquina.' },
  3: { titulo: 'Enciende y prueba', pista: 'Ya sentado, con la máquina andando.' },
}

const SEVERIDADES: { v: ChequeoSeveridad; label: string; pista: string }[] = [
  { v: 'TRABAJA', label: 'Se puede trabajar', pista: 'Anótalo, pero la máquina sale' },
  { v: 'HOY', label: 'Hay que arreglarlo hoy', pista: 'Necesita al mecánico' },
  { v: 'NO_ARRANCA', label: 'No arranca', pista: 'La máquina no sale' },
]

/** Bajo este tiempo nadie miró la máquina de verdad. No bloquea: se marca. */
const SEGUNDOS_SOSPECHOSO = 90

export function ChequeoDiarioView({
  equipoCodigo,
  listaId,
  onSalir,
}: {
  equipoCodigo: string
  listaId: number
  onSalir: () => void
}) {
  const { session, sortedEquipment, setError, setInfo } = useAppData()
  const fecha = diaKey(new Date().toISOString())

  const [items, setItems] = useState<ChequeoItem[]>([])
  const [cargando, setCargando] = useState(true)
  const [yaHecho, setYaHecho] = useState<Chequeo | null>(null)
  const [idx, setIdx] = useState(0)
  const [respuestas, setRespuestas] = useState<Record<number, ChequeoRespuesta>>({})
  const [novedadAbierta, setNovedadAbierta] = useState(false)
  const [notaTmp, setNotaTmp] = useState('')
  const [medidaTmp, setMedidaTmp] = useState('')
  const [horometro, setHorometro] = useState('')
  const [ultimoH, setUltimoH] = useState<number | null>(null)
  const [enHorometro, setEnHorometro] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const inicioRef = useRef<string>(new Date().toISOString())

  const equipoNombre = useMemo(
    () => sortedEquipment.find((e) => e.code === equipoCodigo)?.name ?? equipoCodigo,
    [sortedEquipment, equipoCodigo],
  )

  useEffect(() => {
    let vivo = true
    void (async () => {
      const [its, hecho, uh] = await Promise.all([
        loadChequeoItems(listaId),
        chequeoDelDia(equipoCodigo, fecha),
        ultimoHorometro(equipoCodigo),
      ])
      if (!vivo) return
      setItems(ordenarDelDia(its, equipoCodigo, fecha))
      setYaHecho(hecho)
      setUltimoH(uh)
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [listaId, equipoCodigo, fecha])

  const item = items[idx]
  const contestadas = Object.values(respuestas).filter((r) => r.valor != null).length
  const enVuelta = item ? items.filter((i) => i.vuelta === item.vuelta) : []
  const posEnVuelta = item ? enVuelta.findIndex((i) => i.id === item.id) + 1 : 0

  const responder = useCallback((valor: ChequeoRespuesta['valor'], extra?: Partial<ChequeoRespuesta>) => {
    if (!item) return
    setRespuestas((prev) => ({
      ...prev,
      [item.id]: {
        itemId: item.id,
        itemTexto: item.texto,
        valor,
        respondidoEn: new Date().toISOString(),
        ...extra,
      },
    }))
    setNovedadAbierta(false)
    setNotaTmp('')
    setMedidaTmp('')
    // Avance automático: un toque = una respuesta = siguiente.
    if (idx + 1 < items.length) setIdx(idx + 1)
    else setEnHorometro(true)
  }, [item, idx, items.length])

  /**
   * Valida contra la última lectura buena, en el momento.
   *
   * Aquí está la causa raíz de los horómetros sucios: la mayoría de las lecturas
   * malas son las HORAS DEL DÍA escritas en esta casilla. Avisar después no
   * sirve — el que lo escribió ya se fue.
   */
  const avisoHorometro = useMemo(() => {
    const h = Number(horometro)
    if (!horometro || !Number.isFinite(h) || ultimoH == null) return ''
    if (h < ultimoH) {
      return `La última lectura fue ${ultimoH.toLocaleString('es-CO')}. El horómetro no baja — ¿anotaste las horas que trabajaste?`
    }
    if (h > ultimoH * 1.5 && h - ultimoH > 100) {
      return `La última lectura fue ${ultimoH.toLocaleString('es-CO')}. ${h.toLocaleString('es-CO')} es mucho salto — revisa si sobra un dígito.`
    }
    return ''
  }, [horometro, ultimoH])

  async function finalizar() {
    if (!session) return
    setGuardando(true)
    setError('')
    try {
      const fin = new Date().toISOString()
      const dur = Math.round((new Date(fin).getTime() - new Date(inicioRef.current).getTime()) / 1000)
      const todas = Object.values(respuestas)
      const grave = todas.some((r) => r.severidad === 'NO_ARRANCA')
      const conNovedad = todas.some((r) => r.valor === 'MAL')

      const chequeo: Chequeo = {
        // uuid del cliente: reintentar desde la cola no debe duplicar.
        id: crypto.randomUUID(),
        equipoCodigo,
        listaId,
        operarioId: session.id,
        operarioNombre: session.name,
        fecha,
        horometro: horometro ? Number(horometro) : undefined,
        iniciadoEn: inicioRef.current,
        finalizadoEn: fin,
        duracionSeg: dur,
        sospechoso: dur < SEGUNDOS_SOSPECHOSO,
        resultado: grave ? 'NO_APTO' : conNovedad ? 'CON_NOVEDAD' : 'OK',
        respuestas: todas,
      }
      await guardarChequeo(chequeo)
      setInfo(conNovedad
        ? 'Chequeo guardado. Las novedades quedaron reportadas al taller.'
        : 'Chequeo guardado. Buen viaje.')
      onSalir()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el chequeo')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <section className="panel"><p className="muted-text">Cargando el chequeo…</p></section>

  if (yaHecho) {
    return (
      <section className="panel">
        <div className="panel-title split">
          <h2>✅ Chequeo de hoy</h2>
          <button type="button" className="inline-button" onClick={onSalir}>Volver</button>
        </div>
        <p className="subtle-copy">
          La <strong>{equipoNombre}</strong> ya tiene el chequeo de hoy, hecho por{' '}
          {yaHecho.operarioNombre ?? 'otro operario'}.
          {yaHecho.resultado === 'CON_NOVEDAD' && ' Quedaron novedades reportadas.'}
        </p>
      </section>
    )
  }

  if (!items.length) {
    return (
      <section className="panel">
        <div className="panel-title split">
          <h2>Chequeo diario</h2>
          <button type="button" className="inline-button" onClick={onSalir}>Volver</button>
        </div>
        <p className="muted-text">Esta máquina no tiene lista de chequeo configurada.</p>
      </section>
    )
  }

  // ── Pantalla final: el horómetro ──────────────────────────────────────────
  if (enHorometro) {
    const malas = Object.values(respuestas).filter((r) => r.valor === 'MAL')
    return (
      <section className="chq">
        <div className="chq__top">
          <span className="chq__maq">🚜 {equipoNombre}</span>
          <span className="chq__paso">Último paso</span>
        </div>

        <div className="chq__card">
          <p className="chq__vuelta">Para terminar</p>
          <h2 className="chq__texto">¿Qué marca el horómetro?</h2>
          <p className="chq__pista">
            El número de la máquina — <strong>no las horas que trabajaste</strong>.
          </p>

          <input
            className="chq__horometro"
            type="number" inputMode="decimal" step="0.1" autoFocus
            value={horometro} onChange={(e) => setHorometro(e.target.value)}
            placeholder={ultimoH ? ultimoH.toLocaleString('es-CO') : '0'}
          />
          {ultimoH != null && (
            <p className="chq__pista">La última lectura fue <strong>{ultimoH.toLocaleString('es-CO')}</strong>.</p>
          )}
          {avisoHorometro && <p className="chq__aviso">⚠ {avisoHorometro}</p>}

          {malas.length > 0 && (
            <div className="chq__resumen">
              <strong>{malas.length} novedad(es) para reportar:</strong>
              {malas.map((r) => <span key={r.itemId}>· {r.itemTexto}</span>)}
            </div>
          )}
        </div>

        <div className="chq__botones">
          <button type="button" className="chq__btn chq__btn--gris"
                  onClick={() => { setEnHorometro(false); setIdx(items.length - 1) }}>
            ← Atrás
          </button>
          <button type="button" className="chq__btn chq__btn--ok"
                  onClick={() => void finalizar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Terminar chequeo'}
          </button>
        </div>
      </section>
    )
  }

  // ── Un ítem, a pantalla completa ──────────────────────────────────────────
  const info = VUELTAS[item.vuelta] ?? VUELTAS[1]
  const yaResp = respuestas[item.id]

  return (
    <section className="chq">
      <div className="chq__top">
        <span className="chq__maq">🚜 {equipoNombre}</span>
        <span className="chq__paso">{contestadas} de {items.length}</span>
      </div>

      {/* Tres metas cortas, no una barra larga de 30. */}
      <div className="chq__vueltas">
        {[1, 2, 3].map((v) => (
          <span key={v} className={`chq__vpill${item.vuelta === v ? ' is-aqui' : ''}${item.vuelta > v ? ' is-listo' : ''}`}>
            {VUELTAS[v].titulo}
          </span>
        ))}
      </div>

      <div className="chq__card">
        <p className="chq__vuelta">
          {info.titulo} · {posEnVuelta} de {enVuelta.length}
          {item.critico && <span className="chq__critico">importante</span>}
        </p>
        <h2 className="chq__texto">{item.texto}</h2>
        <p className="chq__pista">{info.pista}</p>

        {novedadAbierta && (
          <div className="chq__novedad">
            <p className="chq__nlbl">¿Qué tan grave es?</p>
            {SEVERIDADES.map((s) => (
              <button key={s.v} type="button" className="chq__sev"
                      onClick={() => responder('MAL', { severidad: s.v, nota: notaTmp.trim() || undefined })}>
                <strong>{s.label}</strong><small>{s.pista}</small>
              </button>
            ))}
            <div className="chq__nota">
              <input type="text" value={notaTmp} placeholder="¿Qué le viste? (opcional)"
                     onChange={(e) => setNotaTmp(e.target.value)} />
              <DictateInlineButton onComplete={(t) => setNotaTmp((p) => (p ? `${p} ${t}` : t))}
                                   ariaLabel="Dictar la novedad" />
            </div>
            <button type="button" className="chq__cancelar" onClick={() => setNovedadAbierta(false)}>
              Cancelar
            </button>
          </div>
        )}

        {item.tipo === 'DATO' && !novedadAbierta && (
          <input className="chq__horometro" type="number" inputMode="decimal"
                 value={medidaTmp} onChange={(e) => setMedidaTmp(e.target.value)}
                 placeholder={item.unidad ?? 'Valor'} />
        )}
      </div>

      {!novedadAbierta && (
        <div className="chq__botones">
          {item.tipo === 'ACCION' ? (
            <>
              <button type="button" className="chq__btn chq__btn--gris" onClick={() => responder('NA')}>
                No pude
              </button>
              <button type="button" className="chq__btn chq__btn--ok" onClick={() => responder('HECHO')}>
                ✅ Hecho
              </button>
            </>
          ) : (
            <>
              <button type="button" className="chq__btn chq__btn--mal" onClick={() => setNovedadAbierta(true)}>
                ⚠️ Mal
              </button>
              <button type="button" className="chq__btn chq__btn--ok"
                      onClick={() => responder('BIEN', medidaTmp ? { medida: Number(medidaTmp) } : undefined)}>
                ✅ Bien
              </button>
            </>
          )}
        </div>
      )}

      <div className="chq__pie">
        <button type="button" className="chq__link" onClick={() => idx > 0 && setIdx(idx - 1)} disabled={idx === 0}>
          ← Anterior
        </button>
        {yaResp && <span className="chq__ya">Respondiste: {yaResp.valor}</span>}
        <button type="button" className="chq__link" onClick={() => responder('NA')}>
          No aplica →
        </button>
      </div>

      <button type="button" className="chq__salir" onClick={onSalir}>Salir sin terminar</button>
    </section>
  )
}

export default ChequeoDiarioView
