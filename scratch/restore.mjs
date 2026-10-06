import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve('sam-app/.env') })
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

async function run() {
  const { data, error } = await supabase
    .from('asignaciones')
    .update({ estado: 'COMPLETADA' })
    .eq('id', '90d57f33-b0ff-41d7-8d47-5d64d5dc0fe0')
    .select()
  
  if (error) console.error(error)
  else console.log("Restored properly:", data)
}
run()
