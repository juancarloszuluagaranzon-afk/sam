export interface ReglaDeduccion { concepto: string; porcentaje: number }
export interface ItemDeduccion { concepto: string; porcentaje: number | null; valor: number; nota?: string }
export interface ConceptoDeduccion { codigo: string; nombre: string; modo: 'PORCENTAJE' | 'VALOR'; orden: number }

export const CONCEPTOS_REPETIBLES = ['DESCUENTO', 'OTRO']

export function redondear2(n: number): number {
  if (!Number.isFinite(n)) return n
  const signo = n < 0 ? -1 : 1
  const valor = Math.abs(n)
  const entero = Math.floor(valor)
  const centavos = Math.floor((valor - entero) * 100 + 0.500000001)
  return signo * (entero + centavos / 100)
}

export function propuestaDeducciones(valorFactura: number | null, reglas: ReglaDeduccion[], yaAplicados: string[]): ItemDeduccion[] {
  if (valorFactura == null || valorFactura <= 0) return []
  return reglas.filter((r) => CONCEPTOS_REPETIBLES.includes(r.concepto) || !yaAplicados.includes(r.concepto))
    .map((r) => ({ concepto: r.concepto, porcentaje: r.porcentaje, valor: redondear2(valorFactura * r.porcentaje / 100) }))
}

export function reglasEfectivas(factura: { pagadorId: string | null; facturadoAId: string | null }, reglasPorCliente: Record<string, ReglaDeduccion[]>): ReglaDeduccion[] {
  const pagador = factura.pagadorId ? reglasPorCliente[factura.pagadorId] : undefined
  if (pagador?.length) return pagador
  return factura.facturadoAId ? reglasPorCliente[factura.facturadoAId] ?? [] : []
}

export function saldoDeFactura(valor: number | null, pagado: number, deducido: number): number | null {
  return valor == null ? null : redondear2(Math.max(0, valor - pagado - deducido))
}

export function excedeValor(valor: number | null, pagado: number, deducidoVivo: number, nuevos: number): { excede: boolean; mensaje: string } {
  if (valor == null) return { excede: true, mensaje: 'La factura todavía no tiene valor' }
  const sobra = pagado + deducidoVivo + nuevos - valor
  const excede = sobra > 0.5
  return { excede, mensaje: excede ? `Lo pagado más lo deducido pasa del valor de la factura por $${Math.round(sobra).toLocaleString('es-CO')}` : '' }
}

export function validarItem(item: ItemDeduccion, concepto: ConceptoDeduccion | undefined): string | null {
  if (!concepto) return 'El concepto no existe'
  if (concepto.modo === 'PORCENTAJE' && (item.porcentaje == null || item.porcentaje <= 0 || item.porcentaje > 100)) return 'El porcentaje debe ser mayor que 0 y máximo 100 %'
  if (!(item.valor > 0)) return 'El valor debe ser mayor que cero'
  return null
}

export function totalItems(items: ItemDeduccion[]): number {
  return redondear2(items.reduce((suma, item) => suma + item.valor, 0))
}

export function etiquetaDeduccion(item: { concepto: string; porcentaje: number | null }, conceptos: ConceptoDeduccion[]): string {
  const nombre = conceptos.find((c) => c.codigo === item.concepto)?.nombre ?? item.concepto
  return item.porcentaje == null ? nombre : `${nombre} · ${item.porcentaje.toLocaleString('es-CO')} %`
}
