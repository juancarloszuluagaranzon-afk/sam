import { useMemo, useState } from 'react'
import { useCapaAtras } from '../lib/atras'
import { etiquetaDeduccion, type ConceptoDeduccion, type ReglaDeduccion } from '../lib/deduccionesCartera'
import { aMayus } from '../lib/texto'
import {
  TIPOS_CLIENTE, guardarClienteFact, guardarReglasCliente,
  type ClienteFact, type TipoClienteFact,
} from '../services/carteraApi'
import './carteraContable.css'

/**
 * CLIENTES DE FACTURACIÓN (Ola 2, 27-oct-2026) — el catálogo que separa «a quién se
 * le facturó» de «quién paga» (el Ingenio Risaralda paga facturas de sus proveedores)
 * y donde se definen las deducciones predeterminadas de cada cliente (retefuente,
 * reteICA, ICA…). Los porcentajes NO vienen sembrados: los dicta cartera.
 *
 * Se ven tarjetas y no una tabla para que quepan en un celular de 320 px.
 */

const tituloTipo = (tipo: string) => TIPOS_CLIENTE.find((t) => t.id === tipo)?.titulo ?? tipo

// ── Lista ───────────────────────────────────────────────────────────────────
export function ListaClientesFact({ clientes, conceptos, reglasPorCliente, usuario, onCambio, onError }: {
  clientes: ClienteFact[]
  conceptos: ConceptoDeduccion[]
  reglasPorCliente: Record<string, ReglaDeduccion[]>
  usuario: string
  onCambio: (msg: string) => Promise<void>
  onError: (m: string) => void
}) {
  const [buscar, setBuscar] = useState('')
  const [tipo, setTipo] = useState<TipoClienteFact | 'TODOS'>('TODOS')
  const [verInactivos, setVerInactivos] = useState(false)
  const [editando, setEditando] = useState<ClienteFact | 'NUEVO' | null>(null)
  useCapaAtras(!!editando, () => setEditando(null))

  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return clientes
      .filter((c) => verInactivos || c.activo)
      .filter((c) => tipo === 'TODOS' || c.tipo === tipo)
      .filter((c) => !q || `${c.nombre} ${c.nit ?? ''}`.toLowerCase().includes(q))
  }, [clientes, buscar, tipo, verInactivos])

  return (
    <>
      <div className="cc-cli-barra">
        <input className="user-search-input" type="search" placeholder="Buscar cliente o NIT…" value={buscar}
          onChange={(e) => setBuscar(e.target.value)} />
        <select className="base-input" value={tipo} aria-label="Tipo de cliente"
          onChange={(e) => setTipo(e.target.value as TipoClienteFact | 'TODOS')}>
          <option value="TODOS">Todos los tipos</option>
          {TIPOS_CLIENTE.map((t) => <option key={t.id} value={t.id}>{t.titulo}</option>)}
        </select>
        <label className="cc-cli-check">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos
        </label>
        <button type="button" className="primary-button" onClick={() => setEditando('NUEVO')}>＋ Cliente nuevo</button>
      </div>

      {lista.length === 0 ? (
        <p className="cc-vacio">
          {clientes.length === 0
            ? 'Todavía no hay clientes de facturación: créalos con «＋ Cliente nuevo».'
            : 'Ningún cliente coincide con la búsqueda.'}
        </p>
      ) : (
        <ul className="cc-cli-lista">
          {lista.map((c) => {
            const reglas = reglasPorCliente[c.id] ?? []
            return (
              <li key={c.id}>
                <button type="button" className={`cc-cli-card${c.activo ? '' : ' cc-cli-card--inactivo'}`}
                  onClick={() => setEditando(c)}>
                  <span className="cc-cli-card__cab">
                    <span className="cc-cli-card__nombre">{c.nombre}</span>
                    <span className="cart-chip cart--neutro">{tituloTipo(c.tipo)}</span>
                    {!c.activo && <span className="cart-chip cart--neutro">Inactivo</span>}
                  </span>
                  {c.nit && <span className="cc-cli-card__meta">NIT {c.nit}</span>}
                  {reglas.length > 0 ? (
                    <span className="cc-cli-card__reglas">
                      {reglas.map((r, i) => (
                        <span key={`${r.concepto}-${i}`} className="cc-regla-chip">{etiquetaDeduccion(r, conceptos)}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="cc-cli-card__meta">Sin deducciones predeterminadas</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {editando && (
        <EditorCliente
          key={editando === 'NUEVO' ? 'nuevo' : editando.id}
          cliente={editando === 'NUEVO' ? null : editando}
          conceptos={conceptos}
          reglasIniciales={editando === 'NUEVO' ? [] : reglasPorCliente[editando.id] ?? []}
          usuario={usuario}
          onGuardado={async () => { setEditando(null); await onCambio('Cliente guardado.') }}
          onCerrar={() => setEditando(null)}
          onError={onError}
        />
      )}
    </>
  )
}

// ── Editor: nuevo cliente o cambio de uno existente ─────────────────────────
function EditorCliente({ cliente, conceptos, reglasIniciales, usuario, onGuardado, onCerrar, onError }: {
  cliente: ClienteFact | null
  conceptos: ConceptoDeduccion[]
  reglasIniciales: ReglaDeduccion[]
  usuario: string
  onGuardado: () => Promise<void>
  onCerrar: () => void
  onError: (m: string) => void
}) {
  const [nombre, setNombre] = useState(cliente?.nombre ?? '')
  const [tipo, setTipo] = useState<TipoClienteFact>(cliente?.tipo ?? 'OTRO')
  const [nit, setNit] = useState(cliente?.nit ?? '')
  const [activo, setActivo] = useState(cliente?.activo ?? true)
  // El porcentaje se guarda como texto para poder escribir «4,5» sin pelear con el campo.
  const [reglas, setReglas] = useState<{ concepto: string; porcentaje: string }[]>(
    reglasIniciales.map((r) => ({ concepto: r.concepto, porcentaje: String(r.porcentaje).replace('.', ',') })),
  )
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const porPorcentaje = conceptos.filter((c) => c.modo === 'PORCENTAJE')

  function agregar() {
    const libre = porPorcentaje.find((c) => !reglas.some((r) => r.concepto === c.codigo))
    if (!libre) return
    setReglas([...reglas, { concepto: libre.codigo, porcentaje: '' }])
  }

  async function guardar() {
    setError('')
    const limpio = nombre.trim()
    if (!limpio) { setError('Escribe el nombre del cliente.'); return }

    // Se ignoran las filas vacías o con un porcentaje fuera de rango.
    const validas: ReglaDeduccion[] = []
    for (const r of reglas) {
      if (!r.concepto) continue
      const p = Number(r.porcentaje.replace(',', '.'))
      if (!Number.isFinite(p) || p <= 0 || p > 100) continue
      validas.push({ concepto: r.concepto, porcentaje: p })
    }

    setOcupado(true)
    try {
      const id = await guardarClienteFact(
        { id: cliente?.id ?? null, nombre: limpio, tipo, nit: nit.trim(), activo }, usuario,
      )
      await guardarReglasCliente(id, validas, usuario)
      await onGuardado()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!ocupado) onCerrar() }}>
      <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Cliente de facturación</p>
            <h3>{cliente ? cliente.nombre : 'Nuevo cliente'}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar">&#x2715;</button>
        </div>

        <div className="cc-editor">
          <div className="cc-editor__campos">
            <label className="cc-campo cc-editor__ancho">
              <span>Nombre</span>
              <input value={nombre} autoCapitalize="characters" placeholder="NOMBRE O RAZÓN SOCIAL" disabled={ocupado}
                onChange={(e) => setNombre(aMayus(e.target.value))} />
            </label>
            <label className="cc-campo">
              <span>Tipo</span>
              <select value={tipo} disabled={ocupado} onChange={(e) => setTipo(e.target.value as TipoClienteFact)}>
                {TIPOS_CLIENTE.map((t) => <option key={t.id} value={t.id}>{t.titulo}</option>)}
              </select>
            </label>
            <label className="cc-campo">
              <span>NIT (opcional)</span>
              <input value={nit} inputMode="numeric" disabled={ocupado} onChange={(e) => setNit(e.target.value)} />
            </label>
            <label className="cc-cli-check cc-editor__ancho">
              <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} disabled={ocupado} /> Activo
            </label>
          </div>

          <div>
            <p className="cc-titulo">Deducciones predeterminadas</p>
            {porPorcentaje.length === 0 ? (
              <p className="cc-vacio">El catálogo de conceptos todavía no tiene deducciones por porcentaje.</p>
            ) : reglas.length === 0 ? (
              <p className="cc-vacio">Sin deducciones predeterminadas.</p>
            ) : (
              <div className="cc-reglas">
                {reglas.map((r, i) => {
                  const disponibles = porPorcentaje.filter((c) => c.codigo === r.concepto || !reglas.some((x) => x.concepto === c.codigo))
                  return (
                    <div className="cc-regla" key={i}>
                      <select value={r.concepto} aria-label="Concepto de la deducción" disabled={ocupado}
                        onChange={(e) => setReglas(reglas.map((x, j) => j === i ? { ...x, concepto: e.target.value } : x))}>
                        {disponibles.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                      </select>
                      <input className="cc-num cc-num--pct" inputMode="decimal" placeholder="%" value={r.porcentaje}
                        aria-label="Porcentaje" disabled={ocupado}
                        onChange={(e) => setReglas(reglas.map((x, j) => j === i ? { ...x, porcentaje: e.target.value } : x))} />
                      <button type="button" className="cc-boton-quitar" aria-label="Quitar esta deducción" title="Quitar"
                        disabled={ocupado} onClick={() => setReglas(reglas.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  )
                })}
              </div>
            )}
            <button type="button" className="inline-button" style={{ width: 'auto', marginTop: 8 }} disabled={ocupado || reglas.length >= porPorcentaje.length}
              onClick={agregar}>
              ＋ Agregar deducción
            </button>
            <p className="field-hint">Se proponen al registrar el pago de una factura de este cliente; siempre se pueden cambiar a mano.</p>
          </div>

          {error && <p className="cc-error">{error}</p>}

          <div className="cc-editor__pie">
            <button type="button" className="inline-button" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
            <button type="button" className="primary-button" onClick={() => void guardar()} disabled={ocupado}>
              {ocupado ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ListaClientesFact
