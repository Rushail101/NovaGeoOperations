import { DataPage, useRows, opts, fmtDate, fmtDateTime, Badge } from '../lib.jsx'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { canHold } from '../perms.js'
import { checkSpec, effectiveSpec } from '../spec.js'

async function certificate(b, user) {
  const { data: bags, error } = await supabase.from('bags').select('bag_no, bag_type, weight_kg').eq('batch_id', b.id).neq('status', 'rejected').order('bag_no').limit(2000)
  if (error) return alert(error.message)
  const { exportReport } = await import('../pdf.js')
  const kg = (x) => Number(x).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const spec = checkSpec(b, effectiveSpec(null, b.grades))
  await exportReport(
    {
      title: 'Batch quality certificate',
      subtitle: `Batch ${b.batch_no}`,
      summary: [
        ['Product', b.grades?.name || '-'], ['Production date', fmtDate(b.produced_on)], ['Mill', b.mills?.name || '-'], ['Quartz lot', b.inbound_lot_no || '-'],
        ['SiO2', b.sio2_pct != null ? `${b.sio2_pct} %` : '-'], ['Fe2O3', b.fe2o3_pct != null ? `${b.fe2o3_pct} %` : '-'],
        ['Moisture', b.moisture_pct != null ? `${b.moisture_pct} %` : '-'], ['Whiteness', b.whiteness_pct != null ? `${b.whiteness_pct} %` : '-'],
        ['Tested on', b.tested_on ? fmtDate(b.tested_on) : '-'],
        ['Against standard limits', !spec.limited ? 'no limits set' : spec.fails.length ? 'OUTSIDE: ' + spec.fails.join('; ') : spec.untested.length ? 'not tested: ' + spec.untested.join(', ') : 'within limits'],
        ['Packed', `${bags.length} bags, ${kg(bags.reduce((a, x) => a + Number(x.weight_kg), 0))} kg`],
      ],
      sections: [{ heading: 'Bags in this batch', columns: [{ header: 'Bag no.' }, { header: 'Type' }, { header: 'Weight (kg)', align: 'right' }], rows: bags.map((x) => [x.bag_no, x.bag_type, kg(x.weight_kg)]) }],
    },
    { user, filename: `certificate-${b.batch_no}` }
  )
}

export default function Batches() {
  const { name, role } = useAuth()
  const mills = useRows('mills', { order: 'name', asc: true })
  const grades = useRows('grades', { order: 'name', asc: true })
  const runs = useRows('mill_runs', { select: 'id, started_at, mills(name)', order: 'started_at', limit: 100 })
  const lots = useRows('weighments', { select: 'lot_no', eq: ['type', 'inbound'], order: 'weighed_at', limit: 300 })
  const bags = useRows('bags', { select: 'batch_id, status, weight_kg', limit: 5000 })

  const stats = {}
  for (const b of bags.rows) {
    const s = (stats[b.batch_id] ||= { total: 0, stock: 0 })
    if (b.status === 'rejected') continue
    s.total++
    if (b.status === 'in_stock') s.stock++
  }
  const lotList = [...new Set(lots.rows.map((l) => l.lot_no).filter(Boolean))]

  const fields = [
    { name: 'mill_id', label: 'Mill', type: 'select', required: true, options: opts(mills.rows) },
    { name: 'grade_id', label: 'Grade / mesh', type: 'select', required: true, options: opts(grades.rows) },
    { name: 'mill_run_id', label: 'Mill run (optional)', type: 'select', options: opts(runs.rows, (r) => `${r.mills?.name ?? ''} - ${fmtDateTime(r.started_at)}`) },
    { name: 'inbound_lot_no', label: 'Quartz lot no. used', datalist: lotList, hint: 'Pick from the lots weighed in, or type one.' },
    { name: 'produced_on', label: 'Production date', type: 'date' },
    { name: 'tested_on', label: 'Lab test date', type: 'date' },
    { name: 'whiteness_pct', label: 'Whiteness (lab test, %)', type: 'number' },
    { name: 'sio2_pct', label: 'SiO2 %', type: 'number' },
    { name: 'fe2o3_pct', label: 'Fe2O3 %', type: 'number' },
    { name: 'moisture_pct', label: 'Moisture %', type: 'number' },
    { name: 'lab_report_url', label: 'Lab report link (URL)' },
    ...(canHold(role)
      ? [
          { name: 'qc_hold', label: 'QC hold (blocks dispatch of this batch)', type: 'checkbox' },
          { name: 'hold_reason', label: 'Reason for hold', showIf: (v) => v.qc_hold },
        ]
      : []),
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <DataPage
      title="Batches"
      table="batches"
      select="*, mills(name), grades(name, spec_min_sio2, spec_max_fe2o3, spec_max_moisture, spec_min_whiteness)"
      dateField="produced_on"
      fields={fields}
      defaults={{ produced_on: new Date().toLocaleDateString('en-CA') }}
      rowActions={(r) => <button className="link" onClick={() => certificate(r, name)}>Certificate</button>}
      extra={<p className="muted">A batch is one production lot with its lab results. The batch number is generated automatically. Pack its bags on the Bags tab. A supervisor can put a batch on QC hold if a test fails.</p>}
      columns={[
        { label: 'Batch', render: (r) => <strong>{r.batch_no}</strong> },
        { label: 'Date', render: (r) => fmtDate(r.produced_on) },
        { label: 'Mill', render: (r) => r.mills?.name },
        { label: 'Grade', render: (r) => r.grades?.name },
        { label: 'Lot', key: 'inbound_lot_no' },
        { label: 'Whiteness', render: (r) => r.whiteness_pct ?? '-' },
        { label: 'SiO2', render: (r) => r.sio2_pct ?? '-' },
        { label: 'Fe2O3', render: (r) => r.fe2o3_pct ?? '-' },
        { label: 'Moist.', render: (r) => r.moisture_pct ?? '-' },
        {
          label: 'Quality',
          render: (r) => {
            if (r.qc_hold) return <Badge tone="red">on hold</Badge>
            const c = checkSpec(r, effectiveSpec(null, r.grades))
            if (!c.limited) return '-'
            if (c.fails.length) return <Badge tone="red" >out of limits</Badge>
            if (c.untested.length) return <Badge tone="amber">not tested</Badge>
            return <Badge tone="green">within limits</Badge>
          },
        },
        { label: 'Bags (in stock / total)', render: (r) => `${stats[r.id]?.stock ?? 0} / ${stats[r.id]?.total ?? 0}` },
        { label: 'Lab report', render: (r) => (r.lab_report_url ? <a href={r.lab_report_url} target="_blank" rel="noreferrer">Open</a> : '-') },
      ]}
    />
  )
}
