import { useState } from 'react'
import { DataPage, useRows, opts, fmtDateTime, toLocalInput, Badge, toast } from '../lib.jsx'
import { useAuth } from '../auth.jsx'
import { canMarkDone } from '../perms.js'
import { callRpc, uuid } from '../offline.js'
import { PhotoLink } from '../PhotoField.jsx'

const kinds = ['mill_lining', 'motor', 'gearbox', 'bearing', 'bag_filter', 'cyclone', 'fan', 'conveyor', 'other'].map(
  (k) => ({ value: k, label: k.replace('_', ' ') })
)

export { computeDue } from '../due.js'
import { computeDue } from '../due.js'

function DueTab() {
  const schedules = useRows('maintenance_schedules', { select: '*', order: 'task', asc: true })
  const assets = useRows('assets')
  const hours = useRows('mill_total_hours')
  const rows = computeDue(schedules.rows, assets.rows, hours.rows).sort(
    (a, b) => ['due', 'soon', 'ok'].indexOf(a.state) - ['due', 'soon', 'ok'].indexOf(b.state)
  )
  const tone = { due: 'red', soon: 'amber', ok: 'green' }

  const { role, name } = useAuth()
  const [busy, setBusy] = useState(null)

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

  return (
    <section>
      <h2>What is due</h2>
      {rows.length === 0 && <p className="muted">Add assets and schedules first.</p>}
      <div className="tablewrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Task</th>
              <th>Last done</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td data-label="Asset">{s.asset?.name}</td>
                <td data-label="Task">{s.task}</td>
                <td data-label="Last done">{fmtDateTime(s.last_done_at)}</td>
                <td data-label="Status">
                  <Badge tone={tone[s.state]}>{s.state}</Badge> <span className="muted">{s.detail}</span>
                </td>
                <td className="actions">
                  {canMarkDone(role) && (
                    <button className="link" disabled={busy === s.id} onClick={() => markDone(s)}>
                      Mark done
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
  const tabs = { Due: DueTab, Log: LogTab, Schedules: SchedulesTab, Assets: AssetsTab }
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
