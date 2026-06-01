import { useRef, useState } from 'react'
import { bulkInsertMaestro } from '../services/samApi'
import type { MaestroRow } from '../domain/sam'

const INGENIOS = [
  { id: 'risaralda', nombre: 'Ingenio Risaralda' },
  { id: 'pichichi', nombre: 'Ingenio Pichichi' },
  { id: 'mayaguez', nombre: 'Ingenio Mayagüez' },
  { id: 'san_carlos', nombre: 'Ingenio San Carlos' },
  { id: 'riopaila', nombre: 'Ingenio Riopaila' },
]

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
// Resuelve la celda "Ingenio" (acepta id 'risaralda', 'san_carlos', o nombre
// 'Ingenio Risaralda', 'San Carlos', etc.) → id canónico, o null si no calza.
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
interface ErrRow {
  fila: number
  motivo: string
}

interface Props {
  open: boolean
  onClose: () => void
  maestro: MaestroRow[]
  createdBy: string
  onInserted: (rows: MaestroRow[]) => void
}

export function BulkMaestroModal({ open, onClose, maestro, createdBy, onInserted }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [valid, setValid] = useState<ParsedRow[]>([])
  const [errores, setErrores] = useState<ErrRow[]>([])
  const [nuevas, setNuevas] = useState(0)
  const [existentes, setExistentes] = useState(0)

  function reset() {
    setFileName('')
    setValid([])
    setErrores([])
    setNuevas(0)
    setExistentes(0)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
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
    setError('')
    setValid([])
    setErrores([])
    setNuevas(0)
    setExistentes(0)
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
      const existeSet = new Set(maestro.map((r) => `${r.ingenio_id}|${r.haciendaCode}|${r.suerte}`))
      const dedup = new Set<string>()
      const ok: ParsedRow[] = []
      const errs: ErrRow[] = []
      let nuevasN = 0
      let existN = 0
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i]
        const ingCell = r[iIng]
        const cod = String(r[iCod] ?? '').trim()
        const nom = String(r[iNom] ?? '').trim().toUpperCase()
        const sue = String(r[iSue] ?? '').trim()
        const areaRaw = r[iArea]
        // fila totalmente vacía → ignorar sin error
        if (!String(ingCell ?? '').trim() && !cod && !nom && !sue && !String(areaRaw ?? '').trim()) continue
        const ing = resolveIngenio(ingCell)
        const area = typeof areaRaw === 'number' ? areaRaw : parseFloat(String(areaRaw ?? '').replace(/,/g, '.'))
        if (!ing) { errs.push({ fila: i + 1, motivo: `ingenio inválido: "${String(ingCell ?? '')}"` }); continue }
        if (!cod) { errs.push({ fila: i + 1, motivo: 'falta código de hacienda' }); continue }
        if (!nom) { errs.push({ fila: i + 1, motivo: 'falta nombre de hacienda' }); continue }
        if (!sue) { errs.push({ fila: i + 1, motivo: 'falta número de suerte' }); continue }
        if (!area || isNaN(area) || area <= 0) { errs.push({ fila: i + 1, motivo: 'área inválida (> 0)' }); continue }
        const key = `${ing}|${cod}|${sue}`
        if (dedup.has(key)) { errs.push({ fila: i + 1, motivo: 'duplicada dentro del archivo' }); continue }
        dedup.add(key)
        if (existeSet.has(key)) existN++
        else nuevasN++
        ok.push({ ingenio_id: ing, haciendaCode: cod, haciendaName: nom, suerte: sue, area })
      }
      setValid(ok)
      setErrores(errs)
      setNuevas(nuevasN)
      setExistentes(existN)
      if (ok.length === 0 && errs.length === 0) setError('El archivo no tiene filas con datos.')
    } catch {
      setError('No se pudo leer el archivo. Verifica que sea .xlsx válido.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmar() {
    if (valid.length === 0) return
    setBusy(true)
    setError('')
    try {
      const insertadas = await bulkInsertMaestro(valid, createdBy)
      onInserted(insertadas)
      reset()
      onClose()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo cargar. (${e?.message ?? 'error'}) — verifica conexión y/o avisa al admin.`)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={() => { if (!busy) { reset(); onClose() } }}>
      <div className="modal-card bulk-maestro-card" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Maestro</p>
            <h3>Cargue masivo de suertes</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={() => { reset(); onClose() }} disabled={busy} aria-label="Cerrar">
            &#x2715;
          </button>
        </div>

        <ol className="bulk-steps">
          <li>Descarga la plantilla, llénala (borra las filas de ejemplo) y guárdala.</li>
          <li>Súbela aquí: validamos y te mostramos cuántas se van a crear.</li>
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

        {(valid.length > 0 || errores.length > 0) && (
          <div className="bulk-summary">
            <div className="bulk-kpi bulk-kpi--green"><strong>{nuevas}</strong><span>nuevas a crear</span></div>
            <div className="bulk-kpi"><strong>{existentes}</strong><span>ya existen (se omiten)</span></div>
            <div className="bulk-kpi bulk-kpi--red"><strong>{errores.length}</strong><span>con error</span></div>
          </div>
        )}

        {errores.length > 0 && (
          <div className="bulk-errores">
            <strong>Filas con error (no se cargan):</strong>
            <ul>
              {errores.slice(0, 30).map((e, i) => (
                <li key={i}>Fila {e.fila}: {e.motivo}</li>
              ))}
              {errores.length > 30 && <li>…y {errores.length - 30} más.</li>}
            </ul>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={() => { reset(); onClose() }} disabled={busy}>
            Cerrar
          </button>
          <button type="button" className="primary-button" onClick={() => void confirmar()} disabled={busy || valid.length === 0}>
            {busy ? 'Cargando…' : `Crear ${nuevas} suerte${nuevas === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default BulkMaestroModal
