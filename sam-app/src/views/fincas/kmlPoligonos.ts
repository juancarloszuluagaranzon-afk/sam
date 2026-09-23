/**
 * Lee los polígonos de un KML (Google Earth, el ingenio, o el límite de campo que
 * exporta la app del dron). Sin librerías: `DOMParser` y ya, como el geovisor de
 * AgroControl. Devuelve el anillo exterior de cada polígono en [lng, lat].
 *
 * Buscar por `getElementsByTagNameNS('*', …)` hace que no importe el namespace
 * con que venga el archivo (kml 2.2, gx, sin prefijo…).
 */
export function leerKmlPoligonos(texto: string): { nombre: string; anillo: [number, number][] }[] {
  const doc = new DOMParser().parseFromString(texto, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) return []
  const q = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagNameNS('*', tag))
  const out: { nombre: string; anillo: [number, number][] }[] = []
  q(doc, 'Placemark').forEach((pm, i) => {
    const nombre = (q(pm, 'name')[0]?.textContent ?? '').trim() || `Polígono ${i + 1}`
    for (const poly of q(pm, 'Polygon')) {
      const exterior = q(poly, 'outerBoundaryIs')[0] ?? poly
      const coords = (q(exterior, 'coordinates')[0]?.textContent ?? '').trim()
      const anillo = coords.split(/\s+/)
        .map((tok) => tok.split(',').map(Number))
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map((p) => [p[0], p[1]] as [number, number])
      if (anillo.length >= 3) out.push({ nombre, anillo })
    }
  })
  return out
}
