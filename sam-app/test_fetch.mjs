import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://efwgncsjrqzvistqyfqc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_q1jIkS_JeZdXPmJK628uZA__kwMUU99';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testFetch() {
  console.log('Fetching maestro...');
  const { data, error } = await supabase
    .from('maestro_risaralda')
    .select('hacienda,nombre_hacienda,suerte,area_neta')
    .eq('activo', true)
    .order('hacienda')
    .order('suerte');
    
  console.log('Error:', error);
  console.log('Data length:', data ? data.length : null);
  if (data && data.length > 0) {
      console.log('Sample:', data[0]);
  }
}

testFetch();
