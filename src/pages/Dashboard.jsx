import { useRows, fmtKg, fmtDateTime, fmtNum, Badge } from '../lib.jsx'
import { computeDue } from '../due.js'
import { useSync } from '../offline.js'

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function Dashboard() {
  const orders = useRows('order_progress')
  const orderMeta = useRows('orders', { select: 'id, status, due_date, order_no' })
  const weighments = useRows('weighments', { select: 'type, net_kg, weighed_at', order: 'weighed_at', limit: 1000 })
  const runs = useRows('mill_runs', { select: 'output_kg, feed_kg, started_at, kwh_used', order: 'started_at', limit: 1000 })
  const mills = useRows('mills')
  const hours = useRows('mill_total_hours')
  const schedules = useRows('maintenance_schedules')
  const assets = useRows('assets')
  const lining = useRows('lining_inspections', { select: '*', order: 'inspected_at' })
  const stockRows = useRows('stock_summary')
  const st = stockRows.rows[0]
  const spares = useRows('spare_stock', { order: 'name', asc: true })
  const held = useRows('batches', { select: 'id, batch_no, hold_reason, whiteness_pct', eq: ['qc_hold', true], order: 'created_at' })
  const notes = useRows('shift_notes', { order: 'noted_at', limit: 1 })
  const down = useRows('downtime', { select: 'id, reason, started_at, ended_at, mills(name)', order: 'started_at', limit: 50 })
  const sync = useSync()
  const stillDown = down.rows.filter((d) => !d.ended_at)
  const lowSpares = spares.rows.filter((i) => i.active && Number(i.reorder_level) > 0 && Number(i.on_hand) <= Number(i.reorder_level))
  const note = notes.rows[0]

  const today = startOfToday()
  const sumToday = (type) =>
    weighments.rows.filter((w) => w.type === type && w.weighed_at >= today).reduce((a, w) => a + Number(w.net_kg || 0), 0)
  const outputToday = runs.rows.filter((r) => r.started_at >= today).reduce((a, r) => a + Number(r.output_kg || 0), 0)

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const wk = runs.rows.filter((r) => r.started_at >= weekAgo)
  const wkFeed = wk.reduce((a, r) => a + Number(r.feed_kg || 0), 0)
  const wkOut = wk.reduce((a, r) => a + Number(r.output_kg || 0), 0)
  const kwhRuns = wk.filter((r) => r.kwh_used != null && r.output_kg > 0)
  const kwhPerT = kwhRuns.length ? kwhRuns.reduce((a, r) => a + Number(r.kwh_used), 0) / (kwhRuns.reduce((a, r) => a + Number(r.output_kg), 0) / 1000) : null
  const rawYard = st ? Number(st.inbound_kg) - Number(st.fed_kg) : null
  const bulkDispatched = st ? Number(st.dispatched_kg) - Number(st.dispatched_bags_kg) : 0
  const unpacked = st ? Number(st.produced_kg) - Number(st.packed_kg) - bulkDispatched : null

  const meta = Object.fromEntries(orderMeta.rows.map((o) => [o.id, o]))
  const active = orders.rows.filter((o) => !['dispatched', 'cancelled'].includes(meta[o.id]?.status))
  const pending = active.reduce((a, o) => a + Number(o.pending_kg || 0), 0)
  const overdue = active.filter((o) => meta[o.id]?.due_date && new Date(meta[o.id].due_date) < new Date()).length

  const due = computeDue(schedules.rows, assets.rows, hours.rows)
  const dueNow = due.filter((d) => d.state === 'due')
  const dueSoon = due.filter((d) => d.state === 'soon')

  const latestLining = mills.rows.map((m) => ({
    mill: m,
    insp: lining.rows.find((l) => l.mill_id === m.id),
    hrs: hours.rows.find((h) => h.mill_id === m.id)?.total_hours,
  }))
  const tone = { good: 'green', watch: 'amber', repair_soon: 'amber', relining_needed: 'red' }

  return (
    <div>
      {(stillDown.length > 0 || held.rows.length > 0 || sync.items.length > 0) && (
        <div className="notice">
          {stillDown.map((d) => (<div key={d.id}><strong>{d.mills?.name} is down</strong> since {fmtDateTime(d.started_at)} ({d.reason.replace('_', ' ')})</div>))}
          {held.rows.length > 0 && <div><strong>{held.rows.length} batch{held.rows.length > 1 ? 'es' : ''} on QC hold:</strong> {held.rows.map((b) => b.batch_no).join(', ')}</div>}
          {sync.items.length > 0 && <div><strong>{sync.items.length} entr{sync.items.length > 1 ? 'ies' : 'y'} saved on this device</strong> and not yet sent.</div>}
        </div>
      )}
      <h2>Today</h2>
      <div className="stats">
        <div className="stat"><div className="label">Quartz received</div><div className="value">{fmtKg(sumToday('inbound'))}</div></div>
        <div className="stat"><div className="label">Fed to mills</div><div className="value">{fmtKg(sumToday('mill_feed'))}</div></div>
        <div className="stat"><div className="label">Powder produced</div><div className="value">{fmtKg(outputToday)}</div></div>
        <div className="stat"><div className="label">Dispatched</div><div className="value">{fmtKg(sumToday('dispatch'))}</div></div>
      </div>

      <h2>Stock now</h2>
      <div className="stats">
        <div className="stat"><div className="label">Raw quartz in yard</div><div className="value">{fmtKg(rawYard)}</div></div>
        <div className="stat"><div className="label">Powder not yet packed</div><div className="value">{fmtKg(unpacked)}</div></div>
        <div className="stat"><div className="label">Packed, ready to dispatch</div><div className="value">{fmtKg(st?.packed_in_stock_kg)}</div><div className="muted">{st?.bags_in_stock ?? 0} bags</div></div>
      </div>

      <h2>Last 7 days</h2>
      <div className="stats">
        <div className="stat"><div className="label">Yield (output / feed)</div><div className="value">{wkFeed > 0 ? ((wkOut / wkFeed) * 100).toFixed(1) + ' %' : '-'}</div></div>
        <div className="stat"><div className="label">Powder produced</div><div className="value">{fmtKg(wkOut)}</div></div>
        <div className="stat"><div className="label">Power per tonne</div><div className="value">{kwhPerT != null ? kwhPerT.toFixed(0) + ' kWh/t' : '-'}</div></div>
      </div>

      <h2>Orders</h2>
      <div className="stats">
        <div className="stat"><div className="label">Open orders</div><div className="value">{active.length}</div></div>
        <div className="stat"><div className="label">Pending to dispatch</div><div className="value">{fmtKg(pending)}</div></div>
        <div className="stat"><div className="label">Past due date</div><div className="value">{overdue}</div></div>
      </div>

      <h2>Maintenance</h2>
      <div className="stats">
        <div className="stat"><div className="label">Overdue tasks</div><div className="value">{dueNow.length}</div></div>
        <div className="stat"><div className="label">Due soon</div><div className="value">{dueSoon.length}</div></div>
      </div>
      {dueNow.length > 0 && (
        <div className="card">
          {dueNow.slice(0, 8).map((d) => (
            <div key={d.id} className="line">
              <Badge tone="red">due</Badge> {d.asset?.name}: {d.task} <span className="muted">{d.detail}</span>
            </div>
          ))}
        </div>
      )}

      {(lowSpares.length > 0 || note) && (
        <>
          <h2>Floor</h2>
          <div className="two">
            <div className="card">
              <div className="tag">Spares to reorder</div>
              {lowSpares.length === 0 ? <p className="muted">Nothing below its reorder level.</p> : lowSpares.slice(0, 8).map((i) => (
                <div key={i.id} className="line"><Badge tone="red">low</Badge> {i.name} <span className="muted">{fmtNum(i.on_hand)} {i.unit} left</span></div>
              ))}
            </div>
            <div className="card">
              <div className="tag">Latest handover note</div>
              {note ? <><p style={{ margin: '8px 0 4px' }}>{note.notes}</p><div className="muted">Shift {note.shift || '-'} - {fmtDateTime(note.noted_at)}</div></> : <p className="muted">No notes yet.</p>}
            </div>
          </div>
        </>
      )}

      <h2>Resin lining</h2>
      <div className="stats">
        {latestLining.map(({ mill, insp, hrs }) => (
          <div className="stat" key={mill.id}>
            <div className="label">{mill.name} - {Number(hrs || 0).toFixed(0)} run-hrs</div>
            <div className="value">
              {insp ? <Badge tone={tone[insp.condition]}>{insp.condition.replace('_', ' ')}</Badge> : <span className="muted">no inspection yet</span>}
            </div>
            {insp && <div className="muted">min {insp.min_thickness_mm ?? '-'} mm on {insp.inspected_at}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
