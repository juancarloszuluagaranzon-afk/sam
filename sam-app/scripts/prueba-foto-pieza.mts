import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { escalarA, PERFIL_PIEZA, rutaFotoPieza, sha256Hex } from '../src/lib/fotoPieza.ts'

/**
 * Pruebas de la lógica pura de la foto de una pieza del taller (26-oct-2026).
 *
 * Se corren desde `sam-app/` con:
 *
 *   node scripts/prueba-foto-pieza.mts
 *
 * No tocan la base de datos, ni la red, ni ningún archivo de `src/`: solo importan
 * las funciones puras de `src/lib/fotoPieza.ts`. `prepararFotoPieza` NO se prueba
 * aquí porque necesita el navegador (canvas, ImageBitmap); lo que sí se puede
 * comprobar sin pantalla es la ruta en el depósito, el hash y el escalado.
 */

let casos = 0
let fallados = 0

/**
 * Corre un caso y lo reporta. No se detiene en el primer fallo: si el código
 * tiene un error, conviene ver de una todos los casos que se caen.
 */
async function caso(nombre: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`✓ ${nombre}`)
    casos += 1
  } catch (e) {
    fallados += 1
    const detalle = e instanceof Error ? e.message : String(e)
    console.log(`✗ ${nombre}`)
    console.log(detalle.split('\n').map((l) => `    ${l}`).join('\n'))
  }
}

/* ─────────────────────────── Ayudas de las pruebas ─────────────────────────── */

/** SHA-256 conocido de «abc»: sirve además como hash válido de 64 caracteres. */
const HASH_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
/** SHA-256 conocido de cero bytes. */
const HASH_VACIO = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const HEX64 = /^[0-9a-f]{64}$/

/** Los bytes de un texto como ArrayBuffer, que es lo que come `sha256Hex`. */
const bytes = (texto: string) => new TextEncoder().encode(texto).buffer as ArrayBuffer

/* ──────────────────────────── rutaFotoPieza ──────────────────────────────── */

await caso('1. hash válido + thumb + webp → repuestos/<2 primeros>/<hash>_thumb.webp', () => {
  assert.equal(rutaFotoPieza(HASH_ABC, 'thumb', 'webp'), `repuestos/ba/${HASH_ABC}_thumb.webp`)
})

await caso('2. hash válido + full + jpg → repuestos/<2 primeros>/<hash>_full.jpg', () => {
  assert.equal(rutaFotoPieza(HASH_ABC, 'full', 'jpg'), `repuestos/ba/${HASH_ABC}_full.jpg`)
})

await caso('3. las cuatro combinaciones de variante y extensión arman la ruta completa', () => {
  const variantes = ['thumb', 'full'] as const
  const extensiones = ['webp', 'jpg'] as const
  for (const variante of variantes) {
    for (const ext of extensiones) {
      assert.equal(
        rutaFotoPieza(HASH_ABC, variante, ext),
        `repuestos/ba/${HASH_ABC}_${variante}.${ext}`,
        `falló con ${variante}/${ext}`,
      )
    }
  }
})

await caso('4. la carpeta son los DOS primeros caracteres del hash, no los del final', () => {
  assert.equal(rutaFotoPieza(HASH_VACIO, 'thumb', 'webp'), `repuestos/e3/${HASH_VACIO}_thumb.webp`)
  // Un hash que empieza en «0» también es válido; su carpeta es «0a» (los dos primeros).
  const conCero = `0${HASH_ABC.slice(1)}`
  assert.equal(conCero.slice(0, 2), '0a')
  assert.equal(rutaFotoPieza(conCero, 'full', 'jpg'), `repuestos/0a/${conCero}_full.jpg`)
})

await caso('5. hash de 63 caracteres lanza «Hash de foto inválido»', () => {
  assert.throws(() => rutaFotoPieza(HASH_ABC.slice(0, 63), 'thumb', 'webp'), /Hash de foto inválido/)
})

await caso('6. hash de 65 caracteres lanza «Hash de foto inválido»', () => {
  assert.throws(() => rutaFotoPieza(`${HASH_ABC}a`, 'thumb', 'webp'), /Hash de foto inválido/)
})

