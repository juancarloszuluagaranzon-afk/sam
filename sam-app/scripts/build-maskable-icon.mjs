// Generates public/pwa-512x512-maskable.png from public/pwa-512x512.png.
// Android adaptive icons crop the outer ~20% of the canvas, so maskable
// assets need a safe zone: the logo lives in the center ~80% on a solid
// brand background. Run: node scripts/build-maskable-icon.mjs
import { Jimp } from 'jimp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'public')

const SIZE = 512
const SAFE_RATIO = 0.8 // logo occupies 80% of the canvas
const BG_HEX = 0x1a6b3aff // brand green (#1a6b3a)

const source = await Jimp.read(join(publicDir, 'pwa-512x512.png'))

const logoSize = Math.round(SIZE * SAFE_RATIO)
source.resize({ w: logoSize, h: logoSize })

const canvas = new Jimp({ width: SIZE, height: SIZE, color: BG_HEX })
const offset = Math.round((SIZE - logoSize) / 2)
canvas.composite(source, offset, offset)

const outPath = join(publicDir, 'pwa-512x512-maskable.png')
await canvas.write(outPath)
console.log(`Wrote ${outPath}`)
