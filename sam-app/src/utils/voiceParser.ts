function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const WORD_TO_DIGITS: Record<string, string> = {
  cero: '0', uno: '1', una: '1', un: '1',
  dos: '2', tres: '3', cuatro: '4', cinco: '5',
  seis: '6', siete: '7', ocho: '8', nueve: '9',
  diez: '10', once: '11', doce: '12', trece: '13', catorce: '14', quince: '15',
  dieciseis: '16', diecisiete: '17', dieciocho: '18', diecinueve: '19',
  veinte: '20',
  veintiuno: '21', veintiuna: '21', veintiun: '21',
  veintidos: '22', veintitres: '23', veinticuatro: '24', veinticinco: '25',
  veintiseis: '26', veintisiete: '27', veintiocho: '28', veintinueve: '29',
  treinta: '30', cuarenta: '40', cincuenta: '50',
  sesenta: '60', setenta: '70', ochenta: '80', noventa: '90',
}

const TENS_BASE: [string, number][] = [
  ['treinta', 30], ['cuarenta', 40], ['cincuenta', 50],
  ['sesenta', 60], ['setenta', 70], ['ochenta', 80], ['noventa', 90],
]
const ONES_BASE: [string, number][] = [
  ['uno', 1], ['dos', 2], ['tres', 3], ['cuatro', 4], ['cinco', 5],
  ['seis', 6], ['siete', 7], ['ocho', 8], ['nueve', 9],
]
for (const [tWord, tVal] of TENS_BASE) {
  for (const [oWord, oVal] of ONES_BASE) {
    WORD_TO_DIGITS[`${tWord}i${oWord}`] = String(tVal + oVal)
  }
}

export function parseSpokenNumber(text: string): number | null {
  const prepared = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim()

  if (!prepared) return null

  const tokens = prepared.split(/\s+/)
  const chunks: string[] = []
  let i = 0

  while (i < tokens.length) {
    const t = tokens[i]

    if (!t) { i++; continue }

    if (i + 2 < tokens.length && tokens[i + 1] === 'y') {
      const joined = `${t}i${tokens[i + 2]}`
      if (WORD_TO_DIGITS[joined]) {
        chunks.push(WORD_TO_DIGITS[joined])
        i += 3
        continue
      }
    }

    if (t === 'punto' || t === 'coma') { chunks.push('.'); i++; continue }
    if (t === 'y') { i++; continue }

    if (/^\d+(?:\.\d+)?$/.test(t)) {
      if (t.includes('.')) {
        const [intPart, decPart] = t.split('.')
        chunks.push(intPart, '.', decPart)
      } else {
        chunks.push(t)
      }
      i++
      continue
    }

    const digits = WORD_TO_DIGITS[t]
    if (digits) chunks.push(digits)
    i++
  }

  if (chunks.length === 0) return null

  const dotIdx = chunks.indexOf('.')
  const intStr = dotIdx === -1 ? chunks.join('') : chunks.slice(0, dotIdx).join('')
  const decStr = dotIdx === -1 ? '' : chunks.slice(dotIdx + 1).join('')

  if (!intStr && !decStr) return null

  const numStr = decStr ? `${intStr || '0'}.${decStr}` : intStr
  const n = Number(numStr)
  return isNaN(n) ? null : n
}

interface NamedItem {
  code: string
  name: string
}

export function findItemByVoice<T extends NamedItem>(text: string, items: T[]): T | null {
  const spoken = normalize(text)
  if (!spoken || !items.length) return null

  for (const item of items) {
    const code = normalize(item.code)
    const name = normalize(item.name)
    if (code && spoken.includes(code)) return item
    if (name && spoken.includes(name)) return item
  }

  if (spoken.length >= 3) {
    for (const item of items) {
      const code = normalize(item.code)
      const name = normalize(item.name)
      if (code.length >= 3 && code.includes(spoken)) return item
      if (name.length >= 3 && name.includes(spoken)) return item
    }
  }

  let best: { item: T; score: number } | null = null
  for (const item of items) {
    const tokens = [
      ...normalize(item.code).split(' '),
      ...normalize(item.name).split(' '),
    ].filter((t) => t.length >= 2)
    if (!tokens.length) continue
    const unique = Array.from(new Set(tokens))
    const matches = unique.filter((t) => spoken.includes(t)).length
    const score = matches / unique.length
    if (score >= 0.5 && (!best || score > best.score)) {
      best = { item, score }
    }
  }
  return best?.item ?? null
}
