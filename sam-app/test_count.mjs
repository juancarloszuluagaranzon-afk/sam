import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://efwgncsjrqzvistqyfqc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_q1jIkS_JeZdXPmJK628uZA__kwMUU99';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testFetch() {
  console.log('Counting maestro rows...');
  const { count, error } = await supabase
    .from('maestro_risaralda')
    .select('hacienda', { count: 'exact', head: true })
    .eq('activo', true);
    
  console.log('Error:', error);
  console.log('Total entries:', count);
}

testFetch();
