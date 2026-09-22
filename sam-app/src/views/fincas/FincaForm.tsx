import { useMemo, useState } from 'react'
import type { CtxFincas } from './FincasView'
import { agregarSuertes, guardarFinca, mensajeDeError, type Finca } from '../../services/fincasApi'
import { useAppData } from '../../context/AppDataContext'
import { fmtCant } from '../../lib/fincas'

/**
 * Crear o editar una finca: el dueño, a qué ingenio entrega y sus suertes con el
 * área. Las suertes se pueden traer del maestro del ingenio (misma llave
 * ingenio + hacienda que usa la maquinaria) o escribir a mano.
 */
export function FincaForm({ ctx, fincaId, onListo }: { ctx: CtxFincas; fincaId: string | null; onListo: (id: string | null) => void }) {
  const { datos: d, token, recargar, esAdmin } = ctx
  const { ingenios, maestro } = useAppData()
  const actual = fincaId ? d.fincas.find((f) => f.id === fincaId) : undefined
  const [f, setF] = useState({
    nombre: actual?.nombre ?? '', duenoNombre: actual?.duenoNombre ?? '', duenoTelefono: actual?.duenoTelefono ?? '',
    duenoCorreo: actual?.duenoCorreo ?? '', ingenioId: actual?.ingenioId ?? '', municipio: actual?.municipio ?? '',
    honorarioModo: (actual?.honorarioModo ?? 'POR_DEFINIR') as Finca['honorarioModo'],
    honorarioValor: actual?.honorarioValor != null ? String(actual.honorarioValor) : '', nota: actual?.nota ?? '',
  })
  const [hacienda, setHacienda] = useState('')
  const [nuevas, setNuevas] = useState<{ codigo: string; areaHa: string }[]>([])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const existentes = fincaId ? d.suertes.filter((s) => s.fincaId === fincaId) : []

  // Haciendas del maestro del ingenio escogido: de ahí se traen las suertes con su área.
  const haciendas = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of maestro) if (f.ingenioId && r.ingenio_id === f.ingenioId && !m.has(r.haciendaCode)) m.set(r.haciendaCode, r.haciendaName)
    return [...m].map(([code, name]) => ({ code, name: name.trim() })).sort((a, b) => a.name.localeCompare(b.name))
  }, [maestro, f.ingenioId])

  if (!esAdmin) return <p className="subtle-copy">Solo administración crea y edita fincas.</p>
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  function traerDelMaestro() {
    const ya = new Set([...existentes.map((s) => s.codigo), ...nuevas.map((s) => s.codigo)])
    const filas = maestro.filter((r) => r.ingenio_id === f.ingenioId && r.haciendaCode === hacienda && !ya.has(r.suerte))
    setNuevas((n) => [...n, ...filas.map((r) => ({ codigo: r.suerte, areaHa: String(r.area) }))])
    if (!f.nombre.trim()) set('nombre', haciendas.find((h) => h.code === hacienda)?.name ?? '')
  }

  const validas = nuevas.filter((s) => s.codigo.trim() && Number(s.areaHa.replace(',', '.')) > 0)
  const listo = f.nombre.trim() && f.duenoNombre.trim()

  async function guardar() {
    setGuardando(true); setError('')
    try {
      const id = await guardarFinca({
        id: fincaId ?? undefined, nombre: f.nombre, duenoNombre: f.duenoNombre, duenoTelefono: f.duenoTelefono,
        duenoCorreo: f.duenoCorreo, ingenioId: f.ingenioId, municipio: f.municipio, honorarioModo: f.honorarioModo,
        honorarioValor: f.honorarioValor ? Number(f.honorarioValor.replace(',', '.')) : null, nota: f.nota,
      }, token)
      await agregarSuertes(id, validas.map((s) => ({ codigo: s.codigo, areaHa: Number(s.areaHa.replace(',', '.')) })), token)
      await recargar()
      onListo(id)
    } catch (e) { setError(mensajeDeError(e)) } finally { setGuardando(false) }
  }

  return (
    <div className="af-stack">
      <div className="af-cab">
        <div><button type="button" className="af-link" onClick={() => onListo(null)}>← Volver</button><h2>{actual ? `Editar ${actual.nombre}` : 'Nueva finca'}</h2></div>
      </div>
      <div className="af-card">
        <h3>La finca y su dueño</h3>
        <div className="af-form">
          <label>Nombre de la finca<input id="af-f-nombre" value={f.nombre} onChange={(e) => set('nombre', e.target.value)} /></label>
          <label>Dueño de la tierra<input id="af-f-dueno" value={f.duenoNombre} onChange={(e) => set('duenoNombre', e.target.value)} /></label>
          <label>Celular del dueño (WhatsApp)<input id="af-f-tel" inputMode="tel" value={f.duenoTelefono} onChange={(e) => set('duenoTelefono', e.target.value)} placeholder="3001234567" /></label>
          <label>Correo del dueño<input id="af-f-correo" type="email" value={f.duenoCorreo} onChange={(e) => set('duenoCorreo', e.target.value)} /></label>
          <label>Ingenio al que entrega
            <select id="af-f-ingenio" value={f.ingenioId} onChange={(e) => { set('ingenioId', e.target.value); setHacienda('') }}>
              <option value="">Sin definir</option>
              {ingenios.filter((i) => i.activo).map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
            </select>
          </label>
          <label>Municipio<input id="af-f-muni" value={f.municipio} onChange={(e) => set('municipio', e.target.value)} /></label>
          <label>Cómo cobra ASM la administración
            <select id="af-f-hon" value={f.honorarioModo} onChange={(e) => set('honorarioModo', e.target.value)}>
              <option value="POR_DEFINIR">Por definir</option>
              <option value="PORCENTAJE">Porcentaje sobre los costos</option>
              <option value="FIJO_HA_MES">Valor fijo por hectárea al mes</option>
            </select>
          </label>
          {f.honorarioModo !== 'POR_DEFINIR' && (
            <label>{f.honorarioModo === 'PORCENTAJE' ? 'Porcentaje (%)' : 'Pesos por ha al mes'}
              <input id="af-f-honv" inputMode="decimal" value={f.honorarioValor} onChange={(e) => set('honorarioValor', e.target.value)} /></label>
          )}
          <label className="af-form__ancho">Nota<input id="af-f-nota" value={f.nota} onChange={(e) => set('nota', e.target.value)} placeholder="Acuerdos con el dueño, linderos, etc." /></label>
        </div>
      </div>

      <div className="af-card">
        <h3>Suertes</h3>
        {existentes.length > 0 && (
          <p className="af-nota">Ya tiene: {existentes.map((s) => `${s.codigo} (${fmtCant(s.areaHa)} ha)`).join(' · ')}</p>
        )}
        {f.ingenioId && haciendas.length > 0 && (
          <div className="af-mini-form">
            <label>Traer del maestro del ingenio
              <select id="af-f-hacienda" value={hacienda} onChange={(e) => setHacienda(e.target.value)}>
                <option value="">Escoja la hacienda…</option>
                {haciendas.map((h) => <option key={h.code} value={h.code}>{h.code} · {h.name}</option>)}
              </select>
            </label>
            <button type="button" className="inline-button" disabled={!hacienda} onClick={traerDelMaestro}>Traer sus suertes</button>
          </div>
        )}
        {nuevas.map((s, i) => (
          <div key={i} className="af-suerte-fila">
            <input id={`af-s-cod-${i}`} aria-label="Suerte" value={s.codigo} placeholder="Suerte" onChange={(e) => setNuevas((n) => n.map((x, j) => j === i ? { ...x, codigo: e.target.value } : x))} />
            <input id={`af-s-area-${i}`} aria-label="Área (ha)" inputMode="decimal" value={s.areaHa} placeholder="Área ha" onChange={(e) => setNuevas((n) => n.map((x, j) => j === i ? { ...x, areaHa: e.target.value } : x))} />
            <button type="button" className="af-link" onClick={() => setNuevas((n) => n.filter((_, j) => j !== i))}>Quitar</button>
          </div>
        ))}
        <button type="button" className="inline-button" onClick={() => setNuevas((n) => [...n, { codigo: '', areaHa: '' }])}>+ Suerte a mano</button>
        {validas.length > 0 && <p className="af-nota">Se agregan {validas.length} suerte{validas.length === 1 ? '' : 's'} · {fmtCant(validas.reduce((s, x) => s + Number(x.areaHa.replace(',', '.')), 0))} ha.</p>}
      </div>

      {error && <p className="feedback error">{error}</p>}
      <div className="af-acciones">
        <button type="button" className="primary-button" disabled={!listo || guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar finca'}</button>
        <button type="button" className="inline-button" onClick={() => onListo(null)}>Cancelar</button>
      </div>
      <p className="af-nota">Después, en «Labores por suerte», se abre el ciclo de cada suerte con su fecha de corte: ahí se cargan las labores del paquete con su presupuesto.</p>
    </div>
  )
}
