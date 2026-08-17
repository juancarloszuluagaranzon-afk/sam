import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { SearchableSelect } from '../components/SearchableSelect'
import {
  cambiarPrecio, crearTarifa, eliminarTarifa, loadTarifas, type Tarifa,
} from '../services/tarifasApi'

/**
 * Tarifas: el precio por hectárea de cada labor, por cliente.
 *
 * Es la pieza sin la cual no se puede facturar nada — hoy hay 17.475 hectáreas
 * ejecutadas y cero facturas, porque el precio no existe en ninguna parte.
 *
 * **La pantalla enseña la regla, no solo la aplica.** Cambiar un precio NO edita
 * la fila: cierra la vigencia que estaba y abre una nueva. Por eso el botón dice
 * "Cambiar precio" y no "Editar" — si dijera editar, alguien corregiría el precio
 * de enero en octubre y las facturas de enero cambiarían solas.
 */

const HOY = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pesos(n: number): string {
  return n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

function fmtDia(iso?: string): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export function TarifasTab() {
  const { terceros, labores, session, busy, setBusy, setError, setInfo } = useAppData()

  const [tarifas, setTarifas] = useState<Tarifa[]>([])
  const [cargando, setCargando] = useState(true)
  const [verCliente, setVerCliente] = useState<string>('')   // '' = todos
  const [verHistoria, setVerHistoria] = useState(false)

  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [nTercero, setNTercero] = useState('')
  const [nLabor, setNLabor] = useState('')
  const [nPrecio, setNPrecio] = useState('')
  const [nDesde, setNDesde] = useState(HOY())
  const [nNota, setNNota] = useState('')

  const [cambiando, setCambiando] = useState<Tarifa | null>(null)
  const [cPrecio, setCPrecio] = useState('')
  const [cDesde, setCDesde] = useState(HOY())
  const [cNota, setCNota] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setTarifas(await loadTarifas()) } finally { setCargando(false) }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const opcionesCliente = useMemo(
    () => [{ value: '', label: '⭐ General (todos los clientes)' },
           ...terceros.filter((t) => t.activo).map((t) => ({ value: t.id, label: t.nombre }))],
    [terceros],
  )
  const opcionesLabor = useMemo(
    () => labores.filter((l) => l.activa).map((l) => ({ value: l.nombre, label: l.nombre })),
    [labores],
  )

  /** Vigente = sin fecha de fin, o con fin en el futuro. */
  const estaVigente = (t: Tarifa) => !t.vigenteHasta || t.vigenteHasta >= HOY()

  const visibles = useMemo(() => {
    let lista = verHistoria ? tarifas : tarifas.filter(estaVigente)
    if (verCliente === '__general') lista = lista.filter((t) => !t.terceroId)
    else if (verCliente) lista = lista.filter((t) => t.terceroId === verCliente)
    return lista.sort((a, b) =>
      Number(Boolean(a.terceroId)) - Number(Boolean(b.terceroId)) ||
      (a.terceroNombre ?? '').localeCompare(b.terceroNombre ?? '', 'es') ||
      a.laborNombre.localeCompare(b.laborNombre, 'es') ||
      b.vigenteDesde.localeCompare(a.vigenteDesde))
  }, [tarifas, verCliente, verHistoria])

  const conEjemplo = tarifas.filter((t) => t.nota?.startsWith('EJEMPLO')).length

  async function guardarNueva() {
    if (!nLabor) { setError('Elige la labor.'); return }
    const p = Number(nPrecio)
    if (!Number.isFinite(p) || p <= 0) { setError('El precio tiene que ser mayor que cero.'); return }
    setBusy(true); setError('')
    try {
      await crearTarifa({
        terceroId: nTercero || undefined,
        laborNombre: nLabor, precioHa: p, vigenteDesde: nDesde,
        nota: nNota, creadoPor: session?.id,
      })
      setInfo('Tarifa creada.')
      setNuevaOpen(false); setNLabor(''); setNPrecio(''); setNNota('')
      void cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear')
    } finally { setBusy(false) }
  }

  async function guardarCambio() {
    if (!cambiando) return
    const p = Number(cPrecio)
    if (!Number.isFinite(p) || p <= 0) { setError('El precio nuevo tiene que ser mayor que cero.'); return }
    setBusy(true); setError('')
    try {
      await cambiarPrecio({
        tarifaActualId: cambiando.id, nuevoPrecio: p, desde: cDesde,
        nota: cNota, creadoPor: session?.id,
      })
      setInfo(`Precio actualizado. Lo ejecutado antes del ${fmtDia(cDesde)} se sigue cobrando al precio viejo.`)
      setCambiando(null); setCPrecio(''); setCNota('')
      void cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el precio')
    } finally { setBusy(false) }
  }

  async function borrar(t: Tarifa) {
    setBusy(true); setError('')
    try {
      await eliminarTarifa(t.id)
      setInfo('Tarifa eliminada.')
      void cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar')
    } finally { setBusy(false) }
  }

  return (
    <section className="panel">
      <div className="panel-title split">
        <h2>💲 Tarifas por labor</h2>
        <button type="button" className="primary-button" onClick={() => setNuevaOpen(true)}>
          ＋ Nueva tarifa
        </button>
      </div>

      <Ayuda>
        <p>
          Cuánto se cobra por hectárea de cada labor. Sin esto no se puede armar
          ninguna factura.
        </p>
        <p>
          La <strong>general</strong> aplica a todos; si un cliente tiene la suya, esa manda.
          Así un cliente nuevo no queda bloqueado mientras se le negocia el precio.
        </p>
        <p>
          <strong>Cada labor se cobra al precio que regía el día que se ejecutó</strong>, no
          al de hoy. Por eso al subir un precio no se corrige el anterior: se cierra y se
          abre uno nuevo, y las facturas viejas no cambian.
        </p>
      </Ayuda>

      {conEjemplo > 0 && (
        <div className="taller-aviso taller-aviso--warn" style={{ marginTop: 10 }}>
          ⚠ Hay <strong>{conEjemplo} tarifa(s) de ejemplo</strong> cargadas para que puedas
          ver la pantalla funcionando. <strong>Son inventadas</strong> — reemplázalas por
          los precios reales antes de emitir cualquier factura.
        </div>
      )}

      <div className="rep-toolbar" style={{ marginTop: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <SearchableSelect
            value={verCliente}
            onChange={setVerCliente}
            options={[{ value: '', label: 'Todos los clientes' },
                      { value: '__general', label: '⭐ Solo las generales' },
                      ...terceros.filter((t) => t.activo).map((t) => ({ value: t.id, label: t.nombre }))]}
            placeholder="Filtrar por cliente"
          />
        </div>
        <label className="chk-inline">
          <input type="checkbox" checked={verHistoria} onChange={(e) => setVerHistoria(e.target.checked)} />
          Ver precios anteriores
        </label>
      </div>

      {cargando ? <p className="muted-text">Cargando…</p> : visibles.length === 0 ? (
        <p className="muted-text">
          No hay tarifas todavía. Crea la primera con <strong>＋ Nueva tarifa</strong>.
        </p>
      ) : (
        <div className="tar-tabla">
          <div className="tar-fila tar-fila--cab">
            <span>Cliente</span><span>Labor</span><span>Precio / ha</span>
            <span>Desde</span><span></span>
          </div>
          {visibles.map((t) => {
            const vigente = estaVigente(t)
            return (
              <div key={t.id} className={`tar-fila${vigente ? '' : ' tar-fila--vieja'}`}>
                <span className="tar-cliente">
                  {t.terceroNombre ?? <em>⭐ General</em>}
                </span>
                <span>{t.laborNombre}</span>
                <span className="tar-precio">{pesos(t.precioHa)}</span>
                <span className="tar-desde">
                  {fmtDia(t.vigenteDesde)}
                  {t.vigenteHasta && <small>hasta {fmtDia(t.vigenteHasta)}</small>}
                </span>
                <span className="tar-acciones">
                  {vigente && (
                    <button type="button" className="inline-button" disabled={busy}
                            onClick={() => { setCambiando(t); setCPrecio(String(t.precioHa)); setCDesde(HOY()); setCNota('') }}>
                      Cambiar precio
                    </button>
                  )}
                  <button type="button" className="link-danger" disabled={busy}
                          onClick={() => void borrar(t)}>Eliminar</button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Nueva tarifa ────────────────────────────────────────────────── */}
      {nuevaOpen && (
        <div className="modal-overlay open" onClick={() => setNuevaOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}
               style={{ maxWidth: 'min(480px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Tarifas</p><h3>＋ Nueva tarifa</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevaOpen(false)}>✕</button>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Cliente</span>
                <SearchableSelect value={nTercero} onChange={setNTercero}
                                  options={opcionesCliente} placeholder="Elegir" />
              </label>
              <label className="field">
                <span>Labor</span>
                <SearchableSelect value={nLabor} onChange={setNLabor}
                                  options={opcionesLabor} placeholder="Elegir labor" />
              </label>
              <label className="field">
                <span>Precio por hectárea</span>
                <input type="number" min={1} step={1000} inputMode="numeric"
                       value={nPrecio} onChange={(e) => setNPrecio(e.target.value)}
                       placeholder="Ej: 95000" />
              </label>
              <label className="field">
                <span>Rige desde</span>
                <input type="date" value={nDesde} onChange={(e) => setNDesde(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Nota <span className="field-optional">(opcional)</span></span>
              <input type="text" value={nNota} onChange={(e) => setNNota(e.target.value)}
                     placeholder="Ej: contrato 2026, acta 14" />
            </label>

            <p className="subtle-copy">
              Si dejas el cliente en <strong>General</strong>, esta tarifa aplica a todos los
              que no tengan una propia.
            </p>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setNuevaOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="primary-button" disabled={busy}
                      onClick={() => void guardarNueva()}>Crear tarifa</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cambiar precio ──────────────────────────────────────────────── */}
      {cambiando && (
        <div className="modal-overlay open" onClick={() => setCambiando(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}
               style={{ maxWidth: 'min(480px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">{cambiando.terceroNombre ?? 'General'}</p>
                <h3>Cambiar precio · {cambiando.laborNombre}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setCambiando(null)}>✕</button>
            </div>

            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Hoy vale <strong>{pesos(cambiando.precioHa)}</strong> desde el{' '}
              {fmtDia(cambiando.vigenteDesde)}. El precio viejo <strong>no se borra</strong>:
              lo que se ejecutó antes se sigue cobrando a ese valor.
            </p>

            <div className="form-grid">
              <label className="field">
                <span>Precio nuevo</span>
                <input type="number" min={1} step={1000} inputMode="numeric" autoFocus
                       value={cPrecio} onChange={(e) => setCPrecio(e.target.value)} />
              </label>
              <label className="field">
                <span>Rige desde</span>
                <input type="date" value={cDesde} onChange={(e) => setCDesde(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>¿Por qué cambia? <span className="field-optional">(opcional)</span></span>
              <input type="text" value={cNota} onChange={(e) => setCNota(e.target.value)}
                     placeholder="Ej: ajuste anual, acta de renegociación" />
            </label>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setCambiando(null)}>
                Cancelar
              </button>
              <button type="button" className="primary-button" disabled={busy}
                      onClick={() => void guardarCambio()}>Guardar precio nuevo</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default TarifasTab
