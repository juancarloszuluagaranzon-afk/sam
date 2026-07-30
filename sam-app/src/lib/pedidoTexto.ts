import type { Insumo, Aplicabilidad } from '../domain/sam'

/**
 * Traduce un repuesto del catálogo al texto que se le manda al proveedor.
 *
 * La estructura del cuaderno tiene dos capas y conviene no confundirlas:
 *
 *  · El **código propio** (`FIL-0003`) es interno. Sirve para que en la empresa
 *    todos hablen del mismo ítem. Al proveedor no le dice nada.
 *  · Lo que el proveedor entiende es **qué es, de qué marca, con qué referencia
 *    del fabricante y para qué máquina**. Ese es el orden en que hay que
 *    decírselo, y es el orden de este texto.
 *
 * Si el proveedor ya tiene SU referencia registrada, va de primera: es el dato
 * con el que él lo busca en su sistema y evita el "déjame ver si es este".
 *
 * El código interno va al final, en una línea aparte, para poder emparejar la
 * cotización cuando responda — no para que él lo use.
 */

export interface LineaPedido {
  insumo: Insumo
  cantidad: number
  /** Aplicabilidad del repuesto: a qué máquinas sirve. */
  aplica?: Aplicabilidad[]
  /** La referencia con la que ESTE proveedor lo tiene en su sistema. */
  referenciaProveedor?: string
}

function aplicaTexto(aplica?: Aplicabilidad[]): string {
  if (!aplica || aplica.length === 0) return ''
  const partes = aplica.map((a) =>
    a.equipoCodigo
      ? `máquina ${a.equipoCodigo}`
      : [a.marca, a.modelo].filter(Boolean).join(' '))
    .filter(Boolean)
  return [...new Set(partes)].join(', ')
}

/** Un ítem, como se lo lee un proveedor. */
export function lineaPedidoTexto(l: LineaPedido, indice?: number): string {
  const i = l.insumo
  const out: string[] = []
  const titulo = i.nombre + (i.descripcion ? ` — ${i.descripcion}` : '')
  out.push(indice != null ? `${indice}) ${titulo}` : titulo)

  if (l.referenciaProveedor) out.push(`   Su referencia: ${l.referenciaProveedor}`)
  // Referencia y número de parte suelen ser lo mismo; si difieren, van los dos.
  const refs = [...new Set([i.referencia, i.numeroParte].filter(Boolean))] as string[]
  if (refs.length) out.push(`   Referencia fabricante: ${refs.join(' / ')}`)
  if (i.marca) out.push(`   Marca: ${i.marca}`)

  const ap = aplicaTexto(l.aplica)
  if (ap) out.push(`   Aplica a: ${ap}`)

  out.push(`   Cantidad: ${l.cantidad} ${i.unidad}`)
  if (i.codigo) out.push(`   (cód. interno ${i.codigo})`)
  return out.join('\n')
}

/**
 * El pedido completo, listo para pegar en un correo o un WhatsApp.
 *
 * Sin markdown ni tablas: se manda por WhatsApp y ahí cualquier formato se ve
 * roto. Texto plano con sangría, que se lee igual en todas partes.
 */
export function pedidoTexto(input: {
  lineas: LineaPedido[]
  empresa?: string
  proveedor?: string
  fecha?: string
  nota?: string
  /** Quién pide, para que el proveedor sepa a quién responderle. */
  solicita?: string
}): string {
  const f = input.fecha ?? new Date().toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
  })
  const out: string[] = []
  out.push('SOLICITUD DE REPUESTOS')
  out.push(`${input.empresa ?? 'AgroServicios Morales'} · ${f}`)
  if (input.proveedor) out.push(`Para: ${input.proveedor}`)
  out.push('')
  input.lineas.forEach((l, idx) => {
    out.push(lineaPedidoTexto(l, idx + 1))
    out.push('')
  })
  if (input.nota) { out.push(`Nota: ${input.nota}`); out.push('') }
  out.push('Agradecemos confirmar disponibilidad, precio y tiempo de entrega.')
  if (input.solicita) out.push(`Solicita: ${input.solicita}`)
  return out.join('\n')
}

/**
 * Qué le falta a un repuesto para que el proveedor lo entienda sin preguntar.
 *
 * Se muestra en la ficha: es más útil avisar antes de mandar el pedido que
 * después de recibir "¿cuál de todos?".
 */
export function faltantesParaPedir(i: Insumo, aplica?: Aplicabilidad[]): string[] {
  const f: string[] = []
  if (!i.referencia && !i.numeroParte) f.push('referencia del fabricante')
  if (!i.marca) f.push('marca')
  if (!aplica || aplica.length === 0) f.push('a qué máquina aplica')
  return f
}

/** Copia al portapapeles; devuelve false si el navegador no deja. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    // Safari viejo y contextos sin permiso: el textarea temporal sigue funcionando.
    try {
      const ta = document.createElement('textarea')
      ta.value = texto
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch { return false }
  }
}
