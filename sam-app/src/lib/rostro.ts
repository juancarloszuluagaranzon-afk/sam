/**
 * Reconocimiento facial EN EL CELULAR del mecánico (18-sep-2026).
 *
 * Porte de AgroControl (`AgroCampo/src/jornales/lib/rostro.ts`, CONTRATO 3/4),
 * donde ya se probó con caras reales. Pedido del cliente: «quiero algo que sea
 * con la cara, ya que los dedos normalmente están sucios».
 *
 * Motor: face-api (@vladmandic, MIT) con el modelo de identificación dlib
 * ResNet-34 (99,38 % en LFW). Convierte una cara en 128 números; dos caras son
 * la misma persona si la distancia entre sus números es pequeña. Los modelos
 * (~7 MB) se sirven desde /models/faceapi y los baja SOLO quien abre la cámara:
 * no van en el precache de la PWA, que lo descargan los 50 usuarios.
 *
 * 🔴 El celular NO decide. Aquí solo se saca el descriptor y se hace la prueba
 * de vida; la comparación contra la plantilla la hace el SERVIDOR
 * (`taller_marcar`), que es el único que tiene las plantillas. Un celular no
 * puede decidir que la cara es la suya.
 *
 * 🔴 Qué NO es: no es un sistema certificado contra suplantación. La prueba de
 * vida (parpadeo + giro) derrota una foto impresa o en pantalla quieta; un video
 * bien hecho podría pasarla. Por eso cada marcación guarda la distancia, las
 * pruebas y una foto pequeña, y lo dudoso lo revisa el jefe.
 */

type FaceApi = typeof import('@vladmandic/face-api')

/** Umbrales de AgroControl (`shared/biometria.ts`). Los decide el servidor; aquí solo orientan. */
export const UMBRAL_VERIFICAR = 0.45
export const ZONA_GRIS = 0.52
/** Cara mínima en píxeles del video para que el descriptor sea confiable. */
export const MIN_CARA_PX = 110
/** Muestras al registrar la cara (el servidor exige de 5 a 10). */
export const MUESTRAS_ENROLAMIENTO = 5
/** Dos muestras casi idénticas son el mismo cuadro: no aportan variedad. */
export const DISTANCIA_REPETIDA = 0.06
/** Muestras demasiado distintas entre sí: pudo cambiar la persona a la mitad. */
export const MAX_DISPERSION_MUESTRAS = 0.6
// La autorización (texto y versión) NO vive aquí: la entrega el servidor
// (`taller_consentimiento_vigente`) y guarda la que se aceptó. Una sola fuente.

const RUTA_MODELOS = '/models/faceapi'
let motor: Promise<FaceApi> | null = null

/** Carga los tres modelos una sola vez por sesión. Si falla, se puede reintentar. */
export function cargarMotor(): Promise<FaceApi> {
  if (!motor) {
    motor = (async () => {
      const faceapi = await import('@vladmandic/face-api')
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(RUTA_MODELOS),
        faceapi.nets.faceLandmark68Net.loadFromUri(RUTA_MODELOS),
        faceapi.nets.faceRecognitionNet.loadFromUri(RUTA_MODELOS),
      ])
      return faceapi
    })().catch((e) => { motor = null; throw e })
  }
  return motor
}

export interface Punto { x: number; y: number }

export interface LecturaCara {
  /** Cuántas caras hay en el cuadro (se exige exactamente 1). */
  caras: number
  caja?: { x: number; y: number; w: number; h: number }
  confianza?: number
  /** Apertura de ojos (EAR): ~0,3 abiertos, < 0,2 cerrados. */
  ojos?: number
  /** Giro de la cabeza: 0 de frente; ± 0,25 girada a un lado. */
  giro?: number
  /** Solo si se pidió (`conDescriptor`): los 128 números. */
  descriptor?: number[]
}

const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y)

/** Eye Aspect Ratio de un ojo (6 puntos del modelo de 68). */
function ear(p: Punto[]): number {
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]) || 1)
}

/**
 * Lee un cuadro del video. Sin descriptor es rápido (sirve para la prueba de
 * vida en bucle); con descriptor cuesta más y se pide solo en cuadros buenos.
 */
export async function leerCara(video: HTMLVideoElement, conDescriptor = false): Promise<LecturaCara> {
  const faceapi = await cargarMotor()
  const opciones = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
  // Conteo, puntos y descriptor salen de la MISMA pasada: si se detectara dos
  // veces, entre una y otra podría entrar otra cara al cuadro.
  const base = faceapi.detectAllFaces(video, opciones).withFaceLandmarks()
  const detecciones = conDescriptor ? await base.withFaceDescriptors() : await base
  if (detecciones.length !== 1) return { caras: detecciones.length }
  const d = detecciones[0]
  const pts = d.landmarks.positions as Punto[]
  const ojos = (ear(pts.slice(36, 42)) + ear(pts.slice(42, 48))) / 2
  const medio = { x: (pts[36].x + pts[45].x) / 2, y: 0 }
  const giro = (pts[30].x - medio.x) / (dist(pts[36], pts[45]) || 1)
  const b = d.detection.box
  const lectura: LecturaCara = {
    caras: 1, caja: { x: b.x, y: b.y, w: b.width, h: b.height }, confianza: d.detection.score, ojos, giro,
  }
  if ('descriptor' in d) lectura.descriptor = Array.from(d.descriptor as Float32Array, (x) => Math.round(x * 1e5) / 1e5)
  return lectura
}

