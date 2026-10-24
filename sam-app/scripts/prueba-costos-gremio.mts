import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { costosGremio, indicadoresCosecha, rubroDe, comparar } from '../src/lib/fincas.ts'
import type { DatosFincas, ReferenciasSector, Movimiento, RubroCosto } from '../src/services/fincasApi.ts'

const fixture = JSON.parse(readFileSync('scripts/fixtures/fincas-riogrande-pruebas.json', 'utf8')) as DatosFincas & { referencias: ReferenciasSector }
const base = fixture as DatosFincas
const refs = fixture.referencias
const fincaId = base.fincas.find(f => f.nombre === 'RIOGRANDE PRUEBAS')!.id
let casos = 0
function caso(nombre: string, fn: () => void) { fn(); console.log(`✓ ${nombre}`); casos++ }
function cerca(actual: number | null, esperado: number, tolerancia = 0) { assert.notEqual(actual, null); assert.ok(Math.abs(actual! - esperado) <= tolerancia, `${actual} != ${esperado} ±${tolerancia}`) }
function copia(): DatosFincas { return structuredClone(base) }

caso('indicadores de cosecha del fixture', () => {
  const x = indicadoresCosecha(fincaId, base); assert.ok(x)
  assert.deepEqual({ tch:x.tch, rendimiento:x.rendimiento, tah:x.tah, toneladas:x.toneladas, suertes:x.suertes, areaHa:x.areaHa }, { tch:128.4, rendimiento:10.33, tah:13.3, toneladas:5029, suertes:11, areaHa:39.18 })
  const ss = base.suertes.filter(s => s.fincaId === fincaId && s.activa && s.areaHa > 0 && s.datosIngenio?.tch != null)
  const toneladas = ss.reduce((a,s) => a + (s.datosIngenio!.toneladas ?? s.datosIngenio!.tch! * s.areaHa), 0)
  const ponderado = (k: 'sacarosa'|'edadMeses'|'numeroCorte', peso: 't'|'ha') => ss.reduce((a,s) => a + (s.datosIngenio![k] ?? 0) * (peso === 't' ? s.datosIngenio!.toneladas ?? s.datosIngenio!.tch! * s.areaHa : s.areaHa), 0) / ss.reduce((a,s) => a + (peso === 't' ? s.datosIngenio!.toneladas ?? s.datosIngenio!.tch! * s.areaHa : s.areaHa), 0)
  cerca(x.sacarosa, Math.round(ponderado('sacarosa','t')*100)/100)
  cerca(x.edadMeses, Math.round(ponderado('edadMeses','ha')*10)/10)
  cerca(x.numeroCorte, Math.round(ponderado('numeroCorte','ha')*10)/10)
  cerca(x.tchm, Math.round((ponderado('tch','ha')/ponderado('edadMeses','ha'))*10)/10)
  cerca(x.tahm, Math.round((ponderado('tch','ha')*ponderado('rendimiento','t')/100/ponderado('edadMeses','ha'))*100)/100)
  assert.ok(toneladas > 0)
})

caso('costos, rubros y honorario del fixture', () => {
  const x = costosGremio(fincaId, base, refs)!; assert.ok(x)
  assert.deepEqual({ costoTotal:x.costoTotal, costoHa:x.costoHa, costoTc:x.costoTc, kaTc:x.kaTc, kgLibres:x.kgLibres, puntoEquilibrio:x.puntoEquilibrio, kgAzucarTc:x.kgAzucarTc, precioKg:x.precioKg, kgEsReferencia:x.kgEsReferencia, desde:x.desde }, { costoTotal:306238050, costoHa:7816183, costoTc:60895, kaTc:30.7, kgLibres:27.3, puntoEquilibrio:68, kgAzucarTc:58, precioKg:1983, kgEsReferencia:false, desde:'2026-02-09' })
  cerca(x.leQuedaHa, 6950000, 34750)
  assert.deepEqual(x.rubros.map(r => [r.id,r.valor]), [['insumos',79926000],['agua',67780000],['administracion',66464300],['mano_obra',43100000],['predial_fondos',26640000],['maquinaria',15277750],['semilla',7050000]])
  assert.equal(x.rubros.reduce((a,r)=>a+r.valor,0),x.costoTotal)
})

