import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve('sam-app/.env') })
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function run() {
  const { error } = await supabase.from('asignaciones').select('tarifa_id').limit(1)
  console.log("Select tarifa_id error?", error?.message || 'No error, column exists!')
}
run()
