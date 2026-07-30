import type { Insumo, Aplicabilidad } from '../domain/sam'
import { fmtCantidad } from './cantidad'
import { fmtFechaHora } from './fechas'

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

/** Ficha mínima de la máquina, para decirle al proveedor a qué va la pieza. */
export interface EquipoRef {
  codigo: string
  marca?: string
  modelo?: string
  serie?: string
}

export interface LineaPedido {
  insumo: Insumo
  cantidad: number
  /** Aplicabilidad del repuesto: a qué máquinas sirve. */
  aplica?: Aplicabilidad[]
  /** La referencia con la que ESTE proveedor lo tiene en su sistema. */
  referenciaProveedor?: string
  /** Máquinas por código, para traducir el código interno a marca y modelo. */
  equipos?: Map<string, EquipoRef>
}

/**
 * A qué máquinas aplica, dicho como lo entiende un mostrador de repuestos.
 *
 * 🔴 Nunca mandar solo el código interno. "Aplica a: CASE1301" no le dice nada
 * a quien despacha: él necesita MARCA y MODELO. El código interno va detrás,
 * entre corchetes, por si hay que hablar de esa máquina en concreto.
 *
 * Si son muchas, se cortan: una línea con doce máquinas no la lee nadie.
 */
function aplicaTexto(aplica?: Aplicabilidad[], equipos?: Map<string, EquipoRef>): string {
  if (!aplica || aplica.length === 0) return ''
  const partes = aplica.map((a) => {
    if (a.equipoCodigo) {
      const eq = equipos?.get(a.equipoCodigo)
      const desc = [eq?.marca, eq?.modelo].filter(Boolean).join(' ')
      // Sin marca/modelo cargados solo queda el código; mejor eso que nada,
      // pero la ficha avisa aparte de que falta ese dato.
      if (!desc) return a.equipoCodigo
      return eq?.serie
        ? `${desc} (serie ${eq.serie}) [${a.equipoCodigo}]`
        : `${desc} [${a.equipoCodigo}]`
    }
    return [a.marca, a.modelo].filter(Boolean).join(' ')
  }).filter(Boolean)

  const unicas = [...new Set(partes)]
  if (unicas.length <= 3) return unicas.join(', ')
  return `${unicas.slice(0, 3).join(', ')} y otras ${unicas.length - 3}`
}

/** Un ítem, como se lo lee un proveedor. */
export function lineaPedidoTexto(l: LineaPedido, indice?: number): string {
  const i = l.insumo
  const out: string[] = []
  const titulo = i.nombre + (i.descripcion ? ` — ${i.descripcion}` : '')
  out.push(indice != null ? `${indice}) ${titulo}` : titulo)

  if (l.referenciaProveedor) out.push(`   Su referencia: ${l.referenciaProveedor}`)
  // Referencia y número de parte van ETIQUETADOS por separado: unirlos con "/"
  // deja al proveedor sin saber cuál es cuál.
  if (i.referencia) out.push(`   Referencia: ${i.referencia}`)
  if (i.numeroParte && i.numeroParte !== i.referencia) out.push(`   N° de parte: ${i.numeroParte}`)
  if (i.marca) out.push(`   Marca: ${i.marca}`)

  const ap = aplicaTexto(l.aplica, l.equipos)
  if (ap) out.push(`   Aplica a: ${ap}`)

  // fmtCantidad respeta la regla del proyecto: las unidades enteras (ganchos,
  // tornillos) van sin decimales, y nunca sale un 3.0000000001.
  out.push(`   Cantidad: ${fmtCantidad(l.cantidad, i.unidad)} ${i.unidad ?? ''}`.trimEnd())
  if (i.codigo) out.push(`   (cód. interno ${i.codigo})`)
  return out.join('\n')
}

/**
 * El pedido completo, listo para pegar en un correo o un WhatsApp.
 *
 * Sin markdown ni tablas: se manda por WhatsApp y ahí cualquier formato se ve
 * roto. Texto plano con sangría, que se lee igual en todas partes.
 *
 * Lleva las cinco cosas que el mostrador pregunta siempre y que, si no van
 * escritas, cuestan un ida y vuelta cada una: para cuándo, si acepta
 * alternativo, dónde se entrega, a nombre de quién se factura y a qué número
 * responder.
 */
