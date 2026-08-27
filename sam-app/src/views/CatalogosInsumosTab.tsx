import { useCallback, useEffect, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import {
  loadCatalogo, crearValorCatalogo, actualizarValorCatalogo,
  eliminarValorCatalogo, cargarListaCatalogo,
} from '../services/samApi'
import type { ValorCatalogo } from '../domain/sam'
import { aMayus, normalizarPlaca } from '../lib/texto'
import { Ayuda } from '../components/Ayuda'

/**
 * Las listas que alimentan los formularios de insumos.
 *
 * Antes cada campo se escribía libre y el mismo dato entraba de cinco formas
 * ("texaco san pedro", "TEXACO SANPEDRO", "texaco"). Cargar la lista una vez
 * aquí hace que en el celular sea un toque y que el reporte cuadre.
 *
 * Sigue siendo un campo escribible: la lista sugiere, no obliga. Si aparece
 * una bomba nueva a las seis de la mañana, se escribe y ya; después se agrega
 * a la lista con calma.
 */

type Lista = {
  tipo: string
  icono: string
  titulo: string
  /** Dónde se ve, en palabras del que usa la app. */
  donde: string
  ejemplo: string
  /** Las placas no llevan espacios ni guiones; lo demás sí. */
  normalizar: (v: string) => string
}

const LISTAS: Lista[] = [
  {
    tipo: 'ESTACION', icono: '⛽', titulo: 'Estaciones de servicio',
    donde: 'Registrar tanqueo → Estación',
    ejemplo: 'TEXACO SAN PEDRO', normalizar: aMayus,
  },
  {
    tipo: 'PLACA', icono: '🚗', titulo: 'Placas de vehículos',
    donde: 'Registrar tanqueo → Vehículo · Flota / Escolta',
    ejemplo: 'ABC123', normalizar: normalizarPlaca,
  },
  {
    tipo: 'USO', icono: '🎯', titulo: 'Para qué / dónde',
    donde: 'Entrega directa → Nota',
    ejemplo: 'CAMBIO DE PUNTERAS', normalizar: aMayus,
  },
  {
    tipo: 'MOTIVO_RECHAZO', icono: '🚫', titulo: 'Motivos de rechazo',
    donde: 'Bandeja → Rechazar solicitud',
    ejemplo: 'SIN STOCK', normalizar: aMayus,
  },
  // Transporte de madera. Van aqui y no en una pantalla propia porque esta ya
  // resuelve el problema entero — alta, edicion, pegado masivo y el espejo que
  // sigue sugiriendo sin senal. Una pantalla nueva seria la misma tres veces.
  {
    tipo: 'PREDIO', icono: '🌳', titulo: 'Predios de donde sale la madera',
    donde: 'Viajes de trozas → Salida del camión → ¿De dónde sale?',
    ejemplo: 'LA ESPERANZA', normalizar: aMayus,
  },
  {
    tipo: 'DESTINO_MADERA', icono: '🏭', titulo: 'Destinos de la madera',
    donde: 'Viajes de trozas → Salida del camión → ¿Para dónde va?',
    ejemplo: 'PLANTA YUMBO', normalizar: aMayus,
  },
]

export function CatalogosInsumosTab() {
  const { busy, setBusy, setError, setInfo } = useAppData()
  const [lista, setLista] = useState<Lista>(LISTAS[0])
  const [valores, setValores] = useState<ValorCatalogo[]>([])
  const [cargando, setCargando] = useState(true)

  const [nuevo, setNuevo] = useState('')
  const [pegar, setPegar] = useState('')
  const [pegando, setPegando] = useState(false)
  const [editando, setEditando] = useState<ValorCatalogo | null>(null)
  const [editValor, setEditValor] = useState('')
  const [borrando, setBorrando] = useState<ValorCatalogo | null>(null)

  const refrescar = useCallback(async (tipo: string) => {
    setCargando(true)
    // Se piden TODOS, activos y no: aquí hay que ver los desactivados para
    // poder volver a activarlos.
    setValores(await loadCatalogo(tipo, false))
    setCargando(false)
  }, [])

  useEffect(() => { void refrescar(lista.tipo) }, [lista.tipo, refrescar])

  async function agregar() {
    const v = lista.normalizar(nuevo)
    if (!v) { setError('Escribe el valor.'); return }
    setBusy(true); setError('')
    try {
      await crearValorCatalogo({ tipo: lista.tipo, valor: v, frecuente: true })
      setNuevo('')
      setInfo(`${v} agregado.`)
      await refrescar(lista.tipo)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'No se pudo guardar')
    } finally { setBusy(false) }
  }

  async function pegarLista() {
    if (!pegar.trim()) { setError('Pega la lista, una por línea.'); return }
    setBusy(true); setError('')
    try {
      const texto = pegar.split(/\r?\n/).map((l) => lista.normalizar(l)).join('\n')
      const r = await cargarListaCatalogo(lista.tipo, texto)
      setPegar(''); setPegando(false)
      setInfo(r.nuevos > 0
        ? `${r.nuevos} agregado(s).${r.repetidos ? ` ${r.repetidos} ya estaban.` : ''}`
        : 'Todos ya estaban en la lista.')
      await refrescar(lista.tipo)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'No se pudo cargar')
    } finally { setBusy(false) }
  }

  async function guardarEdicion() {
    if (!editando) return
    const v = lista.normalizar(editValor)
    if (!v) { setError('El valor no puede quedar vacío.'); return }
    setBusy(true); setError('')
    try {
      await actualizarValorCatalogo(editando.id, { valor: v })
      setEditando(null)
      await refrescar(lista.tipo)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'No se pudo guardar')
    } finally { setBusy(false) }
  }

  async function alternarActivo(v: ValorCatalogo) {
    setBusy(true); setError('')
    try {
      await actualizarValorCatalogo(v.id, { activo: !v.activo })
      await refrescar(lista.tipo)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'No se pudo guardar')
    } finally { setBusy(false) }
  }

  async function borrar() {
    if (!borrando) return
    setBusy(true); setError('')
    try {
      await eliminarValorCatalogo(borrando.id)
      setBorrando(null)
      await refrescar(lista.tipo)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'No se pudo eliminar')
    } finally { setBusy(false) }
  }

  const activos = valores.filter((v) => v.activo)

  return (
    <section className="panel">
      <div className="panel-title split">
        <h2>📚 Catálogos</h2>
      </div>
      <Ayuda>
        <p>
          Las listas que salen como sugerencia en los formularios de insumos. Cargarlas una
          vez aquí hace que en el celular sea un toque — y que el mismo dato no entre escrito
          de cinco formas distintas.
        </p>
      </Ayuda>

      {/* Qué lista se está editando */}
      <div className="sol-filtros" style={{ marginTop: 10 }}>
        {LISTAS.map((l) => (
          <button
            key={l.tipo}
            type="button"
            className={`sol-filtro${lista.tipo === l.tipo ? ' is-active' : ''}`}
            onClick={() => { setLista(l); setNuevo(''); setPegar(''); setPegando(false) }}
          >
            {l.icono} {l.titulo}
          </button>
        ))}
      </div>

      <p className="ins-res__lbl" style={{ marginTop: 12 }}>
        Se ve en: {lista.donde}
      </p>

      {/* Agregar uno */}
      <div className="cat-agregar">
        <input
          type="text"
          autoCapitalize="characters"
          value={nuevo}
          onChange={(e) => setNuevo(lista.normalizar(e.target.value))}
          placeholder={`ej. ${lista.ejemplo}`}
          disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Enter') void agregar() }}
        />
        <button type="button" className="primary-button" onClick={() => void agregar()} disabled={busy}>
          + Agregar
        </button>
      </div>

      {/* Pegar una lista entera: cargar treinta de a una no lo hace nadie. */}
      {pegando ? (
        <div className="cat-pegar">
          <label>
            Pega la lista, una por línea
            <textarea
              rows={5}
              autoCapitalize="characters"
              value={pegar}
              onChange={(e) => setPegar(e.target.value)}
              placeholder={`${lista.ejemplo}\nOTRO VALOR\nOTRO MÁS`}
              disabled={busy}
              autoFocus
            />
          </label>
          <div className="modal-footer" style={{ marginTop: 6 }}>
            <button type="button" className="inline-button" onClick={() => { setPegando(false); setPegar('') }} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="primary-button" onClick={() => void pegarLista()} disabled={busy}>
              Cargar lista
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="inline-button" style={{ marginTop: 6 }} onClick={() => setPegando(true)} disabled={busy}>
          📋 Pegar una lista completa
        </button>
      )}

      {cargando ? (
        <p className="muted-text">Cargando…</p>
      ) : valores.length === 0 ? (
        <p className="muted-text">
          Esta lista está vacía. Agrega el primer valor arriba y aparecerá como sugerencia
          en {lista.donde}.
        </p>
      ) : (
        <>
          <p className="ins-res__lbl" style={{ marginTop: 14 }}>
            {activos.length} en uso{valores.length > activos.length ? ` · ${valores.length - activos.length} desactivado(s)` : ''}
          </p>
          <div className="inv-list">
            {valores.map((v) => (
              <div key={v.id} className={`cat-row${v.activo ? '' : ' cat-row--off'}`}>
                <span className="cat-row__val">
                  {v.valor}
                  {!v.activo && <span className="inv-cat inv-cat--off"> desactivado</span>}
                </span>
                <div className="cat-row__acciones">
                  <button type="button" className="inline-button" disabled={busy}
                    onClick={() => { setEditando(v); setEditValor(v.valor) }}>
                    ✏️
                  </button>
                  <button type="button" className="inline-button" disabled={busy}
                    onClick={() => void alternarActivo(v)}
                    title={v.activo ? 'Dejar de ofrecerlo' : 'Volver a ofrecerlo'}>
                    {v.activo ? '🚫' : '↩'}
                  </button>
                  <button type="button" className="inline-button" disabled={busy}
                    onClick={() => setBorrando(v)}>
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {editando && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setEditando(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(400px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">{lista.titulo}</p><h3>Editar</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEditando(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>
              Valor
              <input type="text" autoCapitalize="characters" value={editValor} disabled={busy} autoFocus
                onChange={(e) => setEditValor(lista.normalizar(e.target.value))} />
            </label>
            <p className="subtle-copy">
              Los registros viejos guardaron el texto de entonces: cambiarlo aquí no los reescribe.
            </p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEditando(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void guardarEdicion()} disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {borrando && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setBorrando(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(400px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">{lista.titulo}</p><h3>¿Eliminar {borrando.valor}?</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setBorrando(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Sale de la lista para siempre. Si solo quieres dejar de ofrecerlo pero conservarlo,
              usa 🚫 desactivar. Los registros que ya lo usaron no cambian.
            </p>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setBorrando(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="release-confirm-btn" onClick={() => void borrar()} disabled={busy}>
                {busy ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default CatalogosInsumosTab
