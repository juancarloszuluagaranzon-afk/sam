import type { CicloEnExceso } from '../lib/sobreArea'

/**
 * «Revise antes de pagar»: suertes y labores del periodo cuyo total registrado pasa del área oficial.
 * Es la última capa del candado de área (ver `lib/sobreArea.ts`). Avisa, no bloquea: el área oficial puede
 * haber cambiado después de registrar la labor, y eso no es un pago doble.
 */
const fmt = (n: number): string => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })

export function AvisoSobreArea({ ciclos }: { ciclos: CicloEnExceso[] }) {
  if (!ciclos || ciclos.length === 0) return null
  const total = ciclos.reduce((s, c) => s + c.exceso, 0)
  return (
    <div className="aviso-sobre-area" role="alert">
      <p className="aviso-sobre-area__titulo">
        <b>⚠ Revise antes de pagar:</b> {ciclos.length === 1 ? '1 suerte con una labor pasa' : `${ciclos.length} suertes con labores pasan`} del
        área oficial, <b>{fmt(total)} ha de más</b> en total.
      </p>
      <details>
        <summary>Ver el detalle</summary>
        <ul className="aviso-sobre-area__lista">
          {ciclos.map((c) => (
            <li key={c.clave}>
              <b>{c.haciendaName} · {c.suerte} · {c.labor}</b>
              <span>Oficial {fmt(c.areaOficial)} ha · registradas {fmt(c.areaPagada)} ha · <b className="aviso-sobre-area__mas">+{fmt(c.exceso)} ha</b></span>
              <small>{c.filas.map((f) => `${f.operador || 'sin nombre'} ${fmt(f.area)} ha`).join(' · ')}</small>
            </li>
          ))}
        </ul>
        <p className="aviso-sobre-area__nota">
          La comparación es contra el área oficial del maestro de hoy. Si el área cambió después de registrar la labor puede no ser
          un pago doble; si no cambió, hay que corregir antes de pagar.
        </p>
      </details>
    </div>
  )
}
