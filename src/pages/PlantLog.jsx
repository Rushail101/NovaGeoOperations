import { useState } from 'react'
import { DataPage, useRows, opts, fmtDateTime, fmtDate, fmtKg, fmtNum, toLocalInput, todayIso, Badge } from '../lib.jsx'
import { mineralLedger } from '../mineral.js'

const SHIFTS = ['A', 'B', 'C'].map((x) => ({ value: x, label: x }))
export const REASONS = [
  { value: 'power_cut', label: 'Power cut' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'no_material', label: 'No material' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'changeover', label: 'Grade changeover' },
  { value: 'other', label: 'Other' },
]
const reasonLabel = Object.fromEntries(REASONS.map((r) => [r.value, r.label]))

function DowntimeTab() {
  const mills = useRows('mills', { order: 'name', asc: true })
  return (
    <DataPage
      title="Downtime"
      table="downtime"
      select="*, mills(name)"
      order="started_at"
      offline
      dateField="started_at"
      offlineLabel={(p) => `Downtime: ${reasonLabel[p.reason]}`}
      defaults={{ started_at: toLocalInput(), reason: 'power_cut' }}
      fields={[
        { name: 'mill_id', label: 'Mill', type: 'select', required: true, options: opts(mills.rows) },
        { name: 'reason', label: 'Reason', type: 'select', required: true, options: REASONS },
        { name: 'started_at', label: 'Stopped at', type: 'datetime-local', required: true },
        { name: 'ended_at', label: 'Running again at (blank if still down)', type: 'datetime-local' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      columns={[
        { label: 'Stopped', render: (r) => fmtDateTime(r.started_at) },
        { label: 'Mill', render: (r) => r.mills?.name },
        { label: 'Reason', render: (r) => <Badge tone={r.reason === 'breakdown' ? 'red' : 'amber'}>{reasonLabel[r.reason]}</Badge> },
        { label: 'Hours', render: (r) => (r.hours != null ? fmtNum(r.hours) : <Badge tone="red">still down</Badge>) },
        { label: 'Notes', key: 'notes' },
      ]}
    />
  )
}

function NotesTab() {
  return (
    <DataPage
      title="Shift handover notes"
      table="shift_notes"
      order="noted_at"
      offline
      dateField="noted_at"
      offlineLabel={() => 'Handover note'}
      defaults={{ noted_at: toLocalInput() }}
      fields={[
        { name: 'noted_at', label: 'When', type: 'datetime-local', required: true },
        { name: 'shift', label: 'Shift', type: 'select', options: SHIFTS },
        { name: 'notes', label: 'What the next shift needs to know', type: 'textarea', required: true },
      ]}
      columns={[
        { label: 'When', render: (r) => fmtDateTime(r.noted_at) },
        { label: 'Shift', key: 'shift' },
        { label: 'Note', key: 'notes' },
      ]}
    />
  )
}

function DustTab() {
  const mills = useRows('mills', { order: 'name', asc: true })
  const dust = useRows('dust_logs', { select: 'qty_kg, disposition, logged_on', order: 'logged_on', limit: 1000 })
  const month = todayIso().slice(0, 7)
  const thisMonth = dust.rows.filter((d) => d.logged_on?.startsWith(month))
  const total = thisMonth.reduce((a, d) => a + Number(d.qty_kg), 0)
  const by = (k) => thisMonth.filter((d) => d.disposition === k).reduce((a, d) => a + Number(d.qty_kg), 0)
  return (
    <DataPage
      title="Dust & fines"
      table="dust_logs"
      select="*, mills(name)"
      order="logged_on"
      offline
      dateField="logged_on"
      offlineLabel={(p) => `Dust: ${p.qty_kg} kg`}
      defaults={{ logged_on: todayIso(), source: 'cyclone', disposition: 'recycled' }}
      extra={
        <div className="stats">
          <div className="stat"><div className="label">Collected this month</div><div className="value">{fmtKg(total)}</div></div>
          <div className="stat"><div className="label">Recycled</div><div className="value">{fmtKg(by('recycled'))}</div></div>
          <div className="stat"><div className="label">Sold</div><div className="value">{fmtKg(by('sold'))}</div></div>
          <div className="stat"><div className="label">Dumped</div><div className="value">{fmtKg(by('dumped'))}</div></div>
        </div>
      }
      fields={[
        { name: 'logged_on', label: 'Date', type: 'date', required: true },
        { name: 'source', label: 'Collected from', type: 'select', required: true, options: [{ value: 'cyclone', label: 'Cyclone' }, { value: 'bag_filter', label: 'Bag filter' }, { value: 'floor_sweep', label: 'Floor sweep' }, { value: 'other', label: 'Other' }] },
        { name: 'mill_id', label: 'Mill', type: 'select', options: opts(mills.rows) },
        { name: 'qty_kg', label: 'Quantity (kg)', type: 'number', required: true },
        { name: 'disposition', label: 'What happened to it', type: 'select', required: true, options: [{ value: 'recycled', label: 'Fed back / recycled' }, { value: 'sold', label: 'Sold' }, { value: 'dumped', label: 'Dumped' }] },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      columns={[
        { label: 'Date', render: (r) => fmtDate(r.logged_on) },
        { label: 'From', render: (r) => r.source.replace('_', ' ') },
        { label: 'Mill', render: (r) => r.mills?.name || '-' },
        { label: 'Qty', render: (r) => fmtKg(r.qty_kg) },
        { label: 'Went to', key: 'disposition' },
        { label: 'Notes', key: 'notes' },
      ]}
    />
  )
}

const LOCS = [
  { value: 'raw_yard', label: 'Raw quartz in yard' },
  { value: 'washed_yard', label: 'Washed quartz heap' },
  { value: 'unpacked_powder', label: 'Powder not yet packed' },
  { value: 'packed_bags', label: 'Packed bags in stock' },
]
const locLabel = Object.fromEntries(LOCS.map((l) => [l.value, l.label]))

function CountTab() {
  const st = useRows('stock_summary').rows[0]
  // With the washing plant tracked (migration v8), raw and washed stock come from the mineral account
  const daily = useRows('mineral_daily', { limit: 20000 })
  const led = daily.rows.length ? mineralLedger(daily.rows, '0000-01-01', '9999-12-31').closing : null
  const sys = st
    ? {
        raw_yard: led ? led.raw : Number(st.inbound_kg) - Number(st.fed_kg),
        washed_yard: led ? led.washed : 0,
        unpacked_powder: Number(st.produced_kg) - Number(st.packed_kg) - (Number(st.dispatched_kg) - Number(st.dispatched_bags_kg)),
        packed_bags: Number(st.packed_in_stock_kg),
      }
    : {}
  return (
    <DataPage
      title="Physical stock count"
      table="stock_counts"
      order="counted_on"
      dateField="counted_on"
      defaults={{ counted_on: todayIso() }}
      extra={
        <>
          <p className="muted">Measure what is really in the yard or store, enter it here, and the app records the difference from what the system thinks you have. Do it monthly.</p>
          <div className="stats">
            {LOCS.map((l) => <div className="stat" key={l.value}><div className="label">System shows: {l.label}</div><div className="value">{fmtKg(sys[l.value])}</div></div>)}
          </div>
        </>
      }
      fields={[
        { name: 'counted_on', label: 'Date', type: 'date', required: true },
        { name: 'location', label: 'What you counted', type: 'select', required: true, options: LOCS, onPick: (val) => ({ system_kg: sys[val] != null ? String(Math.round(sys[val] * 100) / 100) : '' }) },
        { name: 'system_kg', label: 'System shows (kg)', type: 'number', required: true, readOnly: true, hint: 'Filled in from the app when you choose what you counted.' },
        { name: 'counted_kg', label: 'Actually counted (kg)', type: 'number', required: true },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      columns={[
        { label: 'Date', render: (r) => fmtDate(r.counted_on) },
        { label: 'Counted', render: (r) => locLabel[r.location] },
        { label: 'System', render: (r) => fmtKg(r.system_kg) },
        { label: 'Actual', render: (r) => fmtKg(r.counted_kg) },
        { label: 'Difference', render: (r) => <Badge tone={Math.abs(r.diff_kg) < 0.01 * Number(r.system_kg || 1) ? 'green' : 'red'}>{r.diff_kg > 0 ? '+' : ''}{fmtNum(r.diff_kg)} kg</Badge> },
        { label: 'Notes', key: 'notes' },
      ]}
    />
  )
}

// Washing plant: raw quartz in, washed quartz out, rejects to the pond, water and power used.
function WashingTab() {
  const suppliers = useRows('suppliers', { order: 'name', asc: true })
  const runs = useRows('washing_runs', { select: 'run_date, feed_kg, washed_kg, rejects_kg, water_used_kl, water_recycled_kl, kwh, hours', order: 'run_date', limit: 1000 })
  const month = todayIso().slice(0, 7)
  const m = runs.rows.filter((r) => r.run_date?.startsWith(month))
  const sum = (k) => m.reduce((a, r) => a + Number(r[k] || 0), 0)
  const feed = sum('feed_kg'), washed = sum('washed_kg'), water = sum('water_used_kl'), recycled = sum('water_recycled_kl'), kwh = sum('kwh')
  const pct = (a, b) => (b ? `${fmtNum((a / b) * 100, 1)}%` : '-')
  return (
    <DataPage
      title="Washing plant"
      table="washing_runs"
      select="*, suppliers(name)"
      order="run_date"
      offline
      dateField="run_date"
      offlineLabel={(p) => `Washing: ${p.feed_kg} kg in`}
      defaults={{ run_date: todayIso(), rejects_kg: '0' }}
      extra={
        <div className="stats">
          <div className="stat"><div className="label">Washed this month</div><div className="value">{fmtNum(washed / 1000, 1)} t</div><div className="muted">from {fmtNum(feed / 1000, 1)} t raw</div></div>
          <div className="stat"><div className="label">Recovery</div><div className="value">{pct(washed, feed)}</div><div className="muted">washed ÷ raw fed</div></div>
          <div className="stat"><div className="label">Water per tonne</div><div className="value">{feed ? fmtNum(water / (feed / 1000), 2) : '-'} kL</div><div className="muted">{pct(recycled, water)} recycled</div></div>
          <div className="stat"><div className="label">Power per tonne</div><div className="value">{feed ? fmtNum(kwh / (feed / 1000), 1) : '-'} kWh</div></div>
        </div>
      }
      fields={[
        { name: 'run_date', label: 'Date', type: 'date', required: true },
        { name: 'shift', label: 'Shift', type: 'select', options: SHIFTS },
        { name: 'hours', label: 'Hours run', type: 'number' },
        { name: 'feed_kg', label: 'Raw quartz fed (kg)', type: 'number', required: true },
        { name: 'washed_kg', label: 'Washed quartz out (kg)', type: 'number', required: true,
          hintFn: (v) => (Number(v.feed_kg) > 0 && Number(v.washed_kg) + Number(v.rejects_kg || 0) > Number(v.feed_kg) * 1.05 ? 'Out is more than in. Check the weights.' : '') },
        { name: 'rejects_kg', label: 'Rejects / mud / fines (kg)', type: 'number', hint: 'Goes to the settling pond or dump.' },
        { name: 'water_used_kl', label: 'Water used (kL)', type: 'number' },
        { name: 'water_recycled_kl', label: 'Of which recycled (kL)', type: 'number' },
        { name: 'kwh', label: 'Power used (kWh)', type: 'number' },
        { name: 'supplier_id', label: 'Raw material from', type: 'select', options: opts(suppliers.rows) },
        { name: 'lot_no', label: 'Lot no.' },
        { name: 'operator', label: 'Operator' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      columns={[
        { label: 'Date', render: (r) => fmtDate(r.run_date) },
        { label: 'Shift', key: 'shift' },
        { label: 'Raw in', render: (r) => fmtKg(r.feed_kg) },
        { label: 'Washed out', render: (r) => fmtKg(r.washed_kg) },
        { label: 'Rejects', render: (r) => fmtKg(r.rejects_kg) },
        { label: 'Recovery', render: (r) => <Badge tone={r.recovery_pct >= 80 ? 'green' : r.recovery_pct >= 65 ? 'amber' : 'red'}>{fmtNum(r.recovery_pct, 1)}%</Badge> },
        { label: 'Water', render: (r) => (r.water_used_kl != null ? `${fmtNum(r.water_used_kl)} kL` : '-') },
        { label: 'From', render: (r) => r.suppliers?.name || '-' },
      ]}
    />
  )
}

export { DowntimeTab, NotesTab, DustTab, CountTab, WashingTab }

export default function PlantLog() {
  const [tab, setTab] = useState('Downtime')
  const tabs = { Downtime: DowntimeTab, 'Handover notes': NotesTab, 'Dust & fines': DustTab, 'Stock count': CountTab }
  const Tab = tabs[tab]
  return (
    <div>
      <div className="tabs">
        {Object.keys(tabs).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k}</button>
        ))}
      </div>
      <Tab key={tab} />
    </div>
  )
}
