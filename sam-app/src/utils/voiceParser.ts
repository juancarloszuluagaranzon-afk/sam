function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseSpokenNumber(text: string): number | null {
  const direct = text.match(/(\d+(?:[.,]\d+)?)/)
  if (direct) {
    const n = Number(direct[1].replace(',', '.'))
    if (!isNaN(n)) return n
  }
  const punto = text.match(/(\d+)\s+(?:punto|coma)\s+(\d+)/i)
  if (punto) {
    const n = Number(`${punto[1]}.${punto[2]}`)
    if (!isNaN(n)) return n
  }
  return null
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