export function pedidoTexto(input: {
  lineas: LineaPedido[]
  empresa?: string
  nit?: string
  proveedor?: string
  fecha?: string
  nota?: string
  /** Quién pide, para que el proveedor sepa a quién responderle. */
  solicita?: string
  telefono?: string
  /** Consecutivo del pedido: sin esto, tres cotizaciones del mismo día se mezclan. */
  consecutivo?: string
  /** Cuándo se necesita. Es la primera pregunta del mostrador. */
  requeridoPara?: string
  /** Si la máquina está parada, el proveedor prioriza distinto. */
  maquinaParada?: boolean
  /** ¿Sirve un homólogo o tiene que ser original? */
  aceptaAlternativo?: boolean
  entrega?: string
  /** Cotización = pide precio; Pedido = ya es en firme. */
  tipo?: 'COTIZACION' | 'PEDIDO'
}): string {
  const f = input.fecha ?? fmtFechaHora(new Date().toISOString())
  const out: string[] = []
  out.push(input.tipo === 'PEDIDO' ? 'PEDIDO DE REPUESTOS' : 'SOLICITUD DE COTIZACIÓN — REPUESTOS')
  out.push(`${input.empresa ?? 'AgroServicios Morales'}${input.nit ? ` · NIT ${input.nit}` : ''} · ${f}`)
  if (input.consecutivo) out.push(`Pedido ${input.consecutivo}`)
  if (input.proveedor) out.push(`Para: ${input.proveedor}`)
  out.push('')

  input.lineas.forEach((l, idx) => {
    out.push(lineaPedidoTexto(l, idx + 1))
    out.push('')
  })

  const cond: string[] = []
  if (input.requeridoPara) cond.push(`Se necesita para: ${input.requeridoPara}`)
  if (input.maquinaParada) cond.push('⚠ La máquina está PARADA.')
  if (input.aceptaAlternativo !== undefined) {
    cond.push(input.aceptaAlternativo
      ? 'Se acepta repuesto alternativo/homólogo.'
      : 'Debe ser ORIGINAL, no alternativo.')
  }
  if (input.entrega) cond.push(`Entrega: ${input.entrega}`)
  if (input.nota) cond.push(`Nota: ${input.nota}`)
  if (cond.length) { out.push(...cond); out.push('') }

  out.push('Agradecemos confirmar disponibilidad, precio y tiempo de entrega.')
  const quien = [input.solicita, input.telefono].filter(Boolean).join(' · ')
  if (quien) out.push(`Solicita: ${quien}`)
  return out.join('\n')
}

/**
 * Qué le falta a un repuesto para que el proveedor lo entienda sin preguntar.
 *
 * Depende de la FAMILIA, que es donde ese campo se gana el sueldo: a un
 * rodamiento se le pide la referencia, pero a una manguera, un tornillo o una
 * llanta lo que hace falta es **la medida**. Exigirle referencia a una manguera
 * es tan inútil como no exigirle nada.
 */
const MEDIDA_POR_FAMILIA: Record<string, string> = {
  HID: 'la medida (diámetro, largo, presión y tipo de terminales)',
  TOR: 'la medida (diámetro × largo, rosca y grado)',
  COR: 'el número de correa o el largo y perfil',
  LLA: 'la medida (ej. 18.4-38) y el número de lonas',
  LUB: 'la especificación (ej. 15W40 API CJ-4) y la presentación',
}

export function faltantesParaPedir(i: Insumo, aplica?: Aplicabilidad[]): string[] {
  const f: string[] = []
  const fam = (i.familia ?? '').toUpperCase()
  const porMedida = MEDIDA_POR_FAMILIA[fam]

  if (porMedida) {
    // Aquí la referencia rara vez existe; lo que identifica la pieza es la medida.
    if (!i.descripcion) f.push(porMedida)
  } else if (!i.referencia && !i.numeroParte) {
    f.push('la referencia del fabricante')
  }

  if (!i.marca) f.push('la marca')
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
