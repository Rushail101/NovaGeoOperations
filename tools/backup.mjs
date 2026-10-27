// Daily backup: copies every table to JSON files in backups/<date>/.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the service key, never the anon key; keep it secret).
// Run:  node tools/backup.mjs
import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const TABLES = [
  'profiles', 'mills', 'customers', 'suppliers', 'grades', 'orders', 'weighments', 'mill_runs',
  'assets', 'maintenance_schedules', 'maintenance_logs', 'lining_inspections', 'batches', 'bags',
  'spare_items', 'spare_moves', 'downtime', 'shift_notes', 'dust_logs', 'grade_meshes', 'licences', 'vehicles',
  'stock_counts', 'plant_settings', 'audit_log',
]
const PAGE = 1000

export async function fetchAll(client, table) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

export async function backup(client, dir, tables = TABLES) {
  await mkdir(dir, { recursive: true })
  const summary = {}
  for (const t of tables) {
    const rows = await fetchAll(client, t)
    await writeFile(`${dir}/${t}.json`, JSON.stringify(rows))
    summary[t] = rows.length
  }
  await writeFile(`${dir}/_summary.json`, JSON.stringify({ taken_at: new Date().toISOString(), rows: summary }, null, 2))
  return summary
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const summary = await backup(client, `backups/${day}`)
  console.log('Backup done:', summary)
}