caso('sin gastos ni honorarios', () => {
  const d=copia(); d.movimientos=d.movimientos.filter(m => m.tipo === 'ANTICIPO')
  const x=costosGremio(fincaId,d,refs)!; assert.equal(x.costoTotal,0); assert.equal(x.costoHa,0); assert.equal(x.kaTc,0); assert.equal(x.kgLibres,58)
})
caso('sin precio de azúcar conserva costos unitarios', () => {
  const d=copia(); delete d.fincas.find(f=>f.id===fincaId)!.precioKgAzucar
  const x=costosGremio(fincaId,d,refs)!; assert.equal(x.kaTc,null); assert.equal(x.kgLibres,null); assert.equal(x.puntoEquilibrio,null); assert.equal(x.ingresoTc,null); assert.equal(x.leQuedaHa,null); assert.notEqual(x.costoHa,null); assert.notEqual(x.costoTc,null); assert.notEqual(x.costoKgAzucar,null)
})
caso('referencia de kg y ausencia de referencia', () => {
  const d=copia(); delete d.fincas.find(f=>f.id===fincaId)!.kgAzucarTc
  assert.equal(costosGremio(fincaId,d,refs)!.kgEsReferencia,true)
  assert.equal(costosGremio(fincaId,d,null)!.kgAzucarTc,null)
})
caso('sin datos de ingenio', () => {
  const d=copia(); d.suertes=d.suertes.map(s=>s.fincaId===fincaId?{...s,datosIngenio:null}:s)
  assert.equal(indicadoresCosecha(fincaId,d),null); const x=costosGremio(fincaId,d,refs)!; assert.equal(x.tchEsperado,null); assert.equal(x.costoTc,null)
})
caso('TCH cero no entra al esperado', () => {
  const d=copia(), s=d.suertes.find(s=>s.fincaId===fincaId && s.datosIngenio?.tch)!; const tch=s.datosIngenio!.tch!
  s.datosIngenio!.tch=0; const x=costosGremio(fincaId,d,refs)!; assert.notEqual(x.tchEsperado,null); assert.ok(x.tchEsperado! > 0)
  // Revisión de Claude: «> 0» pasaba aunque la suerte en 0 entrara al promedio. Se compara contra el
  // promedio ponderado SIN esa suerte.
  const otras = d.suertes.filter(o => o.fincaId === fincaId && o.activa && o.id !== s.id && (o.datosIngenio?.tch ?? 0) > 0)
  const sinCero = otras.reduce((a,o) => a + o.datosIngenio!.tch! * o.areaHa, 0) / otras.reduce((a,o) => a + o.areaHa, 0)
  cerca(x.tchEsperado, Math.round(sinCero * 10) / 10)
  s.datosIngenio!.tch=tch
})
caso('anticipos y costos anteriores al corte excluidos', () => {
  const d=copia(), antes=costosGremio(fincaId,d,refs)!.costoTotal
  const m=d.movimientos.find(m=>m.tipo==='ANTICIPO')!; m.valor=antes
  const honra: Movimiento={...m,id:'honorario-antiguo',tipo:'HONORARIO',fecha:'2026-02-08',valor:987654321,concepto:'viejo'}
  const mano: Movimiento={...m,id:'gasto-antiguo',tipo:'GASTO',fecha:'2026-02-08',valor:123456789,concepto:'viejo'}
  d.movimientos.push(honra,mano); assert.equal(costosGremio(fincaId,d,refs)!.costoTotal,antes)
})
caso('rubro guardado, honorario, labor normalizada y fallback', () => {
  const labor=base.labores.find(l=>l.labor.includes('FERTILIZ'))!
  const m=(tipo: Movimiento['tipo'], rubro?: RubroCosto, laborId: string|null=null): Movimiento => ({...base.movimientos[0],tipo,rubro,laborId})
  assert.equal(rubroDe(m('GASTO','agua'),base.labores,{}),'agua')
  assert.equal(rubroDe(m('HONORARIO'),base.labores,{}),'administracion')
  assert.equal(rubroDe(m('GASTO',undefined,labor.id),base.labores,{'FERTILIZACION':'insumos'}),'insumos')
  assert.equal(rubroDe(m('GASTO'),base.labores,{}),'otros')
})
caso('comparar respeta signos, referencias y nulos', () => {
  assert.deepEqual(comparar(124.6,124.6,'pct'),{texto:'+0,0 %',arriba:true})
  assert.deepEqual(comparar(10,12,'pts'),{texto:'−2,0 pts',arriba:false})
  for (const modo of ['pct','pts','abs'] as const) { assert.equal(comparar(2,0,modo),null); assert.equal(comparar(2,null,modo),null); assert.equal(comparar(null,2,modo),null) }
})
console.log(`Casos aprobados: ${casos}`)
