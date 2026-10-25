import { readFileSync, writeFileSync } from 'node:fs'

// Generador determinista de datos SIMULADOS: no se conecta a la base.
let semilla = 1403
function azar() { semilla |= 0; semilla = semilla + 0x6D2B79F5 | 0; let t = Math.imul(semilla ^ semilla >>> 15, 1 | semilla); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const root = new URL('../', import.meta.url)
const write = (p: string, s: string) => writeFileSync(new URL(p, root), s)
const fincaId='14030000-0000-4000-8000-000000000001'
const suertesBase=[['010',14.68,'CC 01-1940'],['020',11.47,'CC 05-430'],['030',9.06,'CC 11-595'],['040',13.34,'CC 01-1940'],['050',6.70,'CC 05-430']] as const
const suertes=suertesBase.map(([codigo,areaHa,variedad],i)=>({id:`14030000-0000-4000-8000-${String(i+2).padStart(12,'0')}`,fincaId,codigo,areaHa,variedad,activa:true,datosIngenio:null as null|Record<string,number|string>}))
const ciclos:any[]=[], movimientos:any[]=[], labores:any[]=[], reportes:any[]=[]
const cosechas:number[][]=[]
const meses=[3,5,4,6,2]
function iso(y:number,m:number,d:number){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function sumarMeses(fecha:string, meses:number, minimo:number, maximo:number){const d=new Date(`${fecha}T00:00:00Z`),inicio=d.getTime(),dia=Number(fecha.slice(8,10)),mesesEnteros=Math.floor(meses),fraccion=meses-mesesEnteros;d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+mesesEnteros);d.setUTCDate(Math.min(dia,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));d.setUTCDate(d.getUTCDate()+Math.ceil(fraccion*30.4375));while((d.getTime()-inicio)/86400000/30.4375<minimo)d.setUTCDate(d.getUTCDate()+1);while((d.getTime()-inicio)/86400000/30.4375>=maximo)d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
for(const [si,s] of suertes.entries()){
 let corte=iso(2020,[7,7,6,6,6][si],10+si)
 for(let n=0;n<6;n++){
   const tipo=n===0?'PLANTILLA':'SOCA'; const fCierre=n<5?n===0?sumarMeses(corte,13+azar(),13,14):sumarMeses(corte,12.3+azar(),12.3,13.3):null
   const c={id:`14030000-0000-4000-8000-${String(100+si*6+n).padStart(12,'0')}`,suerteId:s.id,fechaCorte:corte,tipo,estado:fCierre?'CERRADO':'ABIERTO',fechaCierre:fCierre,datosCosecha:null as any}; ciclos.push(c)
   if(fCierre){const tch=Math.round(([140,131,124,118,113][n]*(.94+azar()*.12)*(0.96+azar()*.08))*10)/10; const edad=Math.round(((Date.parse(fCierre)-Date.parse(corte))/86400000/30.4375)*10)/10;const r=Math.round((9.6+azar()*1.6)*100)/100; c.datosCosecha={fUltCorte:fCierre,edadMeses:edad,numeroCorte:n+1,toneladas:Math.round(tch*s.areaHa),tch,rendimiento:r,sacarosa:Math.round((r+1.4+azar()*.5)*100)/100,fuente:'SIMULADO — finca de prueba'};s.datosIngenio=c.datosCosecha;cosechas.push([si,n])}
   if(n<5) corte=fCierre!
 }
}
const refIPC={2020:1.61,2021:5.62,2022:13.12,2023:9.28,2024:5.2,2025:5.1}
const rubros:any={mano_obra:2100000,insumos:2400000,maquinaria:1600000,agua:700000,administracion:400000,predial_fondos:300000,otros:200000,semilla:2800000}
const nombresRubro:Record<string,string>={mano_obra:'Mano de obra (corte de malezas)',insumos:'Fertilización (urea y KCl)',maquinaria:'Preparación y maquinaria',agua:'Riego por gravedad',administracion:'Administración',predial_fondos:'Predial y fondos',otros:'Otros gastos',semilla:'Semilla'}
function conceptoRubro(r:string){return `SIMULADO — ${nombresRubro[r]??r}`}
const real=(r:string,n:number)=>rubros[r]+(n===0&&r==='insumos'?600000:0)
// 🔴 Vocabulario del cliente: el CICLO arranca con la RENOVACIÓN (destrucción de cepas, arado,
// surcado, siembra) y sigue con cortes de ~1 año (plantilla, soca 1, soca 2…). Esas labores
// van con su nombre al comienzo del corte de plantilla (costo real por ha, pesos dic-2025).
const RENOVACION: { dias: number; concepto: string; rubro: string; real: number }[] = [
  { dias: 0, concepto: 'Renovación: destrucción de cepas', rubro: 'maquinaria', real: 700000 },
  { dias: 6, concepto: 'Renovación: arado', rubro: 'maquinaria', real: 900000 },
  { dias: 12, concepto: 'Renovación: surcado', rubro: 'maquinaria', real: 800000 },
  { dias: 18, concepto: 'Siembra: semilla', rubro: 'semilla', real: 2800000 },
]
const ipcPct:Record<number,number>={2020:1.61,2021:5.62,2022:13.12,2023:9.28,2024:5.2,2025:5.1,2026:5.1}
const salario:Record<number,number>={2020:877803,2021:908526,2022:1000000,2023:1160000,2024:1300000,2025:1423500,2026:1750905}
function nivel(y:number){if(y===2026)return 1.051;let p=1;for(let k=y+1;k<=2025;k++)p/=1+(ipcPct[k]??5.1)/100;return p}
let movN=0
for(const c of ciclos.filter(c=>c.estado==='CERRADO')){
 const s=suertes.find(s=>s.id===c.suerteId)!, corte=c.fechaCorte, cierre=c.fechaCierre, corteN=Number(c.datosCosecha.numeroCorte)-1
 if (corteN === 0) {
   for (const l of RENOVACION) {
     const fecha = new Date(Date.parse(`${corte}T00:00:00Z`) + l.dias * 86400000).toISOString().slice(0, 10)
     const valor = Math.round(l.real * nivel(Number(fecha.slice(0, 4))) * s.areaHa * (0.93 + azar() * 0.14) / 1000) * 1000
     movimientos.push({ id: `mov-${++movN}`, fincaId, tipo: 'GASTO', fecha, concepto: `SIMULADO — ${l.concepto}`, suerteId: s.id, laborId: null, reporteId: null, cantidad: s.areaHa, unidad: 'ha', valorUnitario: Math.round(valor / s.areaHa), valor, soporteUrl: '/pwa-192x192.png', registradoPor: 'U005', anulado: false, rubro: l.rubro })
   }
 }
 for(const [r,base] of Object.entries(rubros)){
   if(r==='semilla') continue
   const montoReal=real(r,corteN)
   const partes=1+Math.floor(azar()*3)
   for(let i=0;i<partes;i++){const start=Date.parse(`${corte}T00:00:00Z`),end=Date.parse(`${cierre}T00:00:00Z`);const fecha=new Date(start+(end-start)*(i+1)/(partes+1)).toISOString().slice(0,10);const year=Number(fecha.slice(0,4));const choque=r==='insumos'&&year===2022?1.2:1;const nominal=montoReal*choque*(r==='mano_obra'?salario[year]/salario[2025]:nivel(year));const valor=Math.round(nominal*s.areaHa*(0.93+azar()*.14)/1000/partes)*1000; movimientos.push({id:`mov-${++movN}`,fincaId,tipo:'GASTO',fecha,concepto:conceptoRubro(r),suerteId:s.id,laborId:null,reporteId:null,cantidad:s.areaHa,unidad:'ha',valorUnitario:Math.round(valor/s.areaHa),valor,soporteUrl:'/pwa-192x192.png',registradoPor:'U005',anulado:false,rubro:r})}
 }
}
// Gastos a mano del ciclo abierto, con supuesto de IPC 2026 y salario mínimo 2026. Cada rubro
// cae cuando de verdad se gasta: el fertilizante con la fertilización, el agua en los meses
// secos y la mano de obra con las pasadas de malezas (no todo el mismo día).
const masDias = (fecha: string, dias: number) =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10)
for (const c of ciclos.filter(c => c.estado === 'ABIERTO')) {
  const s = suertes.find(x => x.id === c.suerteId)!
  const fechasPorRubro: Record<string, string[]> = {
    insumos: [masDias(c.fechaCorte, 22)],
    agua: ['2026-02-10', '2026-07-15', '2026-09-10'],
    mano_obra: [masDias(c.fechaCorte, 50), masDias(c.fechaCorte, 110), masDias(c.fechaCorte, 200)],
  }
  for (const [r, fechas] of Object.entries(fechasPorRubro)) {
    for (const fecha of fechas) {
      // Precio del año en que se gasta: un ciclo cortado en nov-2025 tiene gastos de 2025 y de 2026.
      const anio = Number(fecha.slice(0, 4))
      const nominal = r === 'mano_obra' ? rubros[r] * salario[anio] / salario[2025] : rubros[r] * nivel(anio)
      const valor = Math.round(nominal * s.areaHa / fechas.length / 1000) * 1000
      movimientos.push({ id: `mov-${++movN}`, fincaId, tipo: 'GASTO', fecha, concepto: `SIMULADO — ${nombresRubro[r]}`, suerteId: s.id, laborId: null, reporteId: null, cantidad: s.areaHa, unidad: 'ha', valorUnitario: Math.round(valor / s.areaHa), valor, soporteUrl: '/pwa-192x192.png', registradoPor: 'U005', anulado: false, rubro: r })
    }
  }
}
// ── Reportes de campo del ciclo abierto: una finca BIEN llevada a 10–11 meses del corte ──
// Roturación y fertilización hechas en toda el área y dentro de su ventana (la de
// fertilización depende de la variedad, como en el paquete), tres pasadas de malezas y
// riegos en los meses secos. El control también se ve: un reporte rechazado («la foto no
// corresponde») y vuelto a hacer, y el último riego de una suerte esperando aprobación.
// Se planean AQUÍ porque los aceptados generan SU gasto en af__revisar (al costo del
// paquete) y los honorarios y anticipos de abajo tienen que contarlo.
const HOY_SEED = '2026-10-20'
const diaFertilizacion: Record<string, number> = { 'CC 01-1940': 28, 'CC 05-430': 14, 'CC 11-595': 18 }
const riegos = ['2026-01-25', '2026-02-25', '2026-03-25', '2026-07-20', '2026-08-20', '2026-09-20']
type ReporteSeed = { codigo: string; labor: string; fecha: string; cantidad: number; estado: 'ACEPTADO' | 'PENDIENTE' | 'RECHAZADO'; motivo?: string }
const reportesSeed: ReporteSeed[] = []
for (const s of suertes) {
  const c = ciclos.find(x => x.suerteId === s.id && x.estado === 'ABIERTO')!
  const fert = masDias(c.fechaCorte, diaFertilizacion[s.variedad] ?? 30)
  reportesSeed.push({ codigo: s.codigo, labor: 'ROTURACIÓN', fecha: masDias(c.fechaCorte, 12 + Math.floor(azar() * 8)), cantidad: s.areaHa, estado: 'ACEPTADO' })
  if (s.codigo === '030') {
    reportesSeed.push({ codigo: s.codigo, labor: 'FERTILIZACIÓN', fecha: fert, cantidad: s.areaHa, estado: 'RECHAZADO', motivo: 'La foto no corresponde a la suerte; repetir el reporte en el lote' })
    reportesSeed.push({ codigo: s.codigo, labor: 'FERTILIZACIÓN', fecha: masDias(fert, 2), cantidad: s.areaHa, estado: 'ACEPTADO' })
  } else {
    reportesSeed.push({ codigo: s.codigo, labor: 'FERTILIZACIÓN', fecha: fert, cantidad: s.areaHa, estado: 'ACEPTADO' })
  }
  for (const dias of [50, 110, 200]) {
    const fecha = masDias(c.fechaCorte, dias)
    if (fecha <= HOY_SEED) reportesSeed.push({ codigo: s.codigo, labor: 'CONTROL DE MALEZAS', fecha, cantidad: s.areaHa, estado: 'ACEPTADO' })
  }
  for (const fecha of riegos.filter(f => f > c.fechaCorte && f <= HOY_SEED)) {
    reportesSeed.push({ codigo: s.codigo, labor: 'RIEGO', fecha, cantidad: s.areaHa, estado: 'ACEPTADO' })
  }
}
// El riego más reciente lo tiene solo la 050, y espera la aprobación de administración.
reportesSeed.push({ codigo: '050', labor: 'RIEGO', fecha: '2026-10-18', cantidad: suertes.find(s => s.codigo === '050')!.areaHa, estado: 'PENDIENTE' })
// Costo por unidad de cada labor en el paquete de la base (af_paquete, lo que copia el ciclo):
// es lo que af__revisar carga como gasto al aceptar. El ensayo en la base confirma el saldo.
const COSTO_PAQUETE: Record<string, number> = { 'ROTURACIÓN': 225000, 'FERTILIZACIÓN': 160000, 'CONTROL DE MALEZAS': 120000, 'RIEGO': 0 }
const RUBRO_LABOR: Record<string, string> = { 'ROTURACIÓN': 'maquinaria', 'FERTILIZACIÓN': 'insumos', 'CONTROL DE MALEZAS': 'insumos', 'RIEGO': 'agua' }
// Esos gastos van al fixture (para que sea idéntico a la base) con `reporteId`; el SQL NO los
// inserta: los crea af__revisar al aceptar cada reporte.
for (const r of reportesSeed.filter(x => x.estado === 'ACEPTADO')) {
  const valor = Math.round(r.cantidad * (COSTO_PAQUETE[r.labor] ?? 0))
  if (valor <= 0) continue
  const s = suertes.find(x => x.codigo === r.codigo)!
  movimientos.push({ id: `mov-${++movN}`, fincaId, tipo: 'GASTO', fecha: r.fecha, concepto: `${r.labor} · suerte ${r.codigo}`, suerteId: s.id, laborId: null, reporteId: `rep-${movN}`, cantidad: r.cantidad, unidad: 'ha', valorUnitario: COSTO_PAQUETE[r.labor], valor, soporteUrl: null, registradoPor: 'U005', anulado: false, rubro: RUBRO_LABOR[r.labor] })
}

// Honorario por trimestre sobre gastos (los manuales y los que generan los reportes aceptados);
// anticipos semestrales que dejan un saldo de caja positivo y pequeño.
const trimestres=new Map<string,number>()
for(const m of movimientos){const f=new Date(`${m.fecha}T00:00:00Z`),q=Math.floor(f.getUTCMonth()/3)+1,k=`${f.getUTCFullYear()}-${q}`;trimestres.set(k,(trimestres.get(k)??0)+m.valor)}
for(const [k,gasto] of trimestres){const [y,q]=k.split('-').map(Number),mes=q*3,fecha=iso(y,mes,28);movimientos.push({id:`mov-${++movN}`,fincaId,tipo:'HONORARIO',fecha,concepto:'SIMULADO — Honorario trimestral 8 %',suerteId:null,laborId:null,reporteId:null,cantidad:null,unidad:null,valorUnitario:null,valor:Math.round(gasto*.08),soporteUrl:null,registradoPor:'U005',anulado:false,rubro:'administracion'})}
const semestres=new Map<string,number>()
for(const m of movimientos.filter(m=>m.tipo==='GASTO'||m.tipo==='HONORARIO')){const y=Number(m.fecha.slice(0,4)),mes=Number(m.fecha.slice(5,7)),sem=mes<=6?1:2,k=`${y}-S${sem}`;semestres.set(k,(semestres.get(k)??0)+m.valor)}
for(let y=2020;y<=2026;y++)for(let sem=1;sem<=2;sem++){const k=`${y}-S${sem}`,gasto=semestres.get(k)??0,fecha=iso(y,sem===1?1:7,5);movimientos.push({id:`mov-${++movN}`,fincaId,tipo:'ANTICIPO',fecha,concepto:`SIMULADO — Anticipo ${k}`,suerteId:null,laborId:null,reporteId:null,cantidad:null,unidad:null,valorUnitario:null,valor:Math.ceil(gasto/1000000)*1000000+1000000,soporteUrl:null,registradoPor:'U005',anulado:false})}
const datos={fincas:[{id:fincaId,nombre:'IYOMA PRUEBAS',duenoNombre:'DUEÑO DE PRUEBA',duenoTelefono:'3000000000',duenoCorreo:null,ingenioId:'riopaila',municipio:'Roldanillo',honorarioModo:'PORCENTAJE',honorarioValor:8,nota:'SIMULADO',activa:true,createdAt:'2020-01-01',haciendaCodigo:'1403',kgAzucarTc:58,precioKgAzucar:1983}],suertes,ciclos,labores,reportes,movimientos,paquete:[]} 
const refs={productividad:null,costos:{fuente:'Fixture simulado',anio:2025,costoHa:0,costoTc:0,kaTc:0,tch:0,kgAzucarTc:58,precioTc:0},rubroPorLabor:{},inflacion:{fuente:'IPC DANE, variación anual a diciembre',ipcAnual:refIPC}}
write('scripts/fixtures/iyoma-datos.json',JSON.stringify({...datos,referencias:refs},null,2)+'\n')
const polys=JSON.parse(readFileSync(new URL('scripts/fixtures/iyoma-poligonos.json',root),'utf8'))
const q=(s:string)=>`'${s.replaceAll("'","''")}'`
const lines=[`-- IYOMA PRUEBAS: datos completamente SIMULADOS; no mostrar a clientes.`,`-- IPC: DANE variación anual diciembre 2020–2025. SM: decretos Colombia 2020–2026.`,`-- Supuestos: IPC 2026 +5,10 %; insumos +20 % reales en 2022 por choque de fertilizantes.`,`select set_config('af.via_funcion','1',true);`,`do $$ begin if exists(select 1 from public.af_fincas where nombre='IYOMA PRUEBAS') then raise exception 'YA_EXISTE: corre borrar_iyoma_pruebas.sql'; end if; end $$;`,`insert into public.af_fincas(nombre,dueno_nombre,dueno_telefono,ingenio_id,municipio,hacienda_codigo,honorario_modo,honorario_valor,nota,kg_azucar_tc,precio_kg_azucar,editado_por) values ('IYOMA PRUEBAS','DUEÑO DE PRUEBA','3000000000','riopaila','Roldanillo','1403','PORCENTAJE',8,'FINCA DE PRUEBA — datos SIMULADOS sobre el plano de la Hda. IYOMA 1403 (Riopaila Castilla). USO INTERNO: no mostrar a clientes (cartografía del ingenio). Se borra con borrar_iyoma_pruebas.sql.',58,1983,'U005');`]
for(const [codigo,area,variedad] of suertesBase) lines.push(`insert into public.af_suertes(finca_id,codigo,area_ha,variedad,editado_por) select id,${q(codigo)},${area},${q(variedad)},'U005' from public.af_fincas where nombre='IYOMA PRUEBAS';`)
for(const p of polys) lines.push(`insert into public.af_poligonos(finca_id,suerte_id,etiqueta,anillo,area_ha,fuente,editado_por) select f.id,s.id,${q(p.suerte)},${q(JSON.stringify(p.anillo))}::jsonb,${p.ha},'Plano Hda. IYOMA 1403 (Riopaila Castilla, act. may-2020), digitalizado sobre la cuadrícula MAGNA Oeste (±3 m)','U005' from public.af_fincas f join public.af_suertes s on s.finca_id=f.id and s.codigo=${q(p.suerte)} where f.nombre='IYOMA PRUEBAS';`)
for(const s of suertes){for(const c of ciclos.filter(x=>x.suerteId===s.id).sort((a,b)=>a.fechaCorte.localeCompare(b.fechaCorte))) lines.push(`select public.af__abrir_ciclo((select id from public.af_suertes where finca_id=(select id from public.af_fincas where nombre='IYOMA PRUEBAS') and codigo='${s.codigo}'),'${c.fechaCorte}'::date,'${c.tipo}','U005');`)}
for(const c of ciclos.filter(c=>c.estado==='CERRADO')){
 const s=suertes.find(x=>x.id===c.suerteId)!, co=c.datosCosecha
 const json=JSON.stringify({f_ult_corte:co.fUltCorte,edad_meses:co.edadMeses,numero_corte:co.numeroCorte,toneladas:co.toneladas,tch:co.tch,rendimiento:co.rendimiento,sacarosa:co.sacarosa,fuente:co.fuente})
 lines.push(`update public.af_ciclos set datos_cosecha=${q(json)}::jsonb where suerte_id=(select id from public.af_suertes where finca_id=(select id from public.af_fincas where nombre='IYOMA PRUEBAS') and codigo='${s.codigo}') and fecha_corte='${c.fechaCorte}' and estado='CERRADO';`)
 if(c===ciclos.filter(x=>x.suerteId===s.id&&x.estado==='CERRADO').at(-1)) lines.push(`update public.af_suertes set datos_ingenio=${q(json)}::jsonb where id=(select id from public.af_suertes where finca_id=(select id from public.af_fincas where nombre='IYOMA PRUEBAS') and codigo='${s.codigo}');`)
}
for(const m of movimientos.filter(x=>!x.reporteId)){const s=m.suerteId?suertes.find(x=>x.id===m.suerteId):null;lines.push(`insert into public.af_movimientos(finca_id,tipo,fecha,concepto,suerte_id,cantidad,unidad,valor_unitario,valor,soporte_url,registrado_por,rubro) select f.id,'${m.tipo}','${m.fecha}',${q(m.concepto)},${s?`s.id`:'null'},${m.cantidad??'null'},${m.unidad?q(m.unidad):'null'},${m.valorUnitario??'null'},${m.valor},${m.soporteUrl?q(m.soporteUrl):'null'},'U005',${m.rubro?q(m.rubro):'null'} from public.af_fincas f ${s?`join public.af_suertes s on s.finca_id=f.id and s.codigo='${s.codigo}'`:''} where f.nombre='IYOMA PRUEBAS';`)}
// Los reportes planeados arriba, en orden de fecha. `af_movimientos` no se edita (solo se
// anula): los gastos que crea af__revisar conservan su concepto.
const reportesFinal = reportesSeed
lines.push(`create function pg_temp.lab_iyoma(p_codigo text, p_labor text) returns uuid language sql as $f$
  select l.id from public.af_labores l
   join public.af_ciclos c on c.id = l.ciclo_id and c.estado = 'ABIERTO'
   join public.af_suertes s on s.id = c.suerte_id
   join public.af_fincas f on f.id = s.finca_id
  where f.nombre = 'IYOMA PRUEBAS' and s.codigo = p_codigo and l.labor = p_labor
  limit 1
$f$;`)
for (const [i, r] of reportesFinal.sort((a, b) => a.fecha.localeCompare(b.fecha)).entries()) {
  const reportar = `public.af__reportar(gen_random_uuid(), pg_temp.lab_iyoma('${r.codigo}', ${q(r.labor)}), ${r.cantidad}, '${r.fecha}'::date, '', null, null, null, ${q(`Reporte simulado ${i + 1}`)}, 'U033')`
  if (r.estado === 'ACEPTADO') lines.push(`select public.af__revisar(${reportar}, true, null, 'U005');`)
  else if (r.estado === 'RECHAZADO') lines.push(`select public.af__revisar(${reportar}, false, ${q(r.motivo ?? '')}, 'U005');`)
  else lines.push(`select ${reportar};`)
}
const reportesSeed2 = reportesFinal
// Ajustes que van DESPUÉS de reportar y aceptar (también sirven de parche sobre una base ya
// cargada: se ubican por la nota «Reporte simulado N» y por el nombre de la labor).
const ajustes: string[] = [`select set_config('af.via_funcion','1',true);`]
// Fechas: af__reportar y af__revisar ponen la hora del servidor, así que todos los reportes
// quedaban con la hora de la carga («Aceptadas hoy 55»). Cada reporte llega el día del trabajo
// y se acepta (o rechaza) uno o dos días después, en horario de oficina (hora de Bogotá).
const hora = (h: number, min: number) => `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-05`
for (const [i, r] of reportesFinal.entries()) {
  const creado = `${r.fecha} ${hora(7 + (i * 5) % 10, (i * 17) % 60)}`
  const revisado = r.estado === 'PENDIENTE' ? null : `${masDias(r.fecha, 1 + (i % 2))} ${hora(8 + (i * 3) % 9, (i * 29) % 60)}`
  ajustes.push(`update public.af_reportes r set created_at = '${creado}'::timestamptz, revisado_en = ${revisado ? `'${revisado}'::timestamptz` : 'null'} from public.af_labores l, public.af_ciclos c, public.af_suertes s, public.af_fincas f where r.nota = ${q(`Reporte simulado ${i + 1}`)} and l.id = r.labor_id and c.id = l.ciclo_id and s.id = c.suerte_id and f.id = s.finca_id and f.nombre = 'IYOMA PRUEBAS';`)
}
// Los movimientos también quedaban con la hora de la carga y, con los reportes ya en su fecha,
// encabezaban la bitácora del dueño. El gasto de un reporte se registra cuando se acepta; el
// resto, el día de su fecha en horario de oficina. 🔴 Un movimiento no se edita (trigger
// trg_af_movimientos_inmutable): SOLO para esta finca SIMULADA se apaga en esta sesión
// (session_replication_role) y se vuelve a prender. Nunca hacer esto con datos reales.
ajustes.push(`set local session_replication_role = replica;`)
ajustes.push(`update public.af_movimientos m set created_at = r.revisado_en from public.af_reportes r, public.af_fincas f where m.reporte_id = r.id and r.revisado_en is not null and f.id = m.finca_id and f.nombre = 'IYOMA PRUEBAS';`)
ajustes.push(`update public.af_movimientos m set created_at = (m.fecha + time '09:00' + (abs(hashtext(m.id::text)) % 480) * interval '1 minute') at time zone 'America/Bogota' from public.af_fincas f where m.reporte_id is null and f.id = m.finca_id and f.nombre = 'IYOMA PRUEBAS';`)
ajustes.push(`set local session_replication_role = origin;`)
// Presupuesto del corte en curso: la app presupuesta UNA línea por labor (cantidad × costo), y las
// que se repiten (riego, malezas) cuentan una sola vez. Con el costo del paquete (solo la
// maquinaria) el presupuesto era $27,9 M contra $355,7 M ejecutados (1275 %), porque el
// fertilizante, la mano de obra y el agua entran como gastos a mano. Aquí cada labor lleva su
// presupuesto COMPLETO del corte por hectárea (insumos, mano de obra, agua y todas sus pasadas).
// Va después de aceptar los reportes: sus gastos quedan al costo del paquete, como se cobraron.
const PRESUPUESTO_CORTE: Record<string, number> = { 'ROTURACIÓN': 225000, 'FERTILIZACIÓN': 2650000, 'CONTROL DE MALEZAS': 3300000, 'RIEGO': 1000000 }
ajustes.push(`update public.af_labores l set costo_unitario_plan = v.costo, editado_por = 'U005' from (values ${Object.entries(PRESUPUESTO_CORTE).map(([l, v]) => `(${q(l)}, ${v})`).join(', ')}) as v(labor, costo), public.af_ciclos c, public.af_suertes s, public.af_fincas f where l.labor = v.labor and c.id = l.ciclo_id and c.estado = 'ABIERTO' and s.id = c.suerte_id and f.id = s.finca_id and f.nombre = 'IYOMA PRUEBAS';`)
lines.push(...ajustes)
write('supabase/ajuste_iyoma_pruebas_fechas_presupuesto.sql', [`-- IYOMA PRUEBAS: fechas de los reportes y presupuesto del corte en curso sobre una base YA cargada`, `-- (lo mismo que hace el final de seed_iyoma_pruebas.sql). Lo genera scripts/generar-iyoma-pruebas.mts.`, ...ajustes].join('\n') + '\n')
lines.push(`select set_config('af.via_funcion','1',true);`)
write('supabase/seed_iyoma_pruebas.sql',lines.join('\n')+'\n')
write('supabase/borrar_iyoma_pruebas.sql',readFileSync(new URL('supabase/borrar_riogrande_pruebas.sql',root),'utf8').replaceAll('RIOGRANDE PRUEBAS','IYOMA PRUEBAS').replaceAll('borrar_riogrande_pruebas.sql','borrar_iyoma_pruebas.sql'))
const conteos=Object.groupBy(movimientos,movimiento=>movimiento.tipo)
console.log(`Fixture: ${ciclos.length} ciclos; ${conteos.GASTO?.length??0} gastos manuales, ${conteos.HONORARIO?.length??0} honorarios, ${conteos.ANTICIPO?.length??0} anticipos; ${reportesSeed2.length} reportes SQL (${reportesSeed2.filter(r => r.estado === 'ACEPTADO').length} aceptados, ${reportesSeed2.filter(r => r.estado === 'PENDIENTE').length} pendiente, ${reportesSeed2.filter(r => r.estado === 'RECHAZADO').length} rechazado).`)