await caso('7. hash en MAYÚSCULA lanza (la ruta solo acepta minúscula)', () => {
  assert.throws(() => rutaFotoPieza(HASH_ABC.toUpperCase(), 'thumb', 'webp'), /Hash de foto inválido/)
})

await caso('8. letras que no son hexadecimales (g, z, x) lanzan', () => {
  assert.throws(() => rutaFotoPieza('g'.repeat(64), 'thumb', 'webp'), /Hash de foto inválido/)
  assert.throws(() => rutaFotoPieza(`z${HASH_ABC.slice(1)}`, 'thumb', 'webp'), /Hash de foto inválido/)
  assert.throws(() => rutaFotoPieza(`x${HASH_ABC.slice(1)}`, 'full', 'jpg'), /Hash de foto inválido/)
})

await caso('9. hash vacío lanza', () => {
  assert.throws(() => rutaFotoPieza('', 'thumb', 'webp'), /Hash de foto inválido/)
})

await caso('10. 64 caracteres con espacio, guion o barra lanzan (longitud correcta, contenido inválido)', () => {
  assert.throws(() => rutaFotoPieza(`${HASH_ABC.slice(0, 63)} `, 'thumb', 'webp'), /Hash de foto inválido/)
  assert.throws(() => rutaFotoPieza(`-${HASH_ABC.slice(1)}`, 'thumb', 'webp'), /Hash de foto inválido/)
  assert.throws(() => rutaFotoPieza(`${HASH_ABC.slice(0, 63)}/`, 'full', 'jpg'), /Hash de foto inválido/)
})

/* ─────────────────────────────── sha256Hex ───────────────────────────────── */

await caso('11. de cero bytes da el SHA-256 conocido de la cadena vacía', async () => {
  assert.equal(await sha256Hex(new ArrayBuffer(0)), HASH_VACIO)
})

await caso('12. de los bytes de «abc» da el SHA-256 conocido', async () => {
  assert.equal(await sha256Hex(bytes('abc')), HASH_ABC)
})

await caso('13. siempre devuelve 64 caracteres hexadecimales en minúscula', async () => {
  for (const texto of ['', 'a', 'abc', 'Hola, mundo', 'ñandú con tilde', 'x'.repeat(1000)]) {
    const hash = await sha256Hex(bytes(texto))
    assert.match(hash, HEX64, `«${texto.slice(0, 20)}» dio «${hash}»`)
  }
  // Bytes que no son texto (0, 255, 128) también deben salir en hexadecimal.
  assert.match(await sha256Hex(new Uint8Array([0, 255, 128]).buffer as ArrayBuffer), HEX64)
})

await caso('14. la misma entrada da el mismo hash y dos entradas distintas dan hashes distintos', async () => {
  const primera = await sha256Hex(bytes('pieza A'))
  const repetida = await sha256Hex(bytes('pieza A'))
  const otra = await sha256Hex(bytes('pieza B'))
  assert.equal(primera, repetida)
  assert.notEqual(primera, otra)
})

await caso('15. coincide con node:crypto en los bordes del bloque de 64 bytes y en 1000 bytes', async () => {
  for (const largo of [1, 55, 56, 63, 64, 65, 127, 128, 1000]) {
    const datos = bytes('a'.repeat(largo))
    const esperado = createHash('sha256').update(Buffer.from(datos)).digest('hex')
    assert.equal(await sha256Hex(datos), esperado, `discrepa con ${largo} bytes`)
  }
})

/* ─────────────────────────────── escalarA ────────────────────────────────── */

await caso('16. 4000×3000 con lado mayor 900 → 900×675', () => {
  assert.deepEqual(escalarA(4000, 3000, 900), { w: 900, h: 675 })
})

await caso('17. 4000×3000 con lado mayor 200 → 200×150', () => {
  assert.deepEqual(escalarA(4000, 3000, 200), { w: 200, h: 150 })
})

await caso('18. vertical 3000×4000 con lado mayor 900 → 675×900', () => {
  assert.deepEqual(escalarA(3000, 4000, 900), { w: 675, h: 900 })
})

