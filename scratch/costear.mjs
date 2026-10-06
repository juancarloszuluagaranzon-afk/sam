import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve('sam-app/.env') })
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function run() {
  const { data: asignaciones, error } = await supabase
    .from('asignaciones')
    .select('*')
    .in('estado', ['COMPLETADA', 'PARCIAL'])
    .ilike('nombre_hacienda', '%RIOGRANDE%')
  
  const { data: tarifas } = await supabase.from('tarifas').select('*')

  let results = {}
  
  asignaciones.forEach(a => {
    let labor = a.labor_nombre
    let mod = a.modalidad || null
    let area = a.area_realizada > 0 ? a.area_realizada : (a.area_asignada || 0)
    
    // 1. Filter by Risaralda
    let matched = tarifas.filter(t => t.labor_nombre === labor && t.cliente_clave === 'RISARALDA')
    
    // Fallback to PICHICHI or PROVEEDOR (based on the documentation)
    if (matched.length === 0) {
      matched = tarifas.filter(t => t.labor_nombre === labor && t.cliente_clave === 'PROVEEDOR')
    }
    
    // 2. Filter by modalidad
    let withMod = matched.filter(t => t.modalidad === mod)
    if (withMod.length > 0) matched = withMod
    else matched = matched.filter(t => t.modalidad == null)
    
    let tarifaStr = matched.length > 0 ? matched[0].precio_ha : 0
    let precio = Number(tarifaStr) || 0
    let costo = area * precio
    
    let suerte = a.numero_suerte
    if (!results[suerte]) results[suerte] = { area: 0, costo: 0, ops: {}, missing: [] }
    results[suerte].area += area
    results[suerte].costo += costo
    
    if (precio === 0) {
      results[suerte].missing.push(labor)
    }

    if (!results[suerte].ops[labor]) results[suerte].ops[labor] = 0
    results[suerte].ops[labor] += costo
  })
  
  console.log(JSON.stringify(results, null, 2))
}
run()
