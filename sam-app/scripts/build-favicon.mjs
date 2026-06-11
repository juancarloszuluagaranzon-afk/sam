// Genera public/favicon.png recortando solo el EMBLEMA del logo (sol + tractor
// + caña, sin el texto "AgroMorales"), para que se vea nítido en el tamaño
// chico de la pestaña del navegador. El logo completo se sigue usando en los
// iconos grandes (PWA / splash). Correr: node scripts/build-favicon.mjs
import { Jimp } from 'jimp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const logoPath = join(root, 'src', 'assets', 'logo-agromorales.jpeg')
const publicDir = join(root, 'public')

const WHITE = 0xffffffff
const SIZE = 256
const RATIO = 0.96 // el emblema llena casi todo el cuadrado

// Recorte CUADRADO enfocado en el tractor + sol (logo ~531x288), para que el
// icono se vea grande/nítido en la pestaña. Excluye el texto y la caña.
const CROP = { xPct: 0.30, yPct: 0.10, wPct: 0.36, hPct: 0.59 }

const logo = await Jimp.read(logoPath)
const W = logo.bitmap.width
const H = logo.bitmap.height
logo.crop({
  x: Math.round(W * CROP.xPct),
  y: Math.round(H * CROP.yPct),
  w: Math.round(W * CROP.wPct),
  h: Math.round(H * CROP.hPct),
})

const cw = logo.bitmap.width
const ch = logo.bitmap.height
const box = Math.round(SIZE * RATIO)
let w = box
let h = Math.round((box * ch) / cw)
if (h > box) { h = box; w = Math.round((box * cw) / ch) }
logo.resize({ w, h })

const canvas = new Jimp({ width: SIZE, height: SIZE, color: WHITE })
canvas.composite(logo, Math.round((SIZE - w) / 2), Math.round((SIZE - h) / 2))
const out = join(publicDir, 'favicon.png')
await canvas.write(out)
console.log(`Wrote ${out} (emblema ${cw}x${ch} -> ${w}x${h} en ${SIZE}px)`)
