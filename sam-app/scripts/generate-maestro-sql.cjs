#!/usr/bin/env node
/**
 * generate-maestro-sql.js
 * Reads maestro_risaralda_rows.csv (Supabase export format) and generates
 * a TRUNCATE + INSERT SQL file safe to run in the Supabase SQL Editor.
 *
 * Usage:
 *   node scripts/generate-maestro-sql.js <path-to-csv>
 *   node scripts/generate-maestro-sql.js "C:/Users/Agr349/Downloads/maestro_risaralda_rows.csv"
 */

const fs = require('fs')
const path = require('path')

const csvPath = process.argv[2]
if (!csvPath) {
  console.error('Usage: node scripts/generate-maestro-sql.js <path-to-csv>')
  process.exit(1)
}

const raw = fs.readFileSync(csvPath, 'utf8')
const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

// Skip header
const header = lines[0].split(',')
console.error('Columns:', header)

const rows = []
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim()
  if (!line) continue

  // CSV split (simple, no quoted commas expected in this dataset)
  const cols = line.split(',')
  if (cols.length < 6) continue

  const hacienda    = cols[1].trim()
  const nombre      = cols[2].trim().replace(/'/g, "''")  // escape single quotes
  const suerte      = cols[3].trim().replace(/'/g, "''")
  const area_neta   = parseFloat(cols[4].trim())
  const activo      = cols[5].trim() === 'true'

  if (!hacienda || !suerte) continue

  rows.push(`  (${hacienda}, '${nombre}', '${suerte}', ${area_neta}, ${activo})`)
}

console.error(`Parsed ${rows.length} rows`)

const chunkSize = 500
const chunks = []
for (let i = 0; i < rows.length; i += chunkSize) {
  chunks.push(rows.slice(i, i + chunkSize))
}

const outPath = path.join(path.dirname(csvPath), 'maestro_risaralda_seed.sql')

let sql = `-- maestro_risaralda seed — generated ${new Date().toISOString()}
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- WARNING: This will delete all existing maestro_risaralda rows first.

TRUNCATE TABLE maestro_risaralda RESTART IDENTITY CASCADE;

`

for (const chunk of chunks) {
  sql += `INSERT INTO maestro_risaralda (hacienda, nombre_hacienda, suerte, area_neta, activo) VALUES\n`
  sql += chunk.join(',\n')
  sql += `;\n\n`
}

sql += `-- Verify\nSELECT COUNT(*) FROM maestro_risaralda;\n`

fs.writeFileSync(outPath, sql, 'utf8')
console.error(`\nSQL written to: ${outPath}`)
console.log(outPath)
