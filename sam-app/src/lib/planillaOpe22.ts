import type { FlotaServicio, UserProfile } from '../domain/sam'

/**
 * Planilla **F-OPE-22 · GESTIÓN OPERATIVA** de AgroMorales.
 *
 * Es un formato DISTINTO al CDA-F-68 de IMECOL, no una variante: mismo servicio,
 * dos documentos con columnas propias. El de IMECOL pide centro de costo, peajes
 * y otros gastos; este pide el **número de la maquinaria** escoltada, el
 * **kilometraje inicial y final** y la **firma del responsable** que recibió el
 * servicio. Ninguno manda sobre el otro y por eso se guardan todos los campos:
 * cada exportación toma los suyos.
 *
 * 🔴 **Una hoja por conductor y placa.** El encabezado del papel lleva UN
 * nombre, UNA cédula y UNA placa, así que una sola hoja con los servicios de
 * dos conductores tendría un encabezado que le miente a la mitad de sus propias
 * filas. Si el rango trae tres conductores, salen tres hojas.
 *
 * ⚠️ Va con `exceljs` y no con `xlsx`: la versión comunitaria de `xlsx` **no
 * escribe estilos** —probado— y esta planilla se imprime y se firma. Entra por
 * `import()` desde la pantalla para no engordar el arranque.
 */

const MEMBRETE = {
  titulo: 'GESTION OPERATIVA',
  codigo: 'F-OPE-22',
  version: '1',
  fecha: '1/08/2022',
  pagina: '1/1',
}

/** Las 14 columnas del formato, en su orden. */
const CAB = [
  'Fecha\ndd-mm-año', 'TIPO DE\nSERVICIO', 'NUMERO\nMAQUINARIA', 'LUGAR DE\nINICIO',
  'LUGAR\nDESTINO', 'HORA DE\nINICIO', 'HORA\nFINAL', 'TIEMPO DE\nESPERA',
  'KM\nINICIAL', 'KM\nFINAL', 'KM\nTOTAL', 'N°\nSERVICIO', 'OBSERVACION', 'FIRMA\nRESPONSABLE',
]
const ANCHOS = [11, 13, 12, 15, 15, 9, 9, 10, 10, 10, 9, 9, 20, 20]

/** Filas mínimas para que la cuadrícula se vea igual con pocos servicios. */
const MINIMO = 12

/** 26/08/2026 (el formato pide dd-mm-año). */
function fmtDia(iso: string): string {
  const [a, m, d] = iso.split('-')
  return d && m && a ? `${d}-${m}-${a}` : iso
}

/**
 * Semana ISO de una fecha. El encabezado tiene casilla de SEMANA y en el papel
 * se escribe a mano; aquí sale calculada para que no dependa de acordarse.
 */
export function semanaISO(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d))
  // Al jueves de esa semana: es el día que define a qué año ISO pertenece.
  f.setUTCDate(f.getUTCDate() + 4 - (f.getUTCDay() || 7))
  const ene1 = new Date(Date.UTC(f.getUTCFullYear(), 0, 1))
  return Math.ceil(((f.getTime() - ene1.getTime()) / 86400000 + 1) / 7)
}

/**
 * Los km del servicio para la columna KM TOTAL.
 *
 * 🔴 Devuelve `''` y no `0` cuando no hay con qué calcularlo. En el papel esa
 * casilla va en blanco si no se anotó el odómetro, y **un 0 impreso se lee como
 * «este servicio no recorrió nada»** — que es una afirmación, no una ausencia.
 * Misma regla que los peajes en el CDA-F-68.
 */
export function kmTotal(s: FlotaServicio): number | '' {
  if (s.kmInicial != null && s.kmFinal != null) return Math.round((s.kmFinal - s.kmInicial) * 100) / 100
  return s.totalKm ?? ''
}

/** Agrupa por conductor + placa: es lo que define una hoja del formato. */
export function porConductorYPlaca(lista: FlotaServicio[]): Map<string, FlotaServicio[]> {
  const grupos = new Map<string, FlotaServicio[]>()
  for (const s of lista) {
    const llave = `${s.conductorId ?? ''}||${s.vehiculo ?? ''}`
    const g = grupos.get(llave)
    if (g) g.push(s)
    else grupos.set(llave, [s])
  }
  return grupos
}

