// Telegram alerts. Run every ~30 minutes by .github/workflows/alerts.yml.
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// Each alert has a key stored in the alert_log table so it is sent once, not every 30 minutes.
import { createClient } from '@supabase/supabase-js'
import { pathToFileURL } from 'node:url'
import { computeDue } from '../src/due.js'
import { missingPapers, permitProblems } from '../src/papers.js'

const istDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const istHour = (d) => Number(new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }))
const kg = (x) => Number(x || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' kg'
const sum = (rows, f) => rows.reduce((a, r) => a + Number(f(r) || 0), 0)

// Pure: takes table data, returns [{ key, text }]. Unit-tested in tools/test.mjs.
export function buildAlerts(d, now = new Date()) {
  const out = []
  const today = istDate(now)
  const mills = Object.fromEntries((d.mills || []).map((m) => [m.id, m.name]))

  for (const s of computeDue(d.schedules || [], d.assets || [], d.hours || [])) {
    if (s.state === 'due') out.push({ key: `maint:${s.id}:${s.last_done_at || 'never'}`, text: `Maintenance overdue: ${s.asset?.name ?? 'asset'} - ${s.task} (${s.detail})` })
  }
  for (const o of d.orders || []) {
    if (!['dispatched', 'cancelled'].includes(o.status) && o.due_date && o.due_date < today)
      out.push({ key: `order:${o.id}:${o.due_date}`, text: `Order past due date: ${o.order_no} (${o.customers?.name ?? ''}) was due ${o.due_date}` })
  }
  const week = Math.floor(new Date(today).getTime() / (7 * 86400000))
  for (const i of d.spares || []) {
    if (i.active && Number(i.reorder_level) > 0 && Number(i.on_hand) <= Number(i.reorder_level))
      out.push({ key: `spare:${i.id}:${week}`, text: `Reorder: ${i.name} - ${Number(i.on_hand)} ${i.unit} left (reorder level ${Number(i.reorder_level)})` })
  }
  for (const b of d.held || []) out.push({ key: `hold:${b.id}`, text: `Batch ${b.batch_no} is on QC hold${b.hold_reason ? `: ${b.hold_reason}` : ''}` })
  const since = now.getTime() - 3 * 86400000
  for (const l of d.logs || []) {
    if (l.type === 'breakdown' && new Date(l.done_at).getTime() > since)
      out.push({ key: `bd:${l.id}`, text: `Breakdown logged: ${l.assets?.name ?? 'asset'} - ${l.description || 'no details'}` })
  }
  const latest = {}
  for (const i of d.lining || []) if (!latest[i.mill_id] || i.inspected_at > latest[i.mill_id].inspected_at) latest[i.mill_id] = i
  for (const i of Object.values(latest)) {
    if (['repair_soon', 'relining_needed'].includes(i.condition))
      out.push({ key: `lining:${i.id}`, text: `${mills[i.mill_id] ?? 'Mill'} lining: ${i.condition.replace('_', ' ')} (min ${i.min_thickness_mm ?? '?'} mm)` })
  }
  for (const x of d.downtime || []) {
    if (!x.ended_at && now.getTime() - new Date(x.started_at).getTime() > 2 * 3600000)
      out.push({ key: `down:${x.id}`, text: `${mills[x.mill_id] ?? 'Mill'} has been down for over 2 hours (${x.reason.replace('_', ' ')})` })
  }

  // Paperwork: loads still missing papers a day after weighing, and permit problems
  const limit = Number(d.settings?.find((s) => s.key === 'permit_variance_pct')?.value ?? 3)
  for (const w of d.weighments || []) {
    if (!w.id || w.type === 'mill_feed') continue
    const age = now.getTime() - new Date(w.weighed_at).getTime()
    const miss = missingPapers(w)
    if (miss.length && age > 24 * 3600000)
      out.push({ key: `papers:${w.id}`, text: `Papers missing for ${w.type === 'inbound' ? 'inbound' : 'dispatch'} ${w.vehicle_no || ''} of ${istDate(w.weighed_at)}: ${miss.join(', ')}` })
    if (w.type === 'inbound') {
      const bad = permitProblems(w, limit)
      if (bad.length) out.push({ key: `permit:${w.id}`, text: `Permit check, inbound ${w.vehicle_no || ''} of ${istDate(w.weighed_at)} (permit ${w.permit_no || '?'}): ${bad.join('; ')}` })
    }
  }

  // Licences and supplier leases: warn at 30 days, 7 days and once expired
  const expiry = (kind, id, name, date) => {
    if (!date) return
    const left = Math.ceil((new Date(date + 'T23:59:59+05:30').getTime() - now.getTime()) / 86400000)
    const stage = left < 0 ? 'expired' : left <= 7 ? '7' : left <= 30 ? '30' : null
    if (!stage) return
    out.push({ key: `${kind}:${id}:${date}:${stage}`, text: left < 0 ? `EXPIRED: ${name} (valid until ${date})` : `Expiring in ${left} day${left === 1 ? '' : 's'}: ${name} (valid until ${date})` })
  }
  for (const l of d.licences || []) expiry('lic', l.id, l.name, l.valid_until)
  for (const s of d.leases || []) expiry('lease', s.id, `${s.name} mining lease`, s.lease_valid_until)

  // Morning summary, once, from 8am IST
  if (istHour(now) >= 8) {
    const y = istDate(new Date(now.getTime() - 86400000))
    const w = (d.weighments || []).filter((r) => istDate(r.weighed_at) === y)
    const runs = (d.runs || []).filter((r) => istDate(r.started_at) === y)
    const open = (d.orders || []).filter((o) => !['dispatched', 'cancelled'].includes(o.status))
    const dueNow = computeDue(d.schedules || [], d.assets || [], d.hours || []).filter((s) => s.state === 'due').length
    out.push({
      key: `daily:${today}`,
      text: [
        `Yesterday (${y})`,
        `Quartz received ${kg(sum(w.filter((r) => r.type === 'inbound'), (r) => r.net_kg))}`,
        `Fed to mills ${kg(sum(w.filter((r) => r.type === 'mill_feed'), (r) => r.net_kg))}`,
        `Powder produced ${kg(sum(runs, (r) => r.output_kg))}`,
        `Dispatched ${kg(sum(w.filter((r) => r.type === 'dispatch'), (r) => r.net_kg))}`,
        `Open orders ${open.length}, maintenance overdue ${dueNow}`,
      ].join('\n'),
    })
  }
  return out
}

async function load(c, now) {
  const get = async (q) => {
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return data || []
  }
  const since = new Date(now.getTime() - 3 * 86400000).toISOString()
  const week = new Date(now.getTime() - 14 * 86400000).toISOString()
  const [mills, schedules, assets, hours, orders, spares, held, logs, lining, downtime, weighments, runs, sent, licences, leases, settings] = await Promise.all([
    get(c.from('mills').select('id, name')),
    get(c.from('maintenance_schedules').select('*')),
    get(c.from('assets').select('*')),
    get(c.from('mill_total_hours').select('*')),
    get(c.from('orders').select('id, order_no, status, due_date, customers(name)')),
    get(c.from('spare_stock').select('*')),
    get(c.from('batches').select('id, batch_no, hold_reason').eq('qc_hold', true)),
    get(c.from('maintenance_logs').select('id, type, done_at, description, assets(name)').gte('done_at', since)),
    get(c.from('lining_inspections').select('id, mill_id, inspected_at, condition, min_thickness_mm')),
    get(c.from('downtime').select('id, mill_id, started_at, ended_at, reason').is('ended_at', null)),
    get(c.from('weighments').select('id, type, net_kg, gross_kg, tare_kg, weighed_at, vehicle_no, doc_paths, supplier_invoice_no, permit_no, permit_qty_kg, permit_valid_until, invoice_no, eway_bill_no').gte('weighed_at', week)),
    get(c.from('mill_runs').select('output_kg, started_at').gte('started_at', since)),
    get(c.from('alert_log').select('key')),
    get(c.from('licences').select('id, name, valid_until')),
    get(c.from('suppliers').select('id, name, lease_valid_until')),
    get(c.from('plant_settings').select('key, value')),
  ])
  return { data: { mills, schedules, assets, hours, orders, spares, held, logs, lining, downtime, weighments, runs, licences, leases, settings }, sent: new Set(sent.map((s) => s.key)) }
}

export async function sendTelegram(token, chat, text, fetchFn = fetch) {
  const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  })
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`)
}

export async function run({ client, token, chat, now = new Date(), send = sendTelegram }) {
  const { data, sent } = await load(client, now)
  const fresh = buildAlerts(data, now).filter((a) => !sent.has(a.key))
  let n = 0
  for (const a of fresh) {
    await send(token, chat, a.text)
    const { error } = await client.from('alert_log').insert({ key: a.key })
    if (error) console.error('Could not record alert', a.key, error.message)
    n++
  }
  return n
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID')
    process.exit(1)
  }
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const n = await run({ client, token: TELEGRAM_BOT_TOKEN, chat: TELEGRAM_CHAT_ID })
  console.log(`Sent ${n} alert(s)`)
}
