import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import {
  loadCombustibleExterno, revisarCombustible,
  loadAutoabastecimientos, revisarAutoabastecimiento, loadBodegas,
} from '../services/samApi'
import { DESTINO_LABEL, type CombustibleEstado, type CombustibleExterno, type Traslado, type Bodega } from '../domain/sam'
import { fmtCantidad } from '../lib/cantidad'
import { corregirTanqueo } from '../services/samApi'
import { fmtDia, fmtFechaHora } from '../lib/fechas'
import { Ayuda } from '../components/Ayuda'

/**
 * Avales de combustible — la bandeja del analista de insumos y materiales.
 *
 * Aterrizan aquí dos cosas, con el mismo trato:
 *  · **Tanqueos** — del operario o del supervisor, en estación o en la sede.
 *  · **Abastecimientos del carro** — el material que el supervisor toma de la
 *    principal por su cuenta (entra a las 5:30; el analista, a las 7:00).
 *
 * En los dos casos el inventario ya se movió cuando se registró, porque
 * físicamente ya se lo llevaron. Lo que hace el analista es validar que lo
 * registrado corresponde. Si rechaza, el stock se reversa.
 */


const FILTROS: { key: CombustibleEstado; label: string }[] = [
  { key: 'PENDIENTE', label: 'Por avalar' },
  { key: 'APROBADO', label: 'Avalados' },
  { key: 'RECHAZADO', label: 'Rechazados' },
]