await caso('19. nunca agranda: 800×600 con 900 se queda en 800×600', () => {
  assert.deepEqual(escalarA(800, 600, 900), { w: 800, h: 600 })
  assert.deepEqual(escalarA(200, 100, 900), { w: 200, h: 100 })
})

await caso('20. si el lado mayor ya mide exactamente el tope, no cambia', () => {
  assert.deepEqual(escalarA(900, 600, 900), { w: 900, h: 600 })
  assert.deepEqual(escalarA(600, 900, 900), { w: 600, h: 900 })
})

await caso('21. nunca devuelve menos de 1 px: 10000×1 y 1×10000 con lado mayor 200', () => {
  assert.deepEqual(escalarA(10000, 1, 200), { w: 200, h: 1 })
  assert.deepEqual(escalarA(1, 10000, 200), { w: 1, h: 200 })
})

await caso('22. resultados siempre enteros', () => {
  for (const [w, h, tope] of [[4000, 3000, 900], [3333, 2222, 777], [1234, 567, 321], [987, 654, 100]]) {
    const d = escalarA(w, h, tope)
    assert.ok(Number.isInteger(d.w), `${w}×${h}/${tope}: ancho no entero (${d.w})`)
    assert.ok(Number.isInteger(d.h), `${w}×${h}/${tope}: alto no entero (${d.h})`)
  }
})

await caso('23. conserva la proporción (con el redondeo, ±1 % del lado menor)', () => {
  for (const [w, h, tope] of [[4000, 3000, 900], [3000, 4000, 900], [1234, 567, 321], [1000, 333, 100]]) {
    const d = escalarA(w, h, tope)
    const original = w / h
    const escalada = d.w / d.h
    assert.ok(Math.abs(escalada - original) / original < 0.01, `${w}×${h}/${tope} deformó: ${d.w}×${d.h}`)
  }
})

await caso('24. con el perfil real, el lado mayor queda justo en el tope de cada variante', () => {
  const thumb = escalarA(4000, 3000, PERFIL_PIEZA.thumb.maxLado)
  const full = escalarA(4000, 3000, PERFIL_PIEZA.full.maxLado)
  assert.equal(Math.max(thumb.w, thumb.h), PERFIL_PIEZA.thumb.maxLado)
  assert.equal(Math.max(full.w, full.h), PERFIL_PIEZA.full.maxLado)
  assert.ok(thumb.w < full.w, `la miniatura (${thumb.w}) no es menor que el detalle (${full.w})`)
})

/* ────────────────────────────── PERFIL_PIEZA ─────────────────────────────── */

await caso('25. la miniatura tiene el lado mayor MENOR que el detalle', () => {
  assert.ok(PERFIL_PIEZA.thumb.maxLado < PERFIL_PIEZA.full.maxLado)
})

await caso('26. la calidad de la miniatura es MENOR O IGUAL que la del detalle', () => {
  assert.ok(PERFIL_PIEZA.thumb.calidad <= PERFIL_PIEZA.full.calidad)
})

await caso('27. el tope de bytes de la miniatura es MENOR que el del detalle', () => {
  assert.ok(PERFIL_PIEZA.thumb.maxBytes < PERFIL_PIEZA.full.maxBytes)
})

await caso('28. los valores del perfil son utilizables: lados enteros > 0, calidad entre 0 y 1 y tope de bytes > 0', () => {
  for (const [nombre, perfil] of [['thumb', PERFIL_PIEZA.thumb], ['full', PERFIL_PIEZA.full]] as const) {
    assert.ok(Number.isInteger(perfil.maxLado) && perfil.maxLado > 0, `${nombre}: maxLado inválido`)
    assert.ok(perfil.calidad > 0 && perfil.calidad < 1, `${nombre}: calidad fuera de (0, 1)`)
    assert.ok(perfil.maxBytes > 0, `${nombre}: maxBytes inválido`)
  }
})

console.log(`\n${casos} casos bien`)
if (fallados > 0) {
  console.log(`${fallados} casos fallados`)
  process.exitCode = 1
}
