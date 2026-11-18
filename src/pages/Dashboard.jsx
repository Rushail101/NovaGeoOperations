import { useState } from 'react'
import { useRows, fmtKg, fmtDate, fmtDateTime, fmtNum, Badge } from '../lib.jsx'
import { mineralLedger } from '../mineral.js'
import { computeDue } from '../due.js'
import { missingPapers, permitProblems } from '../papers.js'
import { useSync } from '../offline.js'

const PERIODS = [['today', 'Today'], ['7d', 'Last 7 days'], ['month', 'This month'], ['all', 'All time']]
const sinceOf = (p) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (p === '7d') d.setDate(d.getDate() - 6)
  if (p === 'month') d.setDate(1)
  return p === 'all' ? null : d.toISOString()
}

export default function Dashboard() {
  const [period, setPeriod] = useState('month')
  const weighments = useRows('weighments', { select: 'id, type, net_kg, weighed_at, vehicle_no, gross_kg, tare_kg, doc_paths, supplier_invoice_no, permit_no, permit_qty_kg, permit_valid_until, invoice_no, eway_bill_no', order: 'weighed_at', limit: 1000 })
  const stockRows = useRows('stock_summary')
  const st = stockRows.rows[0]
  const orders = useRows('order_progress')
  const orderMeta = useRows('orders', { select: 'id, status, due_date, order_no' })
  const mills = useRows('mills')
  const hours = useRows('mill_total_hours')
  const schedules = useRows('maintenance_schedules')
  const assets = useRows('assets')
  const spares = useRows('spare_stock', { order: 'name', asc: true })
  const held = useRows('batches', { select: 'id, batch_no, hold_reason', eq: ['qc_hold', true], order: 'created_at' })
  const down = useRows('downtime', { select: 'id, reason, started_at, ended_at, mills(name)', order: 'started_at', limit: 50 })
  const licences = useRows('licences', { order: 'valid_until', asc: true })
  const leases = useRows('suppliers', { select: 'id, name, lease_valid_until' })
  const settings = useRows('plant_settings')
  const sync = useSync()
  // v8 compliance registers (empty lists until migration_v8.sql is run)
  const daily = useRows('mineral_daily', { limit: 20000 })
  const statutory = useRows('statutory_items', { order: 'next_due', asc: true })
  const medStatus = useRows('worker_health_status', { select: 'id, name, next_exam_due, left_on' })
  const incidents = useRows('incidents', { select: 'id, kind, severity, occurred_at, reported_to_authority, closed', order: 'occurred_at', limit: 100 })

  const limitPct = Number(settings.rows.find((s) => s.key === 'permit_variance_pct')?.value ?? 3)
  const since = sinceOf(period)
  const sum = (type) => weighments.rows.filter((w) => w.type === type && (!since || w.weighed_at >= since)).reduce((a, w) => a + Number(w.net_kg || 0), 0)
  const inbound = period === 'all' && st ? Number(st.inbound_kg) : sum('inbound')
  const shipped = period === 'all' && st ? Number(st.dispatched_kg) : sum('dispatch')

  const bulkOut = st ? Number(st.dispatched_kg) - Number(st.dispatched_bags_kg) : 0
  const loose = st ? Number(st.produced_kg) - Number(st.packed_kg) - bulkOut : null
  const packed = st ? Number(st.packed_in_stock_kg) : null
  const ledger = daily.rows.length ? mineralLedger(daily.rows, '0000-01-01', '9999-12-31').closing : null
  const yard = ledger ? ledger.raw : st ? Number(st.inbound_kg) - Number(st.fed_kg) : null
  const washedHeap = ledger ? ledger.washed : null
  const finished = st ? (packed || 0) + Math.max(0, loose || 0) : null

  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  const recentW = weighments.rows.filter((w) => w.weighed_at >= monthAgo)
  const noPapers = recentW.filter((w) => missingPapers(w).length)
  const permitIssues = recentW.filter((w) => w.type === 'inbound' && permitProblems(w, limitPct).length)
  const soon = (d) => d && Math.ceil((new Date(d + 'T23:59:59+05:30').getTime() - Date.now()) / 86400000) <= 30
  const expiring = [
    ...licences.rows.filter((l) => soon(l.valid_until)).map((l) => ({ id: l.id, name: l.name, date: l.valid_until })),
    ...leases.rows.filter((l) => soon(l.lease_valid_until)).map((l) => ({ id: l.id, name: `${l.name} (mining lease)`, date: l.lease_valid_until })),
  ]
  const stillDown = down.rows.filter((d) => !d.ended_at)
  const lowSpares = spares.rows.filter((i) => i.active && Number(i.reorder_level) > 0 && Number(i.on_hand) <= Number(i.reorder_level))

  const meta = Object.fromEntries(orderMeta.rows.map((o) => [o.id, o]))
  const active = orders.rows.filter((o) => !['dispatched', 'cancelled'].includes(meta[o.id]?.status))
  const pending = active.reduce((a, o) => a + Number(o.pending_kg || 0), 0)
  const overdueOrders = active.filter((o) => meta[o.id]?.due_date && new Date(meta[o.id].due_date) < new Date()).length

  const due = computeDue(schedules.rows, assets.rows, hours.rows)
  const dueNow = due.filter((d) => d.state === 'due')
  const noDate = due.filter((d) => d.state === 'unset').length

  const overdueReturns = statutory.rows.filter((i) => i.active && i.next_due < new Date().toLocaleDateString('en-CA'))
  const medOverdue = medStatus.rows.filter((h) => !h.left_on && h.next_exam_due && h.next_exam_due < new Date().toLocaleDateString('en-CA'))
  const unreported = incidents.rows.filter((i) => ['serious', 'fatal'].includes(i.severity) && !i.reported_to_authority)
  const complianceCount = overdueReturns.length + (medOverdue.length ? 1 : 0) + unreported.length
  const needs = complianceCount +
    stillDown.length + held.rows.length + dueNow.length + lowSpares.length + noPapers.length + permitIssues.length + expiring.length + sync.items.length

  return (
    <div>
      <div className="tabs">
        {PERIODS.map(([k, l]) => (
          <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>
        ))}
      </div>
      <div className="stats big">
        <div className="stat"><div className="label">Raw material (inbound quartz)</div><div className="value">{fmtKg(inbound)}</div><div className="muted">{fmtKg(yard)} raw in the yard{washedHeap != null ? `, ${fmtKg(washedHeap)} washed` : ''}</div></div>
        <div className="stat"><div className="label">Shipped out</div><div className="value">{fmtKg(shipped)}</div><div className="muted">{PERIODS.find((p) => p[0] === period)[1].toLowerCase()}</div></div>
        <div className="stat"><div className="label">In stock (powder)</div><div className="value">{fmtKg(finished)}</div><div className="muted">{st?.bags_in_stock ?? 0} bags = {fmtKg(packed)} packed, {fmtKg(Math.max(0, loose || 0))} loose</div></div>
      </div>

      <h2>Needs attention</h2>
      {needs === 0 && <div className="empty">Nothing needs attention right now.</div>}
      {needs > 0 && (
        <div className="card">
          {sync.items.length > 0 && <div className="line"><Badge tone="amber">offline</Badge> {sync.items.length} entr{sync.items.length > 1 ? 'ies' : 'y'} saved on this device and not yet sent</div>}
          {stillDown.map((d) => <div key={d.id} className="line"><Badge tone="red">down</Badge> {d.mills?.name} since {fmtDateTime(d.started_at)} <span className="muted">({d.reason.replace('_', ' ')})</span></div>)}
          {held.rows.map((b) => <div key={b.id} className="line"><Badge tone="red">QC hold</Badge> {b.batch_no} <span className="muted">{b.hold_reason || ''}</span></div>)}
          {dueNow.slice(0, 8).map((d) => <div key={d.id} className="line"><Badge tone="red">overdue</Badge> {d.asset?.name}: {d.task} <span className="muted">{d.detail}</span></div>)}
          {dueNow.length > 8 && <div className="muted">and {dueNow.length - 8} more under Maintenance</div>}
          {lowSpares.slice(0, 8).map((i) => <div key={i.id} className="line"><Badge tone="amber">reorder</Badge> {i.name} <span className="muted">{fmtNum(i.on_hand)} {i.unit} left</span></div>)}
          {overdueReturns.map((i) => <div key={i.id} className="line"><Badge tone="red">return</Badge> {i.title} <span className="muted">was due {fmtDate(i.next_due)} · Compliance › Returns</span></div>)}
          {medOverdue.length > 0 && <div className="line"><Badge tone="red">medical</Badge> {medOverdue.length} worker medical{medOverdue.length > 1 ? 's' : ''} overdue <span className="muted">Compliance › Workers & health</span></div>}
          {unreported.map((i) => <div key={i.id} className="line"><Badge tone="red">incident</Badge> Serious {i.kind.replace('_', ' ')} on {fmtDateTime(i.occurred_at)} not reported to the authority</div>)}
          {expiring.map((e) => <div key={e.id} className="line"><Badge tone="amber">expiring</Badge> {e.name} <span className="muted">valid until {e.date}</span></div>)}
          {permitIssues.slice(0, 4).map((w) => <div key={w.id} className="line"><Badge tone="amber">permit</Badge> {w.vehicle_no || 'Inbound'} {fmtDateTime(w.weighed_at)} <span className="muted">{permitProblems(w, limitPct)[0]}</span></div>)}
          {noPapers.slice(0, 6).map((w) => <div key={w.id} className="line"><Badge tone="red">papers</Badge> {w.type === 'inbound' ? 'Inbound' : 'Dispatch'} {w.vehicle_no || ''} {fmtDateTime(w.weighed_at)} <span className="muted">missing {missingPapers(w).join(', ')}</span></div>)}
          {noPapers.length > 6 && <div className="muted">and {noPapers.length - 6} more loads under Shipments</div>}
        </div>
      )}
      <p className="muted">
        {active.length} open order{active.length === 1 ? '' : 's'}, {fmtKg(pending)} still to ship{overdueOrders ? `, ${overdueOrders} past due date` : ''}.
        {noDate > 0 && ` ${noDate} maintenance tasks are waiting for a last-done date.`}
      </p>
    </div>
  )
}
