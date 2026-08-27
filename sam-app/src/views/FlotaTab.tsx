import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadFlotaServicios, anularFlotaServicio } from '../services/samApi'
import { FlotaForm } from './FlotaForm'
import type { FlotaServicio } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'

/**
 * Módulo Flota / Escolta — lista de servicios (CDA-F-68), registro de uno nuevo
 * y exportación a Excel con el formato oficial. Con `conductorScope` se acota a
 * un conductor (su vista); sin él, administración ve todos.
 */
/**
 * Membrete y codigos de normalizacion del formato impreso.
 *
 * Van aparte y con nombre para que se puedan cambiar sin tocar el codigo del
 * export: cuando salga la version 2 del formato, se edita aqui y ya.
 */
const MEMBRETE = {
  empresa: 'IMECOL',
  titulo: 'CONTROL DE TRANSPORTE FLOTA NO PROPIA',
  codigo: 'CDA-F-68',
  version: '1',
  fecha: '1/05/2025',
  pagina: '1 de 1',
}

function primerDiaMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtFecha(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

export function FlotaTab({ conductorScope }: { conductorScope?: { id: string; nombre: string } }) {
  const { busy, setBusy, setError, setInfo } = useAppData()
  const esAdmin = !conductorScope

  const [servicios, setServicios] = useState<FlotaServicio[]>([])
  const [loading, setLoading] = useState(false)
  const [desde, setDesde] = useState(primerDiaMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [busca, setBusca] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [verFotoUrl, setVerFotoUrl] = useState<string>('')

  async function refresh() {
    setLoading(true)
    try {
      setServicios(await loadFlotaServicios({ conductorId: conductorScope?.id, desde, hasta }))
    } finally { setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return servicios.filter((s) => !q ||
      `${s.origen} ${s.destino} ${s.nombrePasajero} ${s.vehiculo} ${s.conductorNombre} ${s.centroCosto}`.toLowerCase().includes(q))
  }, [servicios, busca])

  async function exportarExcel() {
    if (lista.length === 0) { setError('No hay servicios en el rango elegido.'); return }
    setBusy(true); setError('')
    try {
      // Se usa exceljs y no xlsx porque la version comunitaria de xlsx NO
      // ESCRIBE ESTILOS: probado, el borde y la negrita se descartan al guardar.
      // Y una planilla que se imprime y se entrega sin la cuadricula se ve a
      // medio hacer. Va con import() para que no entre al bundle inicial.
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('CDA-F-68', {
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      })

      // La primera columna es la del membrete: con 10 de ancho, "IMECOL" se
      // parte en dos renglones (IMECO / L). 18 le da aire al logo tambien.
      const COLS = [18, 14, 14, 16, 20, 14, 14, 11, 11, 11, 11, 10, 8, 11, 9, 26]
      ws.columns = COLS.map((w) => ({ width: w }))

      const linea = { style: 'thin' as const, color: { argb: 'FF000000' } }
      const marco = { top: linea, left: linea, bottom: linea, right: linea }
      const centro = { vertical: 'middle' as const, horizontal: 'center' as const, wrapText: true }

      // Membrete: nombre a la izquierda, titulo al centro, codigos a la derecha.
      ws.mergeCells('A1:A4')
      ws.mergeCells('B1:N1')
      ws.mergeCells('B2:N4')
      for (const f of [1, 2, 3, 4]) ws.mergeCells(f, 15, f, 16)

      ws.getCell('A1').value = MEMBRETE.empresa
      // Rojo de la marca IMECOL. `wrapText: false` para que no se parta.
      ws.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFD0021B' } }
      ws.getCell('B1').value = 'FORMATO'
      ws.getCell('B1').font = { bold: true, size: 11 }
      ws.getCell('B2').value = MEMBRETE.titulo
      ws.getCell('B2').font = { bold: true, size: 13 }
      ws.getCell('O1').value = 'Codigo: ' + MEMBRETE.codigo
      ws.getCell('O2').value = 'Version: ' + MEMBRETE.version
      ws.getCell('O3').value = 'Fecha: ' + MEMBRETE.fecha
      ws.getCell('O4').value = 'Pag: ' + MEMBRETE.pagina
      for (const f of [1, 2, 3, 4]) {
        ws.getCell(f, 15).font = { size: 9 }
        ws.getCell(f, 15).alignment = { vertical: 'middle', horizontal: 'left' }
      }
      for (const ref of ['B1', 'B2']) ws.getCell(ref).alignment = centro
      ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
      // Si algun dia se sube el logo a public/, se incrusta aqui y el texto
      // queda de respaldo debajo. exceljs acepta png/jpg en base64.
      try {
        const resp = await fetch('/logo-imecol.png')
        if (resp.ok) {
          const b64 = await resp.blob().then((bl) => new Promise<string>((res) => {
            const fr = new FileReader()
            fr.onload = () => res(String(fr.result).split(',')[1] ?? '')
            fr.readAsDataURL(bl)
          }))
          if (b64) {
            const idImg = wb.addImage({ base64: b64, extension: 'png' })
            // El logo va RECORTADO (404x80, proporcion 5:1). El original venia
            // cuadrado de 447x447 con la marca chiquita en medio de un mar de
            // blanco: dentro de la celda del membrete salia diminuta.
            //
            // 112x22 respeta esa proporcion y cabe en la columna de 18 de ancho
            // (~126 px). El `row: 1.5` lo baja media celda para que quede
            // centrado en el alto de las cuatro filas, no pegado arriba.
            ws.addImage(idImg, { tl: { col: 0.08, row: 1.5 }, ext: { width: 112, height: 22 } })
            for (const f of [1, 2, 3, 4]) ws.getRow(f).height = 18
            ws.getCell('A1').value = ''
          }
        }
      } catch { /* sin logo se queda el texto, que ya dice IMECOL */ }
      for (let f = 1; f <= 4; f += 1) {
        for (let c = 1; c <= 16; c += 1) ws.getCell(f, c).border = marco
      }

      const CAB = ['FECHA', 'TIPO SERVICIO', 'CENTRO DE COSTO', 'PROCESO SOLICITANTE',
        'NOMBRE DEL PASAJERO', 'ORIGEN', 'DESTINO', 'HORA SALIDA ORIGEN', 'HORA LLEGADA DESTINO',
        'HORA SALIDA DESTINO', 'HORA LLEGADA ORIGEN', 'HORA DE ESPERA', '# PEAJES',
        'OTROS GASTOS', 'TOTAL KM', 'OBSERVACION']
      const filaCab = 6
      ws.getRow(filaCab).height = 34
      CAB.forEach((txt, i) => {
        const cel = ws.getCell(filaCab, i + 1)
        cel.value = txt
        cel.font = { bold: true, size: 8 }
        cel.alignment = centro
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9F3ED' } }
        cel.border = marco
      })

      const enOrden = [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha))
      enOrden.forEach((s, i) => {
        const f = filaCab + 1 + i
        const valores = [
          fmtFecha(s.fecha), s.tipoServicio ?? '', s.centroCosto ?? '', s.procesoSolicitante ?? '',
          s.nombrePasajero ?? '', s.origen ?? '', s.destino ?? '',
          s.horaSalidaOrigen ?? '', s.horaLlegadaDestino ?? '', s.horaSalidaDestino ?? '',
          s.horaLlegadaOrigen ?? '', s.horaEspera ?? '',
          // Cero peajes es casilla VACIA: un 0 impreso se lee como dato contado.
          s.numPeajes || '', s.otrosGastos || '', s.totalKm ?? 0, s.observacion ?? '',
        ]
        valores.forEach((v, c) => {
          const cel = ws.getCell(f, c + 1)
          cel.value = v as string | number
          cel.font = { size: 9 }
          cel.border = marco
          cel.alignment = {
            vertical: 'middle',
            wrapText: c === 15,
            horizontal: c >= 7 && c <= 14 ? 'center' : 'left',
          }
        })
      })

      // Filas vacias hasta completar el alto del formato, para que la cuadricula
      // se vea igual aunque el rango tenga pocos viajes.
      const MINIMO = 18
      for (let i = lista.length; i < MINIMO; i += 1) {
        const f = filaCab + 1 + i
        for (let c = 1; c <= 16; c += 1) ws.getCell(f, c).border = marco
      }

      const filaTotal = filaCab + 1 + Math.max(lista.length, MINIMO)
      ws.getCell(filaTotal, 14).value = 'TOTAL'
      ws.getCell(filaTotal, 14).font = { bold: true, size: 9 }
      ws.getCell(filaTotal, 14).alignment = { horizontal: 'right' }
      ws.getCell(filaTotal, 14).border = marco
      ws.getCell(filaTotal, 15).value = lista.reduce((a, s) => a + (s.totalKm ?? 0), 0)
      ws.getCell(filaTotal, 15).font = { bold: true, size: 10 }
      ws.getCell(filaTotal, 15).alignment = centro
      ws.getCell(filaTotal, 15).border = marco

      const filaObs = filaTotal + 2
      ws.mergeCells(filaObs, 1, filaObs + 1, 16)
      const obs = ws.getCell(filaObs, 1)
      obs.value = 'OBSERVACION: ' + lista.map((s) => s.observacion).filter(Boolean).join(' - ')
      obs.font = { size: 9 }
      obs.alignment = { vertical: 'top', wrapText: true }
      obs.border = marco

      // Segunda hoja: lo que el papel no tiene pero el sistema si guarda.
      const ws2 = wb.addWorksheet('Respaldo')
      ws2.columns = [
        { header: 'FECHA', key: 'f', width: 12 }, { header: 'ORIGEN', key: 'o', width: 16 },
        { header: 'DESTINO', key: 'd', width: 16 }, { header: 'VEHICULO', key: 'v', width: 12 },
        { header: 'CONDUCTOR', key: 'c', width: 26 }, { header: 'FIRMA (quien)', key: 'fq', width: 22 },
        { header: 'FIRMA (url)', key: 'fu', width: 40 }, { header: 'EVIDENCIA (url)', key: 'eu', width: 40 },
        { header: 'ESTADO', key: 'e', width: 12 },
      ]
      ws2.getRow(1).font = { bold: true }
      enOrden.forEach((s) => ws2.addRow({
        f: fmtFecha(s.fecha), o: s.origen ?? '', d: s.destino ?? '', v: s.vehiculo ?? '',
        c: s.conductorNombre ?? '', fq: s.firmaNombre ?? '', fu: s.firmaUrl ?? '',
        eu: s.evidenciaUrl ?? '', e: s.estado,
      }))

      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'CDA-F-68-' + desde + '-a-' + hasta + '.xlsx'
      a.click()
      // Sin esto el navegador retiene el archivo completo en memoria.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setInfo(`Exportado: ${lista.length} servicios.`)
    } catch {
      setError('No se pudo generar el Excel.')
    } finally { setBusy(false) }
  }

  async function anular(s: FlotaServicio) {
    if (!window.confirm(`¿Anular el servicio ${s.origen} → ${s.destino} del ${fmtFecha(s.fecha)}?`)) return
    setBusy(true); setError('')
    try {
      await anularFlotaServicio(s.id)
      setInfo('Servicio anulado.')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo anular. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>{esAdmin ? 'Flota / Escolta' : 'Mis servicios'}</h2>
        <button type="button" className="primary-button" onClick={() => setFormOpen(true)} disabled={busy}>+ Nuevo servicio</button>
      </div>
      <Ayuda>
        <p>Control de transporte de flota no propia (CDA-F-68). Cada servicio lleva su firma y foto de evidencia.</p>
      </Ayuda>

      <div className="rep-toolbar">
        <label className="rep-fecha">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="rep-fecha">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        {/* El conductor tambien descarga: es EL que entrega la planilla, y
            pedirle que le escriba a administracion para que se la manden es
            ponerle un intermediario a su propio trabajo. Solo ve los suyos,
            porque `conductorScope` ya acota la consulta. */}
        <button type="button" className="primary-button rep-export" onClick={() => void exportarExcel()} disabled={busy || loading || lista.length === 0}>
          ⬇ Excel (CDA-F-68)
        </button>
      </div>
      <input type="search" className="labores-search-input" placeholder="Buscar origen, destino, pasajero, placa…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ margin: '12px 0' }} />

      {loading ? (
        <p className="muted-text">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="muted-text">Sin servicios en este rango. Registra el primero con “+ Nuevo servicio”.</p>
      ) : (
        <div className="list-rows">
          {lista.map((s) => (
            <article key={s.id} className={`flota-card${s.estado === 'ANULADO' ? ' flota-card--anulado' : ''}`}>
              <div className="flota-card__head">
                <strong>{s.origen} → {s.destino}</strong>
                <span className="flota-card__fecha">{fmtFecha(s.fecha)}{s.tipoServicio ? ` · ${s.tipoServicio}` : ''}</span>
              </div>
              <div className="flota-card__meta">
                {s.nombrePasajero && <span>👤 {s.nombrePasajero}</span>}
                {s.vehiculo && <span>🚙 {s.vehiculo}</span>}
                {s.horaSalidaOrigen && <span>🕐 {s.horaSalidaOrigen}{s.horaLlegadaOrigen ? `–${s.horaLlegadaOrigen}` : ''}</span>}
                {s.totalKm ? <span>📍 {s.totalKm} km</span> : null}
                {esAdmin && s.conductorNombre && <span>🧑‍✈️ {s.conductorNombre}</span>}
                {s.estado === 'ANULADO' && <span className="flota-anulado-badge">ANULADO</span>}
              </div>
              {(s.firmaUrl || s.evidenciaUrl || s.firmaNombre) && (
                <div className="flota-card__comp">
                  {s.evidenciaUrl && <button type="button" className="flota-thumb-btn" onClick={() => setVerFotoUrl(s.evidenciaUrl!)}>📷 Evidencia</button>}
                  {s.firmaUrl && <button type="button" className="flota-thumb-btn" onClick={() => setVerFotoUrl(s.firmaUrl!)}>✍️ Firma{s.firmaNombre ? ` · ${s.firmaNombre}` : ''}</button>}
                </div>
              )}
              {esAdmin && s.estado !== 'ANULADO' && (
                <div className="flota-card__actions">
                  <button type="button" className="inline-button maestro-delete-btn" onClick={() => void anular(s)} disabled={busy}>Anular</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <FlotaForm
          onClose={() => setFormOpen(false)}
          onSaved={() => void refresh()}
          conductorId={conductorScope?.id}
          conductorNombre={conductorScope?.nombre}
        />
      )}

      {verFotoUrl && (
        <div className="modal-overlay open" onClick={() => setVerFotoUrl('')}>
          <img src={verFotoUrl} alt="comprobante" className="flota-foto-full" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </section>
  )
}

export default FlotaTab
