import { useState } from 'react'
import { DataPage, useRows, opts, fmtDateTime, toLocalInput, Badge } from '../lib.jsx'
import { supabase } from '../supabase.js'

const kinds = ['mill_lining', 'motor', 'gearbox', 'bearing', 'bag_filter', 'cyclone', 'fan', 'conveyor', 'other'].map(
  (k) => ({ value: k, label: k.replace('_', ' ') })
)

// Shared due-status calculation (also used by Dashboard)
export function computeDue(schedules, assets, hours) {
  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]))
  const hrs = Object.fromEntries(hours.map((h) => [h.mill_id, Number(h.total_hours)]))
  return schedules.map((s) => {
    const a = assetMap[s.asset_id]
    const mh = a?.mill_id ? hrs[a.mill_id] ?? 0 : null
    let state = 'ok'
    let detail = []
    if (!s.last_done_at) {
      state = 'due'
      detail.push('never done')
    }
    if (s.every_days && s.last_done_at) {
      const days = (Date.now() - new Date(s.last_done_at).getTime()) / 86400000
      const left = s.every_days - days
      detail.push(left >= 0 ? `${Math.ceil(left)} d left` : `${Math.ceil(-left)} d overdue`)
      if (left < 0) state = 'due'
      else if (left < s.every_days * 0.15 && state === 'ok') state = 'soon'
    }
    if (s.every_hours && mh != null) {
      const used = mh - Number(s.last_done_hours ?? 0)
      const left = s.every_hours - used
      detail.push(left >= 0 ? `${left.toFixed(0)} h left` : `${(-left).toFixed(0)} h overdue`)
      if (left < 0) state = 'due'
      else if (left < s.every_hours * 0.1 && state === 'ok') state = 'soon'
    }
    return { ...s, asset: a, mill_hours: mh, state, detail: detail.join(' | ') }
  })
}

function DueTab() {
  const schedules = useRows('maintenance_schedules', { select: '*', order: 'task', asc: true })
  const assets = useRows('assets')
  const hours = useRows('mill_total_hours')
  const rows = computeDue(schedules.rows, assets.rows, hours.rows).sort(
    (a, b) => ['due', 'soon', 'ok'].indexOf(a.state) - ['due', 'soon', 'ok'].indexOf(b.state)
  )
  const tone = { due: 'red', soon: 'amber', ok: 'green' }

  async function markDone(s) {
    const by = prompt('Done by (name)?') || null
    const now = new Date().toISOString()
    const { error: e1 } = await supabase.from('maintenance_logs').insert({
      asset_id: s.asset_id,
      schedule_id: s.id,
      done_at: now,
      type: 'preventive',
      description: s.task,
      done_by: by,
    })
    const { error: e2 } = await supabase
      .from('maintenance_schedules')
      .update({ last_done_at: now, last_done_hours: s.mill_hours })
      .eq('id', s.id)
    if (e1 || e2) alert((e1 || e2).message)
    schedules.reload()
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
                  <button className="link" onClick={() => markDone(s)}>
                    Mark done
                  </button>
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
      ]}
      columns={[
        { label: 'When', render: (r) => fmtDateTime(r.done_at) },
        { label: 'Asset', render: (r) => r.assets?.name },
        { label: 'Type', render: (r) => <Badge tone={r.type === 'breakdown' ? 'red' : 'blue'}>{r.type}</Badge> },
        { label: 'Details', key: 'description' },
        { label: 'Downtime h', key: 'downtime_hours' },
        { label: 'By', key: 'done_by' },
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