/** ¿Este cuadro sirve para sacar un descriptor confiable? `null` = sí. */
export function cuadroBueno(l: LecturaCara): string | null {
  if (l.caras === 0) return 'Acerca la cara a la cámara.'
  if (l.caras > 1) return 'Solo una persona frente a la cámara.'
  if ((l.caja?.w ?? 0) < MIN_CARA_PX) return 'Acércate un poco más.'
  if ((l.confianza ?? 0) < 0.7) return 'Busca luz: de frente, no a contraluz.'
  if (Math.abs(l.giro ?? 0) > 0.12) return 'Mira de frente a la cámara.'
  return null
}

export const distancia = (a: number[], b: number[]): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s)
}

/**
 * Las muestras del registro: ¿sirven? `null` = sí.
 * Repetidas (el mismo cuadro) no dan variedad; muy dispersas pueden ser dos
 * personas distintas turnándose frente a la cámara.
 */
export function problemaMuestras(muestras: number[][]): string | null {
  if (muestras.length < MUESTRAS_ENROLAMIENTO) return `Faltan muestras (${muestras.length} de ${MUESTRAS_ENROLAMIENTO}).`
  for (let i = 0; i < muestras.length; i++) {
    for (let j = i + 1; j < muestras.length; j++) {
      const d = distancia(muestras[i], muestras[j])
      if (d > MAX_DISPERSION_MUESTRAS) return 'Las fotos no parecen de la misma persona. Repite, solo tú frente a la cámara.'
    }
  }
  return null
}

/** ¿Esta muestra es casi igual a alguna ya tomada? */
export function esRepetida(nueva: number[], muestras: number[][]): boolean {
  return muestras.some((m) => distancia(nueva, m) < DISTANCIA_REPETIDA)
}

/**
 * Prueba de vida: parpadear y girar la cabeza a un lado y volver.
 * Una foto impresa o en pantalla no parpadea ni cambia la perspectiva de la
 * nariz respecto de los ojos. Se alimenta con cada lectura del bucle.
 */
export class PruebaVida {
  private abiertos: number[] = []
  private cerro = false
  parpadeo = false
  private giroHecho = false
  giro = false

  actualizar(l: LecturaCara): void {
    if (l.caras !== 1 || l.ojos == null || l.giro == null) return
    const base = this.abiertos.length ? this.abiertos.reduce((a, b) => a + b, 0) / this.abiertos.length : l.ojos
    if (l.ojos > base * 0.9) { this.abiertos.push(l.ojos); if (this.abiertos.length > 15) this.abiertos.shift() }
    if (this.abiertos.length >= 3 && l.ojos < base * 0.72) this.cerro = true
    if (this.cerro && l.ojos > base * 0.88) this.parpadeo = true
    if (Math.abs(l.giro) > 0.22) this.giroHecho = true
    if (this.giroHecho && Math.abs(l.giro) < 0.1) this.giro = true
  }

  get completa(): boolean { return this.parpadeo && this.giro }
  get pruebas(): string { return [this.parpadeo && 'parpadeo', this.giro && 'giro'].filter(Boolean).join(',') }

  instruccion(): string {
    if (!this.parpadeo) return 'Parpadea despacio.'
    if (!this.giro) return 'Gira un poco la cabeza hacia un lado y vuelve al centro.'
    return 'Listo. Mira de frente.'
  }
}

/**
 * Foto pequeña de evidencia (96×120, JPEG): la cara recortada del cuadro. Es lo
 * que el jefe mira al revisar; pesa ~5–8 KB para que viaje aunque haya poca señal.
 */
export function fotoMini(video: HTMLVideoElement, caja?: { x: number; y: number; w: number; h: number }): string | null {
  const ancho = 96
  const alto = 120
  const c = document.createElement('canvas')
  c.width = ancho
  c.height = alto
  const ctx = c.getContext('2d')
  if (!ctx || !video.videoWidth) return null
  // Recorte con margen alrededor de la cara; sin caja, el centro del cuadro.
  const vw = video.videoWidth
  const vh = video.videoHeight
  let sx = 0; let sy = 0; let sw = vw; let sh = vh
  if (caja) {
    const m = 0.35
    sw = Math.min(vw, caja.w * (1 + 2 * m))
    sh = Math.min(vh, sw * (alto / ancho))
    sx = Math.max(0, Math.min(vw - sw, caja.x + caja.w / 2 - sw / 2))
    sy = Math.max(0, Math.min(vh - sh, caja.y + caja.h / 2 - sh / 2))
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, ancho, alto)
  // Como AgroControl (`camara.ts`): se arranca en 0,85 y se baja hasta que
  // quepa. El tope va en CARACTERES, igual que el que revisa el servidor
  // (16.000): allá un tope en KB de un lado y en caracteres del otro rechazaba
  // fotos en el borde.
  for (let q = 0.85; q >= 0.25; q -= 0.1) {
    const url = c.toDataURL('image/jpeg', Math.round(q * 100) / 100)
    if (url.length <= 14000) return url
  }
  return null
}
