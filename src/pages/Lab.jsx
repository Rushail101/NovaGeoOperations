import { DataPage, useRows, fmtDate, fmtNum, todayIso, gradeLabel, Badge } from '../lib.jsx'
import { useAuth } from '../auth.jsx'
import { canApproveLab } from '../perms.js'
import { supabase } from '../supabase.js'
import { PhotoLink } from '../PhotoField.jsx'
import { checkSpec, effectiveSpec } from '../spec.js'
import { buildCoa } from '../coa.js'
import { useMemo } from 'react'

const num = (name, label, hint) => ({ name, label, type: 'number', ...(hint ? { hint } : {}) })
const BATCH_SELECT = 'batch_no, produced_on, grades(name, spec_min_sio2, spec_max_fe2o3, spec_max_moisture, spec_min_whiteness), grade_meshes(mesh, spec_min_sio2, spec_max_fe2o3, spec_max_moisture, spec_min_whiteness)'

async function reportPdf(r, user) {
  const limits = effectiveSpec(null, r.batches?.grades, r.batches?.grade_meshes)
  const { exportReport } = await import('../pdf.js')
  await exportReport(
    buildCoa({ report: r, batch: r.batches, bag: r.bags, grade: r.batches?.grades, mesh: r.batches?.grade_meshes, limits, approved: r.status === 'approved' }),
    { user, filename: `lab-report-${r.batches?.batch_no ?? ''}${r.bags?.bag_no ? '-' + r.bags.bag_no : ''}-${r.report_no}` }
  )
}

export default function Lab() {
  const { role, name } = useAuth()
  const batches = useRows('batches', { select: 'id, batch_no, grades(name), grade_meshes(mesh)', order: 'created_at', limit: 300 })
  const bagRows = useRows('bags', { select: 'id, bag_no, batch_id', order: 'bag_no', asc: true, limit: 5000 })
  const bagsOf = useMemo(() => {
    const m = {}
    for (const b of bagRows.rows) (m[b.batch_id] ||= []).push({ value: b.id, label: b.bag_no })
    return m
  }, [bagRows.rows])

  const fields = [
    { name: 'batch_id', label: 'Lot / batch tested', type: 'select', required: true, options: batches.rows.map((b) => ({ value: b.id, label: `${b.batch_no} - ${gradeLabel(b.grades, b.grade_meshes)}` })) },
    { name: 'bag_id', label: 'Bag serial no. (leave empty to test the whole lot)', type: 'select', optionsFor: (v) => bagsOf[v.batch_id] || [], hint: 'Pick a bag if this result is for that one bag; it is then shown on that bag\'s QR page.' },
    { name: 'tested_on', label: 'Test date', type: 'date', required: true },
    { name: 'sampled_at', label: 'Sample taken at', type: 'datetime-local' },
    { name: 'sample_ref', label: 'Sample reference' },
    { name: 'lab_name', label: 'Laboratory', required: true, hint: 'Your own lab, or the name of an outside lab if you are uploading their report.' },
    { name: 'tested_by', label: 'Tested by' },
    num('sio2_pct', 'SiO2 (%)'),
    num('fe2o3_pct', 'Fe2O3 (%)'),
    num('al2o3_pct', 'Al2O3 (%)'),
    num('tio2_pct', 'TiO2 (%)'),
    num('cao_pct', 'CaO (%)'),
    num('loi_pct', 'Loss on ignition (%)'),
    num('moisture_pct', 'Moisture (%)'),
    num('whiteness_pct', 'Whiteness / brightness (%)'),
    num('d50_um', 'Particle size D50 (micron)'),
    num('d97_um', 'Particle size D97 (micron)'),
    num('residue_pct', 'Residue on sieve (%)'),
    num('bulk_density', 'Bulk density (g/cc)'),
    { name: 'remarks', label: 'Remarks', type: 'textarea' },
    { name: 'doc_paths', label: 'Upload a report (PDF or photo), for example from an outside lab', type: 'docs', folder: 'lab' },
  ]

  const verdict = (r) => {
    const c = checkSpec(r, effectiveSpec(null, r.batches?.grades, r.batches?.grade_meshes))
    return !c.limited ? <span className="muted">no limits set</span> : c.fails.length ? <Badge tone="red">outside limits</Badge> : c.untested.length ? <Badge tone="amber">not all tested</Badge> : <Badge tone="green">within limits</Badge>
  }

  async function setStatus(r, status, reload) {
    const { error } = await supabase.from('lab_reports').update({ status }).eq('id', r.id)
    if (error) alert(error.message)
    reload()
  }

  return (
    <DataPage
      title="Lab reports"
      table="lab_reports"
      select={`*, batches(${BATCH_SELECT}), bags(bag_no)`}
      order="tested_on"
      dateField="tested_on"
      offline
      offlineLabel={(p) => `Lab report: ${p.lab_name || ''}`}
      defaults={{ tested_on: todayIso(), lab_name: 'Nova Geo in-house lab', tested_by: name }}
      fields={fields}
      extra={<p className="muted">Enter the results of each test, or upload a report from an outside lab. A supervisor approves it; a whole-lot report fills the lot's lab values, a bag report shows on that bag's QR page. Either can be printed as a Certificate of Analysis. Approved reports are locked.</p>}
      rowActions={(r, reload) => (
        <>
          <button className="link" onClick={() => reportPdf(r, name)}>Report PDF</button>
          {canApproveLab(role) && r.status === 'draft' && <button className="link" onClick={() => setStatus(r, 'approved', reload)}>Approve</button>}
          {role === 'admin' && r.status === 'approved' && <button className="link" onClick={() => setStatus(r, 'draft', reload)}>Reopen</button>}
        </>
      )}
      columns={[
        { label: 'Report', render: (r) => <strong>{r.report_no}</strong> },
        { label: 'Date', render: (r) => fmtDate(r.tested_on) },
        { label: 'Lot', render: (r) => r.batches?.batch_no },
        { label: 'Bag', render: (r) => r.bags?.bag_no || 'whole lot' },
        { label: 'Product', render: (r) => gradeLabel(r.batches?.grades, r.batches?.grade_meshes) },
        { label: 'Lab', key: 'lab_name' },
        { label: 'Whiteness', render: (r) => (r.whiteness_pct != null ? fmtNum(r.whiteness_pct) : '-') },
        { label: 'SiO2', render: (r) => (r.sio2_pct != null ? fmtNum(r.sio2_pct, 3) : '-') },
        { label: 'Fe2O3', render: (r) => (r.fe2o3_pct != null ? fmtNum(r.fe2o3_pct, 4) : '-') },
        { label: 'Moisture', render: (r) => (r.moisture_pct != null ? fmtNum(r.moisture_pct) : '-') },
        { label: 'Result', render: verdict },
        { label: 'Status', render: (r) => <Badge tone={r.status === 'approved' ? 'green' : 'amber'}>{r.status}</Badge> },
        { label: 'Files', render: (r) => <PhotoLink paths={r.doc_paths} /> },
      ]}
    />
  )
}
