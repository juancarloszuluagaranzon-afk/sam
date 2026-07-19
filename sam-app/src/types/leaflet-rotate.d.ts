/**
 * Tipos mínimos para el plugin `leaflet-rotate` (rotación del mapa estilo
 * Avenza: gesto de dos dedos en móvil, Shift+arrastrar en PC, setBearing).
 * El plugin no publica tipos propios; aquí se aumenta el módulo `leaflet`.
 */
declare module 'leaflet-rotate'

import 'leaflet'

declare module 'leaflet' {
  interface MapOptions {
    /** Habilita la rotación del mapa (plugin leaflet-rotate). */
    rotate?: boolean
    /** Rotación con gesto de dos dedos en pantallas táctiles. */
    touchRotate?: boolean
    /** Rotación con Shift + arrastrar en desktop. */
    shiftKeyRotate?: boolean
    /** Control visual de rotación del plugin (usamos nuestra propia brújula). */
    rotateControl?: boolean | { closeOnZeroBearing?: boolean; position?: string }
    /** Ángulo inicial en grados. */
    bearing?: number
  }

  interface Map {
    setBearing(theta: number): void
    getBearing(): number
  }
}
