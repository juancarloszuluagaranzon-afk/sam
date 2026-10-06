import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve('sam-app/.env') })
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function run() {
  const { data, error } = await supabase
    .from('asignaciones')
    .select('id, estado, nombre_hacienda, numero_suerte, labor_nombre, equipo_nombre, operador_nombre, updated_at')
    .eq('estado', 'CANCELADA')
    .order('updated_at', { ascending: false })
    .limit(5)
  
  if (error) console.error(error)
  else console.log(data)
}
run()
