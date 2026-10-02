import { comprimirImagen } from './imagenLigera'

/**
 * Documentos LIVIANOS para facturación (2-oct-2026, pedido de Cristhian): el
 * soporte y la factura se reducen EN EL EQUIPO antes de subirlos, para no llenar
 * el servidor.
 *
 *  - Foto (JPG/PNG/WEBP): `comprimirImagen` con un perfil legible para documentos.
 *  - PDF de más de 300 KB (casi siempre un escaneo): cada página se vuelve a
 *    dibujar a ~110 ppp y se guarda como JPEG; con eso se arma un PDF nuevo del
 *    mismo tamaño de hoja. Si no queda más liviano, se sube el original.
 *  - PDF pequeño (la factura electrónica de Siigo pesa ~100 KB y es texto): igual.
 *
 * Las librerías (pdf.js para leer, pdf-lib para armar) se cargan del CDN SOLO al
 * subir un documento: no entran a la app ni al modo sin señal de los operarios
 * (regla del repo: nada de chunks nuevos en el paquete). Si el CDN no responde,
 * se sube el original y se avisa.
 */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs'
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'
const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'

const UMBRAL = 300 * 1024
const ANCHO_PX = 1280 // ≈ 110 ppp en carta: se lee bien, pesa poco
const CALIDAD = 0.62
const MAX_PAGINAS = 40

export interface ArchivoLigero {
  archivo: File
  antes: number
  despues: number
  /** Qué pasó, para mostrarlo («PDF reducido de 4,2 MB a 380 KB»). */
  nota: string | null
}

export const pesoLegible = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<{
    numPages: number
    getPage: (n: number) => Promise<{
      getViewport: (o: { scale: number }) => { width: number; height: number }
      render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
    }>
  }> }
}
type PdfLib = {
  PDFDocument: { create: () => Promise<{
    embedJpg: (b: ArrayBuffer) => Promise<unknown>
    addPage: (s: [number, number]) => { drawImage: (img: unknown, o: { x: number; y: number; width: number; height: number }) => void }
    save: () => Promise<Uint8Array>
  }> }
}

let pdfjs: Promise<PdfJs> | null = null
let pdflib: Promise<PdfLib> | null = null

function cargarPdfJs(): Promise<PdfJs> {
  pdfjs ??= (import(/* @vite-ignore */ PDFJS) as Promise<PdfJs>).then((m) => {
    m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
    return m
  })
  return pdfjs
}

function cargarPdfLib(): Promise<PdfLib> {
  const w = window as unknown as { PDFLib?: PdfLib }
  if (w.PDFLib) return Promise.resolve(w.PDFLib)
  pdflib ??= new Promise<PdfLib>((ok, mal) => {
    const s = document.createElement('script')
    s.src = PDFLIB
    s.onload = () => (w.PDFLib ? ok(w.PDFLib) : mal(new Error('pdf-lib no cargó')))
    s.onerror = () => { pdflib = null; mal(new Error('pdf-lib no cargó')) }
    document.head.appendChild(s)
  })
  return pdflib
}

async function reducirPdf(file: File): Promise<File> {
  const [lector, armador] = await Promise.all([cargarPdfJs(), cargarPdfLib()])
  const doc = await lector.getDocument({ data: await file.arrayBuffer() }).promise
  if (doc.numPages > MAX_PAGINAS) return file
  const nuevo = await armador.PDFDocument.create()
  const lienzo = document.createElement('canvas')
  const ctx = lienzo.getContext('2d')
  if (!ctx) return file
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n)
    const base = pagina.getViewport({ scale: 1 }) // en puntos (1/72")
    const escala = ANCHO_PX / base.width
    const vista = pagina.getViewport({ scale: escala })
    lienzo.width = Math.round(vista.width)
    lienzo.height = Math.round(vista.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, lienzo.width, lienzo.height)
    await pagina.render({ canvasContext: ctx, viewport: vista }).promise
    const jpg = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', CALIDAD))
    if (!jpg) return file
    const img = await nuevo.embedJpg(await jpg.arrayBuffer())
    nuevo.addPage([base.width, base.height]).drawImage(img, { x: 0, y: 0, width: base.width, height: base.height })
  }
  const bytes = await nuevo.save()
  return new File([bytes as BlobPart], file.name, { type: 'application/pdf', lastModified: Date.now() })
}

/** Deja el archivo liviano antes de subirlo. Nunca falla: si algo sale mal, devuelve el original. */
export async function aligerarDocumento(file: File): Promise<ArchivoLigero> {
  const antes = file.size
  try {
    if (file.type.startsWith('image/')) {
      const f = await comprimirImagen(file, { maxLado: 1600, calidad: 0.6 })
      return { archivo: f, antes, despues: f.size, nota: f.size < antes ? `Foto reducida de ${pesoLegible(antes)} a ${pesoLegible(f.size)}` : null }
    }
    if (file.type === 'application/pdf' && file.size > UMBRAL) {
      const f = await reducirPdf(file)
      if (f.size < antes * 0.9) return { archivo: f, antes, despues: f.size, nota: `PDF reducido de ${pesoLegible(antes)} a ${pesoLegible(f.size)}` }
      return { archivo: file, antes, despues: antes, nota: null }
    }
    return { archivo: file, antes, despues: antes, nota: null }
  } catch {
    return { archivo: file, antes, despues: antes, nota: `No se pudo reducir: se sube el original (${pesoLegible(antes)})` }
  }
}
