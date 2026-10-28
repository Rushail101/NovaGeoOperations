import { useState } from 'react'
import { DataPage, useRows, opts, fmtDate, fmtDateTime, toLocalInput, Badge, toast } from '../lib.jsx'
import { useAuth } from '../auth.jsx'
import { canMarkDone } from '../perms.js'
import { callRpc, uuid } from '../offline.js'
import { PhotoLink } from '../PhotoField.jsx'
import { supabase } from '../supabase.js'
import Lining from './Lining.jsx'

const kinds = ['mill_lining', 'motor', 'gearbox', 'bearing', 'bag_filter', 'cyclone', 'fan', 'conveyor', 'other'].map(
  (k) => ({ value: k, label: k.replace('_', ' ') })
)

export { computeDue } from '../due.js'
import { computeDue } from '../due.js'

function DueTab() {
  const schedules = useRows('maintenance_schedules', { select: '*', order: 'task', asc: true })
  const assets = useRows('assets')
  const hours = useRows('mill_total_hours')
  const [q, setQ] = useState('')
  const [show, setShow] = useState('')
  const order = { due: 0, soon: 1, unset: 2, ok: 3 }
  const all = computeDue(schedules.rows, assets.rows, hours.rows).sort(
    (a, b) => order[a.state] - order[b.state] || String(a.next_due || '').localeCompare(String(b.next_due || '')) || String(a.asset?.name).localeCompare(String(b.asset?.name))
  )
  const rows = all.filter((s) => (!show || s.state === show) && (!q || `${s.asset?.name} ${s.task}`.toLowerCase().includes(q.toLowerCase())))
  const tone = { due: 'red', soon: 'amber', ok: 'green', unset: 'grey' }
  const label = { due: 'overdue', soon: 'due soon', ok: 'ok', unset: 'set date' }
  const count = (st) => all.filter((x) => x.state === st).length

  const { role, name } = useAuth()
  const editable = canMarkDone(role)
  const [busy, setBusy] = useState(null)

  async function setLast(s, d) {
    if (!d) return
    setBusy(s.id)
    const { error } = await supabase.from('maintenance_schedules').update({ last_done_at: new Date(d + 'T12:00:00+05:30').toISOString() }).eq('id', s.id)
    if (error) alert(error.message)
    schedules.reload()
    setBusy(null)
  }

  async function markDone(s) {
    const by = prompt('Done by (name)?', name || '')
    if (by === null) return
    setBusy(s.id)
    try {
      const res = await callRpc(
        'mark_maintenance_done',
        { p_schedule: s.id, p_done_by: by || null, p_mill_hours: s.mill_hours, p_done_at: new Date().toISOString(), p_id: uuid() },
        `Maintenance done: ${s.asset?.name ?? ''} - ${s.task}`
      )
      if (res.queued) toast('No connection. Saved on this device and will be sent automatically.')
      schedules.reload()
    } catch (e) {
      alert(e.message)
    }
    setBusy(null)
  }

  const every = (s) => [s.every_days && `${s.every_days} d`, s.every_hours && `${s.every_hours} h`].filter(Boolean).join(' / ')
  return (
    <section>
      <h2>Maintenance schedule</h2>
      <p className="muted">Standard checks and cleaning for a ball mill plant are already listed with a usual interval. Enter the date each one was last done and the next date appears. Change an interval under Schedules.</p>
      <div className="stats">
        <div className="stat"><div className="label">Overdue</div><div className="value">{count('due')}</div></div>
        <div className="stat"><div className="label">Due soon</div><div className="value">{count('soon')}</div></div>
        <div className="stat"><div className="label">Waiting for a date</div><div className="value">{count('unset')}</div></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', margin: '10px 0', alignItems: 'center' }}>
        <div className="tabs">
          {[['', 'All'], ['due', 'Overdue'], ['soon', 'Due soon'], ['unset', 'Set date'], ['ok', 'OK']].map(([v, l]) => (
            <button key={v} className={show === v ? 'on' : ''} onClick={() => setShow(v)}>{l}</button>
          ))}
        </div>
        <input style={{ maxWidth: 220 }} placeholder="Search asset or task" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {all.length === 0 && <p className="muted">No tasks yet. Run migration_v6.sql to load the standard list, or add them under Schedules.</p>}
      <div className="tablewrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Task</th>
              <th>Last done</th>
              <th>Next due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td data-label="Asset" className="wrap">{s.asset?.name}</td>
                <td data-label="Task" className="wrap" style={{ minWidth: 200 }}>{s.task} <span className="muted">every {every(s)}</span></td>
                <td data-label="Last done">
                  {editable ? (
                    <input type="date" style={{ minWidth: 130 }} disabled={busy === s.id} max={new Date().toLocaleDateString('en-CA')}
                      value={s.last_done_at ? new Date(s.last_done_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : ''}
                      onChange={(e) => setLast(s, e.target.value)} />
                  ) : fmtDateTime(s.last_done_at)}
                </td>
                <td data-label="Next due">
                  <Badge tone={tone[s.state]}>{label[s.state]}</Badge>{' '}
                  {s.next_due ? fmtDate(s.next_due) : s.every_hours && s.last_done_at ? <span className="muted">by run-hours</span> : ''}
                  {s.state !== 'unset' && s.detail && <div className="muted">{s.detail}</div>}
                </td>
                <td className="actions">
                  {editable && (
                    <button className="link" disabled={busy === s.id} onClick={() => markDone(s)}>
                      Done today
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function AssetsTab() {
  const mills = useRows('mills', { order: 'name', asc: true })
  return (
    <DataPage
      title="Assets"
      table="assets"
      select="*, mills(name)"
      order="name"
      asc
      defaults={{ active: true }}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'kind', label: 'Type', type: 'select', required: true, options: kinds },
        { name: 'mill_id', label: 'Belongs to mill (for run-hours)', type: 'select', options: opts(mills.rows) },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { label: 'Name', key: 'name' },
        { label: 'Type', render: (r) => r.kind.replace('_', ' ') },
        { label: 'Mill', render: (r) => r.mills?.name || '-' },
      ]}
    />
  )
}

function SchedulesTab() {
  const assets = useRows('assets', { order: 'name', asc: true })
  return (
    <DataPage
      title="Schedules"
      table="maintenance_schedules"
      select="*, assets(name)"
      order="task"
      asc
      fields={[
        { name: 'asset_id', label: 'Asset', type: 'select', required: true, options: opts(assets.rows) },
        { name: 'task', label: 'Task (e.g. Grease bearings)', required: true },
        { name: 'every_hours', label: 'Every N run-hours', type: 'number' },
        { name: 'every_days', label: 'Every N days', type: 'number' },
      ]}
      columns={[
        { label: 'Asset', render: (r) => r.assets?.name },
        { label: 'Task', key: 'task' },
        { label: 'Every hrs', key: 'every_hours' },
        { label: 'Every days', key: 'every_days' },
        { label: 'Last done', render: (r) => (r.last_done_at ? fmtDate(r.last_done_at) : '-') },
      ]}
    />
  )
}

function LogTab() {
  const assets = useRows('assets', { order: 'name', asc: true })
  return (
    <DataPage
      title="Maintenance & breakdown log"
      table="maintenance_logs"
      select="*, assets(name)"
      order="done_at"
      offline
      dateField="done_at"
      offlineLabel={(p) => `Maintenance log: ${p.type}`}
      defaults={{ done_at: toLocalInput(), type: 'preventive' }}
      fields={[
        { name: 'asset_id', label: 'Asset', type: 'select', required: true, options: opts(assets.rows) },
        { name: 'done_at', label: 'When', type: 'datetime-local', required: true },
        {
          name: 'type',
          label: 'Type',
          type: 'select',
          required: true,
          options: ['preventive', 'breakdown', 'inspection'].map((v) => ({ value: v, label: v })),
        },
        { name: 'description', label: 'What was done / what failed', type: 'textarea' },
        { name: 'downtime_hours', label: 'Downtime (hours)', type: 'number' },
        { name: 'done_by', label: 'Done by' },
        { name: 'photo_paths', label: 'Photos (needs signal)', type: 'photos', folder: 'maintenance' },
      ]}
      columns={[
        { label: 'When', render: (r) => fmtDateTime(r.done_at) },
        { label: 'Asset', render: (r) => r.assets?.name },
        { label: 'Type', render: (r) => <Badge tone={r.type === 'breakdown' ? 'red' : 'blue'}>{r.type}</Badge> },
        { label: 'Details', key: 'description' },
        { label: 'Downtime h', key: 'downtime_hours' },
        { label: 'By', key: 'done_by' },
        { label: 'Photos', render: (r) => <PhotoLink paths={r.photo_paths} /> },
      ]}
    />
  )
}

export default function Maintenance() {
  const [tab, setTab] = useState('Due')
  const tabs = { Due: DueTab, Log: LogTab, Schedules: SchedulesTab, Assets: AssetsTab, 'Mill lining': Lining }
  const Tab = tabs[tab]
  return (
    <div>
      <div className="tabs">
        {Object.keys(tabs).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k}
          </button>
        ))}
      </div>
      <Tab key={tab} />
    </div>
  )
}
