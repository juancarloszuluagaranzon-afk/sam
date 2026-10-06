import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve('sam-app/.env') })
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function run() {
  const { data, error } = await supabase.rpc('exec_sql', { sql: 'ALTER TABLE asignaciones ADD COLUMN tarifa_id UUID;' })
  console.log("Error:", error)
}
run()
