// Genera los iconos PWA desde el logo de AgroMorales.
//   public/pwa-512x512.png          (any) logo al 90% sobre blanco
//   public/pwa-192x192.png          (any) idem 192
//   public/pwa-512x512-maskable.png logo al 72% (zona segura para el círculo)
// Fuente: src/assets/logo-agromorales.jpeg (fondo blanco, ~531x288).
// Correr: node scripts/build-app-icons.mjs
import { Jimp } from 'jimp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const logoPath = join(root, 'src', 'assets', 'logo-agromorales.jpeg')
const publicDir = join(root, 'public')

const WHITE = 0xffffffff

async function makeIcon(size, ratio, outName) {
  const logo = await Jimp.read(logoPath)
  const w0 = logo.bitmap.width
  const h0 = logo.bitmap.height
  // Encajar dentro de un cuadrado de lado size*ratio preservando proporción.
  const box = Math.round(size * ratio)
  let w = box
  let h = Math.round((box * h0) / w0)
  if (h > box) {
    h = box
    w = Math.round((box * w0) / h0)
  }
  logo.resize({ w, h })
  const canvas = new Jimp({ width: size, height: size, color: WHITE })
  canvas.composite(logo, Math.round((size - w) / 2), Math.round((size - h) / 2))
  const out = join(publicDir, outName)
  await canvas.write(out)
  console.log(`Wrote ${out} (${size}px, logo ${w}x${h})`)
}

await makeIcon(512, 0.9, 'pwa-512x512.png')
await makeIcon(192, 0.9, 'pwa-192x192.png')
await makeIcon(512, 0.72, 'pwa-512x512-maskable.png')
console.log('Done.')
