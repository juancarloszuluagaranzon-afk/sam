import type { MaestroRow } from '../domain/sam'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const WORKFLOW = [
  'DESPEJE',
  'REPIQUE',
  'REENCALLE',
  'REENCALLE V',
  'SUBSUELO',
  'TRIPLE',
  'FERTILIZACION',
  'ZANJAS',
]

export const LOCAL_MAESTRO: MaestroRow[] = [
  { haciendaCode: 103, haciendaName: 'CONSTANCIA', suerte: '0001', area: 0.51 },
  { haciendaCode: 103, haciendaName: 'CONSTANCIA', suerte: '0002', area: 1.91 },
  { haciendaCode: 103, haciendaName: 'CONSTANCIA', suerte: '0003', area: 1.67 },
  { haciendaCode: 105, haciendaName: 'SANTA MONICA', suerte: '0001', area: 7.71 },
  { haciendaCode: 105, haciendaName: 'SANTA MONICA', suerte: '0002', area: 3.48 },
  { haciendaCode: 108, haciendaName: 'RIOGRANDE', suerte: '0001', area: 5.26 },
  { haciendaCode: 126, haciendaName: 'GUADALCANAL', suerte: '0002', area: 4.69 },
  { haciendaCode: 126, haciendaName: 'GUADALCANAL', suerte: '0003', area: 9.47 },
]