export async function exportarOpe22(
  lista: FlotaServicio[],
  users: UserProfile[],
  rango: { desde: string; hasta: string },
): Promise<number> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()

  const linea = { style: 'thin' as const, color: { argb: 'FF000000' } }
  const marco = { top: linea, left: linea, bottom: linea, right: linea }
  const centro = { vertical: 'middle' as const, horizontal: 'center' as const, wrapText: true }

  // El logo se lee UNA vez y se reusa en todas las hojas: leerlo por hoja
  // dispararía una petición por conductor sin ganar nada.
  let logo64 = ''
  try {
    const resp = await fetch('/logo-agromorales.png')
    if (resp.ok) {
      logo64 = await resp.blob().then((bl) => new Promise<string>((res) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result).split(',')[1] ?? '')
        fr.readAsDataURL(bl)
      }))
    }
  } catch { /* sin logo queda el texto: que falte una imagen no tumba la descarga */ }

  const grupos = porConductorYPlaca(lista)
  let n = 0

  for (const [, servicios] of grupos) {
    const enOrden = [...servicios].sort((a, b) => a.fecha.localeCompare(b.fecha))
    const primero = enOrden[0]
    const conductor = users.find((u) => u.id === primero.conductorId)
    const nombre = primero.conductorNombre || conductor?.name || ''
    const placa = primero.vehiculo || ''

    // El nombre de la pestaña no admite : \ / ? * [ ] y tope de 31.
    const rotulo = `${placa || 'SIN PLACA'} ${nombre}`.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
    const ws = wb.addWorksheet(rotulo || `Hoja ${n + 1}`, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    ws.columns = ANCHOS.map((w) => ({ width: w }))
    const ULT = ANCHOS.length

    // ── Membrete: logo · título · códigos ─────────────────────────────────
    ws.mergeCells(1, 1, 3, 2)
    ws.mergeCells(1, 3, 3, 9)
    ws.mergeCells(1, 10, 1, 12)
    ws.mergeCells(2, 10, 3, 12)
    ws.mergeCells(1, 13, 1, ULT)
    ws.mergeCells(2, 13, 3, ULT)

    ws.getCell(1, 1).value = logo64 ? '' : 'AgroMorales'
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF1B7A3D' } }
    ws.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'center' }
    ws.getCell(1, 3).value = MEMBRETE.titulo
    ws.getCell(1, 3).font = { bold: true, size: 14 }
    ws.getCell(1, 3).alignment = centro
    ws.getCell(1, 10).value = 'VERSION  ' + MEMBRETE.version
    ws.getCell(2, 10).value = 'FECHA\n' + MEMBRETE.fecha
    ws.getCell(1, 13).value = MEMBRETE.codigo
    ws.getCell(2, 13).value = 'PAGINA\n' + MEMBRETE.pagina
    for (const [f, c] of [[1, 10], [2, 10], [1, 13], [2, 13]] as const) {
      ws.getCell(f, c).font = { size: 9 }
      ws.getCell(f, c).alignment = centro
    }
    for (let f = 1; f <= 3; f += 1) {
      ws.getRow(f).height = 18
      for (let c = 1; c <= ULT; c += 1) ws.getCell(f, c).border = marco
    }
    if (logo64) {
      const id = wb.addImage({ base64: logo64, extension: 'png' })
      // 481x246 recortado ≈ 2:1. 120x58 respeta la proporción y cabe en las
      // dos columnas de ancho 11+13 (~168 px) por tres filas de 18.
      ws.addImage(id, { tl: { col: 0.15, row: 0.35 }, ext: { width: 120, height: 58 } })
    }

    // ── Encabezado de la planilla ─────────────────────────────────────────
    const dias = enOrden.map((s) => s.fecha)
    const unSoloDia = dias[0] === dias[dias.length - 1]
    const semanas = [...new Set(dias.map(semanaISO))]

    const enc: [string, string][][] = [
      [['FECHA:', unSoloDia ? fmtDia(dias[0]) : `${fmtDia(dias[0])} a ${fmtDia(dias[dias.length - 1])}`],
       ['PLACA:', placa]],
      [['NOMBRES APELLIDOS:', nombre],
       ['CEDULA:', conductor?.cedula ?? ''],
       ['SEMANA:', semanas.join(', ')]],
    ]
    enc.forEach((pares, i) => {
      const f = 4 + i
      ws.getRow(f).height = 20
      // Cada par ocupa un tramo de la fila; el reparto sigue al papel.
      const tramos = pares.length === 2 ? [[1, 5], [6, ULT]] : [[1, 5], [6, 10], [11, ULT]]
      pares.forEach(([rot, val], j) => {
        const [ci, cf] = tramos[j]
        ws.mergeCells(f, ci, f, cf)
        const cel = ws.getCell(f, ci)
        cel.value = { richText: [
          { text: rot + ' ', font: { bold: true, size: 10 } },
          { text: val, font: { size: 10 } },
        ] }
        cel.alignment = { vertical: 'middle', horizontal: 'left' }
        cel.border = marco
      })
    })

    // ── Encabezado de la tabla ────────────────────────────────────────────
    const filaCab = 7
    ws.getRow(filaCab).height = 32
    CAB.forEach((txt, i) => {
      const cel = ws.getCell(filaCab, i + 1)
      cel.value = txt
      cel.font = { bold: true, size: 8 }
      cel.alignment = centro
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } }
      cel.border = marco
    })

    // ── Las filas ─────────────────────────────────────────────────────────
    enOrden.forEach((s, i) => {
      const f = filaCab + 1 + i
      ws.getRow(f).height = 22
      const valores: (string | number)[] = [
        fmtDia(s.fecha),
        s.tipoServicio ?? '',
        s.numeroMaquinaria ?? '',
        s.origen ?? '',
        s.destino ?? '',
        s.horaSalidaOrigen ?? '',
        s.horaLlegadaDestino ?? '',
        s.horaEspera ?? '',
        // Sin lectura la casilla va VACIA, no en cero: no haber anotado el
        // odometro no es lo mismo que haber arrancado en el kilometro cero.
        s.kmInicial ?? '',
        s.kmFinal ?? '',
        kmTotal(s),
        s.numeroServicio ?? '',
        s.observacion ?? '',
        // La firma va escaneada en el respaldo; en el papel se firma a mano y
        // aqui queda QUIEN recibio, que es lo que se puede verificar.
        s.firmaNombre ?? '',
      ]
      valores.forEach((v, c) => {
        const cel = ws.getCell(f, c + 1)
        cel.value = v
        cel.font = { size: 9 }
        cel.border = marco
        cel.alignment = {
          vertical: 'middle',
          wrapText: c === 12 || c === 13,
          horizontal: c >= 5 && c <= 11 ? 'center' : 'left',
        }
      })
    })

    for (let i = enOrden.length; i < MINIMO; i += 1) {
      const f = filaCab + 1 + i
      ws.getRow(f).height = 22
      for (let c = 1; c <= ULT; c += 1) ws.getCell(f, c).border = marco
    }

    // ── Pie del formato ───────────────────────────────────────────────────
    const base = filaCab + 1 + Math.max(enOrden.length, MINIMO)
    const conKm = enOrden.reduce((a, s) => {
      const k = kmTotal(s)
      return a + (typeof k === 'number' ? k : 0)
    }, 0)
    const pie: [string, string][] = [
      ['TIPO DE SERVICIO:', 'TRANSPORTE PERSONAL - ESCOLTAS - TALLER'],
      ['N° SERVICIOS:', String(enOrden.length)],
      ['HORA:', '0 - 24 HORAS'],
      // El total de km SI conserva el cero: ahi el cero si dice algo.
      ['TOTAL KM:', String(conKm)],
      ['OBSERVACIONES:', ''],
    ]
    pie.forEach(([rot, val], i) => {
      const f = base + i
      ws.mergeCells(f, 1, f, ULT)
      const cel = ws.getCell(f, 1)
      cel.value = { richText: [
        { text: rot + ' ', font: { bold: true, size: 9 } },
        { text: val, font: { size: 9 } },
      ] }
      cel.alignment = { vertical: 'middle', horizontal: 'left' }
      cel.border = marco
      ws.getRow(f).height = 18
    })

    n += 1
  }

  const buffer = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const a = document.createElement('a')
  a.href = url
  a.download = `F-OPE-22-${rango.desde}-a-${rango.hasta}.xlsx`
  a.click()
  // Sin esto el navegador retiene el archivo completo en memoria.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return n
}
