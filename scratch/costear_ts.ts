import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { valorarLinea } from '../src/lib/tarifas.ts'
import { readFileSync } from 'fs'

dotenv.config({ path: path.resolve('.env') })
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function run() {
  const { data: asignaciones, error } = await supabase
    .from('asignaciones')
    .select('*')
    .in('estado', ['COMPLETADA', 'PARCIAL'])
    .ilike('nombre_hacienda', '%RIOGRANDE%')
  
  if (error) throw error;

  const { data: tarifas } = await supabase.from('tarifas').select('*')

  console.log("Total asignaciones en Riogrande:", asignaciones.length)
  
  let result = `# Costos Hacienda RIOGRANDE\n\n`
  result += `| Suerte | Labor | Modalidad | Equipo | Área (ha/hm) | Costo Total |\n`
  result += `|---|---|---|---|---|---|\n`

  let granTotal = 0
  let totalsBySuerte = {}

  asignaciones.forEach(a => {
    // Adapter to match Assignment interface
    const assignment = {
      id: a.id,
      labor: a.labor_nombre,
      modalidad: a.modalidad,
      ingenioId: a.ingenio_id,
      haciendaName: a.nombre_hacienda,
      suerte: a.numero_suerte,
      operatorName: a.operador_nombre,
      facturaNumero: a.factura_numero,
      soporteId: a.soporte_id,
      executedArea: a.area_realizada,
      assignedArea: a.area_asignada,
      // mapping others if necessary...
    }
    
    // Convert DB tarifa format to App format if needed, actually we can just pass DB tarifas
    // Wait, valorarLinea expects mapped arrays. Let's see its signature.
  })
}
run()
