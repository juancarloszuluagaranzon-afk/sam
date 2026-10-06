import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve('sam-app/.env') })
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
async function run() {
  const { data, error } = await supabase.from('asignaciones').select('*').limit(1)
  if (error) console.error(error)
  else console.log(Object.keys(data[0]))
}
run()
