import { useRef, useState } from 'react'
import {
  bulkInsertMaestro,
  bulkUpdateMaestroArea,
  bulkReactivateMaestro,
  bulkDeactivateMaestro,
} from '../services/samApi'
import type { MaestroRow } from '../domain/sam'
import { INGENIOS } from '../data/ingenios'

function stripAccents(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function normIng(s: unknown) {
  return stripAccents(String(s ?? ''))
    .toUpperCase()
    .replace(/^INGENIO\s+/, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
}
function resolveIngenio(cell: unknown): string | null {
  const n = normIng(cell)
  if (!n) return null
  for (const ing of INGENIOS) {
    if (n === normIng(ing.id) || n === normIng(ing.nombre)) return ing.id
  }
  return null
}

interface ParsedRow {
  ingenio_id: string
  haciendaCode: string
  haciendaName: string
  suerte: string
  area: number
}
interface ChangedRow {
  ingenio_id: string
  haciendaCode: string
  haciendaName: string
  suerte: string
  oldArea: number
  newArea: number
  apply: boolean
}
interface RemovedRow {
  ingenio_id: string
  haciendaCode: string
  haciendaName: string
  suerte: string
  area: number
  hasActiveLabor: boolean
  apply: boolean
}
interface ErrRow {
  fila: number
  motivo: string
}

export interface BulkApplyResult {
  inserted: MaestroRow[]
  updated: { ingenio_id: string; haciendaCode: string; suerte: string; area: number }[]
  deactivated: { ingenio_id: string; haciendaCode: string; suerte: string }[]
}

interface Props {
  open: boolean
  onClose: () => void
  maestro: MaestroRow[]
  createdBy: string
  /** suerteCodes ("hacienda-suerte") con labor activa → aviso al desactivar. */
  activeSuerteCodes: Set<string>
  onApplied: (result: BulkApplyResult) => void
}

const k3 = (ing: string, cod: string, sue: string) => `${ing}|${cod}|${sue}`

export function BulkMaestroModal({ open, onClose, maestro, createdBy, activeSuerteCodes, onApplied }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState(false)
  const [nuevas, setNuevas] = useState<ParsedRow[]>([])
  const [changed, setChanged] = useState<ChangedRow[]>([])
  const [removed, setRemoved] = useState<RemovedRow[]>([])
  const [unchanged, setUnchanged] = useState(0)
  const [errores, setErrores] = useState<ErrRow[]>([])

  function reset() {
    setFileName('')
    setParsed(false)
    setNuevas([])
    setChanged([])
    setRemoved([])
    setUnchanged(0)
    setErrores([])
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function closeAll() {
    if (busy) return
    reset()
    onClose()
  }

  async function downloadTemplate() {
    try {
      const { utils, writeFile } = await import('xlsx')
      const header = ['Ingenio', 'Codigo hacienda', 'Nombre hacienda', 'Suerte', 'Area neta (ha)']
      const ejemplos = [
        ['Ingenio Risaralda', '105', 'SAN MIGUEL', '0042', 14.51],
        ['Ingenio Pichichi', '0001', 'FINCA 0001', '010', 10.0],
      ]
      const ws = utils.aoa_to_sheet([header, ...ejemplos])
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Suertes')
      const ref = utils.aoa_to_sheet([
        ['Llena la hoja "Suertes". Borra las filas de ejemplo.'],
        [],
        ['Ingenio válido (columna "Ingenio") — puedes usar el nombre o el id:'],
        ...INGENIOS.map((i) => [i.nombre, i.id]),
      ])
      utils.book_append_sheet(wb, ref, 'Instrucciones')
      writeFile(wb, 'plantilla-suertes.xlsx')
    } catch {
      setError('No se pudo generar la plantilla.')
    }
  }

  async function onFile(file: File) {
    setBusy(true)
    reset()
    setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const data = new Uint8Array(await file.arrayBuffer())
      const wb = XLSX.read(data, { type: 'array' })
      let aoa: unknown[][] | null = null
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) as unknown[][]
        if (!rows.length) continue
        const h = (rows[0] as unknown[]).map((x) => normIng(x))
        if (h.some((c) => c.includes('SUERTE')) && h.some((c) => c.includes('INGENIO'))) {
          aoa = rows
          break
        }
      }
      if (!aoa) {
        setError('No encontré una hoja con columnas Ingenio / Suerte. Usa la plantilla.')
        return
      }
      const header = (aoa[0] as unknown[]).map((x) => normIng(x))
      const find = (kw: string) => header.findIndex((c) => c.includes(kw))
      const iIng = find('INGENIO')
      const iCod = find('CODIGO')
      const iNom = find('NOMBRE')
      const iSue = find('SUERTE')
      const iArea = find('AREA')
      if ([iIng, iCod, iNom, iSue, iArea].some((x) => x < 0)) {
        setError('Faltan columnas. La plantilla debe tener: Ingenio, Codigo hacienda, Nombre hacienda, Suerte, Area neta.')
        return
      }

      const dedup = new Set<string>()
      const ok: ParsedRow[] = []
      const errs: ErrRow[] = []
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i]
        const ingCell = r[iIng]
        const cod = String(r[iCod] ?? '').trim()
        const nom = String(r[iNom] ?? '').trim().toUpperCase()
        const sue = String(r[iSue] ?? '').trim()
        const areaRaw = r[iArea]
        if (!String(ingCell ?? '').trim() && !cod && !nom && !sue && !String(areaRaw ?? '').trim()) continue
        const ing = resolveIngenio(ingCell)
        const area = typeof areaRaw === 'number' ? areaRaw : parseFloat(String(areaRaw ?? '').replace(/,/g, '.'))
        if (!ing) { errs.push({ fila: i + 1, motivo: `ingenio inválido: "${String(ingCell ?? '')}"` }); continue }
        if (!cod) { errs.push({ fila: i + 1, motivo: 'falta código de hacienda' }); continue }
        if (!nom) { errs.push({ fila: i + 1, motivo: 'falta nombre de hacienda' }); continue }
        if (!sue) { errs.push({ fila: i + 1, motivo: 'falta número de suerte' }); continue }
        if (!area || isNaN(area) || area <= 0) { errs.push({ fila: i + 1, motivo: 'área inválida (> 0)' }); continue }
        const key = k3(ing, cod, sue)
        if (dedup.has(key)) { errs.push({ fila: i + 1, motivo: 'duplicada dentro del archivo' }); continue }
        dedup.add(key)
        ok.push({ ingenio_id: ing, haciendaCode: cod, haciendaName: nom, suerte: sue, area })
      }

      // --- Reconciliación contra el catálogo ACTUAL (solo activas) ---
      const currentByKey = new Map(maestro.map((r) => [k3(r.ingenio_id, r.haciendaCode, r.suerte), r]))
      const parsedKeys = new Set(ok.map((r) => k3(r.ingenio_id, r.haciendaCode, r.suerte)))
      // Alcance "desaparecidas" = solo haciendas presentes en el archivo.
      const haciendasInFile = new Set(ok.map((r) => `${r.ingenio_id}|${r.haciendaCode}`))

      const news: ParsedRow[] = []
      const chg: ChangedRow[] = []
      let unch = 0
      for (const r of ok) {
        const cur = currentByKey.get(k3(r.ingenio_id, r.haciendaCode, r.suerte))
        if (!cur) { news.push(r); continue }
        if (Math.abs(cur.area - r.area) > 0.001) {
          chg.push({
            ingenio_id: r.ingenio_id,
            haciendaCode: r.haciendaCode,
            haciendaName: r.haciendaName,
            suerte: r.suerte,
            oldArea: cur.area,
            newArea: r.area,
            apply: true,
          })
        } else {
          unch++
        }
      }
      const rem: RemovedRow[] = []
      for (const r of maestro) {
        if (!haciendasInFile.has(`${r.ingenio_id}|${r.haciendaCode}`)) continue
        if (parsedKeys.has(k3(r.ingenio_id, r.haciendaCode, r.suerte))) continue
        const hasActiveLabor = activeSuerteCodes.has(`${r.haciendaCode}-${r.suerte}`)
        rem.push({
          ingenio_id: r.ingenio_id,
          haciendaCode: r.haciendaCode,
          haciendaName: r.haciendaName,
          suerte: r.suerte,
          area: r.area,
          hasActiveLabor,
          // Default: desactivar — PERO si tiene labor activa arranca SIN marcar
          // (decisión consciente para no quitar algo en uso).
          apply: !hasActiveLabor,
        })
      }

      setNuevas(news)
      setChanged(chg)
      setRemoved(rem)
      setUnchanged(unch)
      setErrores(errs)
      setParsed(true)
      if (ok.length === 0 && errs.length === 0) setError('El archivo no tiene filas con datos.')
    } catch {
      setError('No se pudo leer el archivo. Verifica que sea .xlsx válido.')
    } finally {
      setBusy(false)
    }
  }

  function toggleChanged(idx: number) {
    setChanged((prev) => prev.map((c, i) => (i === idx ? { ...c, apply: !c.apply } : c)))
  }
  function toggleRemoved(idx: number) {
    setRemoved((prev) => prev.map((c, i) => (i === idx ? { ...c, apply: !c.apply } : c)))
  }
  function setAllChanged(v: boolean) {
    setChanged((prev) => prev.map((c) => ({ ...c, apply: v })))
  }
  function setAllRemoved(v: boolean) {
    setRemoved((prev) => prev.map((c) => ({ ...c, apply: v })))
  }

  const updatesSel = changed.filter((c) => c.apply)
  const removalsSel = removed.filter((c) => c.apply)
  const totalActions = nuevas.length + updatesSel.length + removalsSel.length

  async function confirmar() {
    if (totalActions === 0) return
    setBusy(true)
    setError('')
    try {
      const newPayload = nuevas.map((r) => ({
        haciendaCode: r.haciendaCode,
        haciendaName: r.haciendaName,
        suerte: r.suerte,
        area: r.area,
        ingenio_id: r.ingenio_id,
      }))
      const inserted = await bulkInsertMaestro(newPayload, createdBy)
      // Las "nuevas" que NO volvieron del insert = chocaron con una fila
      // inactiva (suerte que REAPARECE) → reactivar.
      const insertedKeys = new Set(inserted.map((r) => k3(r.ingenio_id, r.haciendaCode, r.suerte)))
      const reappeared = newPayload.filter((r) => !insertedKeys.has(k3(r.ingenio_id, r.haciendaCode, r.suerte)))
      const reactivated = reappeared.length ? await bulkReactivateMaestro(reappeared) : []

      const updatePayload = updatesSel.map((c) => ({
        ingenio_id: c.ingenio_id,
        haciendaCode: c.haciendaCode,
        suerte: c.suerte,
        area: c.newArea,
      }))
      if (updatePayload.length) await bulkUpdateMaestroArea(updatePayload)

      const deactivatePayload = removalsSel.map((c) => ({
        ingenio_id: c.ingenio_id,
        haciendaCode: c.haciendaCode,
        suerte: c.suerte,
      }))
      if (deactivatePayload.length) await bulkDeactivateMaestro(deactivatePayload)

      onApplied({
        inserted: [...inserted, ...reactivated],
        updated: updatePayload,
        deactivated: deactivatePayload,
      })
      reset()
      onClose()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo aplicar. (${e?.message ?? 'error'}) — verifica conexión y/o avisa al admin.`)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={closeAll}>
      <div className="modal-card bulk-maestro-card" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Maestro</p>
            <h3>Actualizar catálogo (cargue masivo)</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={closeAll} disabled={busy} aria-label="Cerrar">
            &#x2715;
          </button>
        </div>

        <ol className="bulk-steps">
          <li>Descarga la plantilla, llénala con el catálogo del ingenio y guárdala.</li>
          <li>Súbela: comparo contra el catálogo actual y te muestro qué cambia.</li>
          <li>Revisa y <strong>decide</strong> qué hacer con áreas cambiadas y desaparecidas. Nada se aplica hasta confirmar.</li>
        </ol>

        <div className="bulk-actions">
          <button type="button" className="primary-button outline" onClick={() => void downloadTemplate()} disabled={busy}>
            ⬇ Descargar plantilla
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
            }}
          />
          <button type="button" className="primary-button outline" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Leyendo…' : '⬆ Subir archivo'}
          </button>
        </div>

        {fileName && <p className="subtle-copy" style={{ margin: '4px 0' }}>📄 {fileName}</p>}
        {error && <div className="feedback error">{error}</div>}

        {parsed && (
          <>
            <div className="bulk-summary">
              <div className="bulk-kpi bulk-kpi--green"><strong>{nuevas.length}</strong><span>nuevas</span></div>
              <div className="bulk-kpi" style={{ color: '#b06a00' }}><strong>{changed.length}</strong><span>área cambiada</span></div>
              <div className="bulk-kpi bulk-kpi--red"><strong>{removed.length}</strong><span>desaparecidas</span></div>
              <div className="bulk-kpi"><strong>{unchanged}</strong><span>sin cambios</span></div>
              {errores.length > 0 && (
                <div className="bulk-kpi bulk-kpi--red"><strong>{errores.length}</strong><span>con error</span></div>
              )}
            </div>

            <p className="field-hint" style={{ marginTop: 4 }}>
              Las <strong>desaparecidas</strong> se evalúan solo en las haciendas que vienen en el archivo (una hacienda ausente del archivo no se toca).
            </p>

            {/* ÁREAS CAMBIADAS */}
            {changed.length > 0 && (
              <div className="bulk-recon">
                <div className="bulk-recon__head">
                  <strong>🟡 Área cambiada ({changed.length})</strong>
                  <span>
                    <button type="button" className="inline-button" onClick={() => setAllChanged(true)}>Todas</button>
                    {' · '}
                    <button type="button" className="inline-button" onClick={() => setAllChanged(false)}>Ninguna</button>
                  </span>
                </div>
                <p className="field-hint">Marcadas = se actualiza al área nueva. Desmárcala para conservar la actual.</p>
                <ul className="bulk-recon__list">
                  {changed.slice(0, 60).map((c, i) => (
                    <li key={k3(c.ingenio_id, c.haciendaCode, c.suerte)}>
                      <label>
                        <input type="checkbox" checked={c.apply} onChange={() => toggleChanged(i)} disabled={busy} />
                        <span>{c.haciendaCode} {c.haciendaName} · {c.suerte}</span>
                      </label>
                      <span className="bulk-recon__delta">
                        {c.oldArea.toFixed(2)} → <strong>{c.newArea.toFixed(2)}</strong> ha
                      </span>
                    </li>
                  ))}
                  {changed.length > 60 && <li className="bulk-recon__more">…y {changed.length - 60} más (se aplican según el estado de marcado masivo).</li>}
                </ul>
              </div>
            )}

            {/* DESAPARECIDAS */}
            {removed.length > 0 && (
              <div className="bulk-recon">
                <div className="bulk-recon__head">
                  <strong>🔴 Desaparecidas ({removed.length})</strong>
                  <span>
                    <button type="button" className="inline-button" onClick={() => setAllRemoved(true)}>Todas</button>
                    {' · '}
                    <button type="button" className="inline-button" onClick={() => setAllRemoved(false)}>Ninguna</button>
                  </span>
                </div>
                <p className="field-hint">Marcadas = se desactivan (salen del catálogo, conservan histórico). Las que tienen labor activa arrancan sin marcar.</p>
                <ul className="bulk-recon__list">
                  {removed.slice(0, 60).map((c, i) => (
                    <li key={k3(c.ingenio_id, c.haciendaCode, c.suerte)}>
                      <label>
                        <input type="checkbox" checked={c.apply} onChange={() => toggleRemoved(i)} disabled={busy} />
                        <span>{c.haciendaCode} {c.haciendaName} · {c.suerte}</span>
                      </label>
                      <span className="bulk-recon__delta">
                        {c.area.toFixed(2)} ha
                        {c.hasActiveLabor && <span className="bulk-recon__warn"> ⚠ labor activa</span>}
                      </span>
                    </li>
                  ))}
                  {removed.length > 60 && <li className="bulk-recon__more">…y {removed.length - 60} más (se aplican según el estado de marcado masivo).</li>}
                </ul>
              </div>
            )}

            {errores.length > 0 && (
              <div className="bulk-errores">
                <strong>Filas con error (no se procesan):</strong>
                <ul>
                  {errores.slice(0, 20).map((e, i) => (
                    <li key={i}>Fila {e.fila}: {e.motivo}</li>
                  ))}
                  {errores.length > 20 && <li>…y {errores.length - 20} más.</li>}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={closeAll} disabled={busy}>
            Cerrar
          </button>
          <button type="button" className="primary-button" onClick={() => void confirmar()} disabled={busy || totalActions === 0}>
            {busy
              ? 'Aplicando…'
              : `Aplicar (+${nuevas.length} · ~${updatesSel.length} · −${removalsSel.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default BulkMaestroModal