export function AvalesCombustibleTab() {
  const { session, insumos, busy, setBusy, setError, setInfo } = useAppData()

  const [estado, setEstado] = useState<CombustibleEstado>('PENDIENTE')
  const [items, setItems] = useState<CombustibleExterno[]>([])
  const [abastos, setAbastos] = useState<Traslado[]>([])
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [revAbasto, setRevAbasto] = useState<{ t: Traslado; aprobar: boolean } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [revisar, setRevisar] = useState<{ ev: CombustibleExterno; aprobar: boolean } | null>(null)
  /** Tanqueo que se esta corrigiendo, con los galones nuevos y el porque. */
  const [corrigiendo, setCorrigiendo] = useState<CombustibleExterno | null>(null)
  const [galonesNuevos, setGalonesNuevos] = useState('')
  const [motivoCorreccion, setMotivoCorreccion] = useState('')
  const [confirmaGrande, setConfirmaGrande] = useState(false)
  const [nota, setNota] = useState('')

  const refresh = useCallback(async () => {
    setCargando(true)
    try {
      const [comb, abs, bs] = await Promise.all([
        loadCombustibleExterno({ estado, limit: 300 }),
        loadAutoabastecimientos(estado),
        loadBodegas(),
      ])
      setItems(comb); setAbastos(abs); setBodegas(bs)
    } finally { setCargando(false) }
  }, [estado])
  useEffect(() => { void refresh() }, [refresh])

  /**
   * Nadie avala lo que él mismo registró.
   *
   * El analista ahora también entrega y tanquea, y el aval es justamente el
   * segundo par de ojos: si firma su propio registro, el control deja de
   * existir. Lo suyo lo avala el dueño o administración, que ven esta misma
   * pantalla.
   */
  /** Por encima de esto la cifra no cabe en ningun carro: se pide segundo toque. */
  const GALONES_SOSPECHOSO = 200

  async function guardarCorreccion() {
    if (!corrigiendo) return
    const g = Number(galonesNuevos)
    if (!Number.isFinite(g) || g <= 0) { setError('Escribe cuantos galones eran de verdad.'); return }
    if (!motivoCorreccion.trim()) { setError('Escribe por que se corrige: queda en la auditoria.'); return }
    // La misma trampa del registro original: en las tirillas de ZEUSS el punto
    // es DECIMAL. Corregir no puede ser la puerta por donde vuelve a entrar.
    if (g > GALONES_SOSPECHOSO && !confirmaGrande) {
      setConfirmaGrande(true)
      setError(`¿${fmtCantidad(g, 'galón')} galones? Es mucho mas de lo que carga un carro. `
        + 'Si lo copiaste de la tirilla, ojo: ahi el punto es DECIMAL. Si de verdad son esos, vuelve a tocar Corregir.')
      return
    }
    setBusy(true); setError('')
    try {
      const r = await corregirTanqueo({
        id: corrigiendo.id, galones: g,
        motivo: motivoCorreccion.trim(),
        editadoPor: session?.name || session?.id || 'desconocido',
      })
      setInfo(`Corregido: de ${fmtCantidad(r.antes, 'galón')} a ${fmtCantidad(r.despues, 'galón')} galones. `
        + 'Sigue pendiente del aval.')
      setCorrigiendo(null); setGalonesNuevos(''); setMotivoCorreccion(''); setConfirmaGrande(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo corregir el tanqueo.')
    } finally { setBusy(false) }
  }

  const esMio = useCallback(
    (registradoPor?: string) => !!registradoPor && registradoPor === session?.id,
    [session?.id],
  )

  const nombreInsumo = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])

  const totalPendiente = useMemo(
    () => items.reduce((t, e) => t + e.galones, 0),
    [items],
  )
  const nombreBodega = useMemo(() => {
    const m = new Map<string, string>()
    bodegas.forEach((b) => m.set(b.id, b.nombre))
    return m
  }, [bodegas])

  async function confirmarAbasto() {
    if (!revAbasto || !session) return
    setBusy(true); setError('')
    try {
      await revisarAutoabastecimiento({
        traslado: revAbasto.t,
        aprobar: revAbasto.aprobar,
        revisadoPor: session.id,
        revisadoNombre: session.name,
        nota: nota.trim() || undefined,
      })
      setInfo(revAbasto.aprobar
        ? 'Avalado. El material queda cargado al carro.'
        : 'Rechazado. El material regresó a la bodega principal.')
      setRevAbasto(null); setNota('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar el aval. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function confirmar() {
    if (!revisar || !session) return
    setBusy(true); setError('')
    try {
      await revisarCombustible({
        evento: revisar.ev,
        aprobar: revisar.aprobar,
        revisadoPor: session.id,
        revisadoNombre: session.name,
        nota: nota.trim() || undefined,
      })
      setInfo(revisar.aprobar
        ? 'Avalado. El movimiento queda en firme.'
        : 'Rechazado. El combustible regresó a su bodega.')
      setRevisar(null); setNota('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar el aval. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <h2>✅ Avales</h2>
      <Ayuda>
        <p>
          Los tanqueos y el material que los supervisores toman de la bodega principal por su
          cuenta. Al rechazar, todo regresa a la bodega de donde salió.
        </p>
      </Ayuda>

      <div className="realizadas-seg" role="group" aria-label="Estado del aval" style={{ marginTop: 10 }}>
        {FILTROS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`realizadas-seg__btn ${estado === f.key ? 'is-active' : ''}`}
            onClick={() => setEstado(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!cargando && abastos.length > 0 && (
        <>
          <p className="ins-res__lbl" style={{ marginTop: 14 }}>
            📦 Material tomado de la principal ({abastos.length})
          </p>
          <div className="inv-list">
            {abastos.map((t) => (
              <div key={t.id} className="aval-row">
                <div className="aval-row__main">
                  <div className="aval-row__top">
                    <strong>{nombreBodega.get(t.destinoId) ?? 'Carro'}</strong>
                    <span className="aval-tag aval-tag--carro">Abastecimiento</span>
                  </div>
                  <span className="subtle-copy">
                    {t.items.map((i) => `${fmtCantidad(i.cantidad, i.unidad)} ${i.unidad} ${i.insumoNombre}`).join(' · ')}
                  </span>
                  <span className="subtle-copy">{fmtFechaHora(t.createdAt)}{t.nota ? ` · ${t.nota}` : ''}</span>
                  {t.avalEstado !== 'PENDIENTE' && (
                    <span className="subtle-copy">
                      {t.avalEstado === 'APROBADO' ? '✔ Avalado' : '✕ Rechazado'} por {t.avaladoNombre ?? '—'}
                      {t.avaladoEn ? ` · ${fmtFechaHora(t.avaladoEn)}` : ''}
                      {t.avalNota ? ` · ${t.avalNota}` : ''}
                    </span>
                  )}
                </div>
                {t.avalEstado === 'PENDIENTE' && (
                  <div className="aval-row__side">
                    <div className="aval-row__acts">
                      <button type="button" className="inline-button" disabled={busy}
                        onClick={() => { setRevAbasto({ t, aprobar: false }); setNota('') }}>Rechazar</button>
                      <button type="button" className="primary-button aval-btn" disabled={busy}
                        onClick={() => { setRevAbasto({ t, aprobar: true }); setNota('') }}>✔ Avalar</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="ins-res__lbl" style={{ marginTop: 18 }}>⛽ Tanqueos</p>
        </>
      )}

      {cargando ? (
        <p className="muted-text" style={{ marginTop: 12 }}>Cargando…</p>
      ) : items.length === 0 ? (
        <p className="muted-text" style={{ marginTop: 12 }}>
          {estado === 'PENDIENTE' ? 'Nada pendiente por avalar. Todo al día.' : 'Sin registros.'}
        </p>
      ) : (
        <>
          <p className="ins-res__lbl" style={{ marginTop: 12 }}>
            {items.length} registro(s) · {fmtCantidad(totalPendiente, 'galón')} galones
          </p>
          <div className="inv-list">
            {items.map((e) => {
              const ins = e.insumoId ? nombreInsumo.get(e.insumoId) : undefined
              return (
                <div key={e.id} className="aval-row">
                  <div className="aval-row__main">
                    <div className="aval-row__top">
                      <strong>{fmtCantidad(e.galones, 'galón')} gal</strong>
                      <span className={`aval-tag aval-tag--${e.destino.toLowerCase()}`}>{DESTINO_LABEL[e.destino]}</span>
                      <span className="aval-tag aval-tag--origen">{e.origen === 'SEDE' ? '🏭 Sede' : '⛽ Estación'}</span>
                    </div>
                    <span className="subtle-copy">
                      {fmtDia(`${e.fecha}T12:00:00`)} · {e.registradoNombre ?? 'sin nombre'}
                      {ins ? ` · ${ins.nombre}` : ''}
                      {' · '}<span className="subtle-copy">registrado {fmtFechaHora(e.createdAt)}</span>
                    </span>
                    <span className="subtle-copy">
                      {e.destino === 'MAQUINA' && e.equipoCodigo ? `Máquina ${e.equipoCodigo} · horómetro ${e.horometro ?? '—'}` : null}
                      {e.destino === 'VEHICULO' && e.placa ? `Placa ${e.placa}` : null}
                      {e.destino === 'PIMPINAS' ? `${e.pimpinasCantidad ?? '?'} pimpinas × ${e.pimpinasCapacidad ?? '?'} gal` : null}
                      {e.estacion ? ` · ${e.estacion}` : ''}
                      {e.factura ? ` · tirilla ${e.factura}` : ''}
                    </span>
                    {e.estado !== 'PENDIENTE' && (
                      <span className="subtle-copy">
                        {e.estado === 'APROBADO' ? '✔ Avalado' : '✕ Rechazado'} por {e.revisadoNombre ?? '—'}
                        {e.revisadoEn ? ` · ${fmtFechaHora(e.revisadoEn)}` : ''}
                        {e.revisionNota ? ` · ${e.revisionNota}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="aval-row__side">
                    {e.tirillaUrl && (
                      <a href={e.tirillaUrl} target="_blank" rel="noreferrer" className="aval-foto">
                        <img src={e.tirillaUrl} alt="soporte" />
                      </a>
                    )}
                    {e.estado === 'PENDIENTE' && esMio(e.registradoPor) && (
                      <p className="subtle-copy aval-row__propio">
                        🔒 Lo registraste tú: lo avala el dueño o administración.
                      </p>
                    )}
                    {/* Corregir no es avalar: se puede sobre el propio registro,
                        porque arreglar un dedazo no es firmarse a si mismo. */}
                    {e.estado === 'PENDIENTE' && (
                      <div className="aval-row__acts">
                        <button type="button" className="inline-button" disabled={busy}
                          onClick={() => {
                            setCorrigiendo(e)
                            setGalonesNuevos(String(e.galones))
                            setMotivoCorreccion('')
                            setConfirmaGrande(false)
                          }}>
                          &#9998; Corregir galones
                        </button>
                      </div>
                    )}
                    {e.estado === 'PENDIENTE' && !esMio(e.registradoPor) && (
                      <div className="aval-row__acts">
                        <button type="button" className="inline-button" onClick={() => { setRevisar({ ev: e, aprobar: false }); setNota('') }} disabled={busy}>
                          Rechazar
                        </button>
                        <button type="button" className="primary-button aval-btn" onClick={() => { setRevisar({ ev: e, aprobar: true }); setNota('') }} disabled={busy}>
                          ✔ Avalar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {revAbasto && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setRevAbasto(null) }}>
          <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Abastecimiento</p>
                <h3>{revAbasto.aprobar ? '✔ Avalar' : '✕ Rechazar'}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setRevAbasto(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {revAbasto.t.items.map((i) => `${fmtCantidad(i.cantidad, i.unidad)} ${i.unidad} ${i.insumoNombre}`).join(' · ')}
              {' → '}{nombreBodega.get(revAbasto.t.destinoId) ?? 'el carro'}.
              {revAbasto.aprobar
                ? ' Queda en firme.'
                : ' El material regresa a la bodega principal.'}
            </p>
            <label>Nota <span className="field-optional">(opcional)</span>
              <input type="text" value={nota} onChange={(ev) => setNota(ev.target.value)} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setRevAbasto(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void confirmarAbasto()} disabled={busy}>
                {busy ? 'Guardando…' : revAbasto.aprobar ? 'Avalar' : 'Rechazar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revisar && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setRevisar(null) }}>
          <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Aval</p>
                <h3>{revisar.aprobar ? '✔ Avalar tanqueo' : '✕ Rechazar tanqueo'}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setRevisar(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              {fmtCantidad(revisar.ev.galones, 'galón')} galones · {DESTINO_LABEL[revisar.ev.destino]} ·{' '}
              {revisar.ev.registradoNombre ?? 'sin nombre'}.
              {revisar.aprobar
                ? ' El movimiento queda en firme.'
                : ' El combustible regresa a la bodega de donde salió.'}
            </p>
            <label>Nota <span className="field-optional">(opcional)</span>
              <input type="text" value={nota} onChange={(ev) => setNota(ev.target.value)} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setRevisar(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void confirmar()} disabled={busy}>
                {busy ? 'Guardando…' : revisar.aprobar ? 'Avalar' : 'Rechazar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {corrigiendo && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setCorrigiendo(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Combustible</p><h3>Corregir los galones</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setCorrigiendo(null)}
                      disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>

            <p className="subtle-copy">
              Registrado por <strong>{corrigiendo.registradoNombre || corrigiendo.registradoPor}</strong>
              {corrigiendo.estacion ? ` en ${corrigiendo.estacion}` : ''} ·
              hoy dice <strong>{fmtCantidad(corrigiendo.galones, 'galón')} galones</strong>.
            </p>

            <label style={{ display: 'block', marginTop: 10 }}>Galones de verdad
              <input type="number" min={0} step="any" inputMode="decimal" autoFocus
                     value={galonesNuevos}
                     onChange={(e) => { setGalonesNuevos(e.target.value); setConfirmaGrande(false) }}
                     disabled={busy} />
            </label>

            <label style={{ display: 'block', marginTop: 10 }}>¿Por qué se corrige?
              <textarea rows={2} value={motivoCorreccion} disabled={busy}
                        placeholder="Se leyo la tirilla: eran 62,255 y no 62255"
                        onChange={(e) => setMotivoCorreccion(e.target.value)} />
            </label>

            <p className="subtle-copy" style={{ marginTop: 8 }}>
              Se corrige el registro y se rehacen los saldos de la bodega, todo junto.
              <strong> No lo avala:</strong> sigue pendiente para que alguien lo revise.
              Queda en la auditoría quién lo cambió y por qué.
            </p>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setCorrigiendo(null)} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className="primary-button" onClick={() => void guardarCorreccion()} disabled={busy}>
                {busy ? 'Guardando…' : confirmaGrande ? `Sí, son ${galonesNuevos} galones` : 'Corregir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default AvalesCombustibleTab
