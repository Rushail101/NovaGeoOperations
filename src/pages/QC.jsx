import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useRows, DataPage, fmtDate, fmtDateTime, fmtKg, gradeLabel, certUrl, bagNoFromScan, Badge, toast } from '../lib.jsx'
import { can } from '../perms.js'
import { printLabels, openPrintWindow } from '../print.js'
import { buildCoa } from '../coa.js'
import Batches, { certificate } from './Batches.jsx'
import Lab from './Lab.jsx'

const BAG_SELECT = 'id, bag_no, weight_kg, bag_type, packed_at, batch_id, batches(batch_no, cert_token, grades(name), grade_meshes(mesh))'
const pouchLabel = (b) => ({
  bag_no: b.bag_no, kind: 'pouch', batch_no: b.batches?.batch_no, grade: gradeLabel(b.batches?.grades, b.batches?.grade_meshes),
  cert_url: certUrl(b.bag_no, b.batches?.cert_token), packed_on: fmtDate(b.packed_at),
})

function PouchForm({ onDone }) {
  const batches = useRows('batches', { select: 'id, batch_no, grades(name), grade_meshes(mesh)', order: 'created_at', limit: 300 })
  const [lot, setLot] = useState('')
  const [single, setSingle] = useState('')
  const [loc, setLoc] = useState('')
  const [print, setPrint] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function make(bags) {
    if (!bags.length) return setErr('No bags found.')
    const ids = bags.map((b) => b.id)
    const { data: have } = await supabase.from('qc_samples').select('bag_id').in('bag_id', ids)
    const had = new Set((have || []).map((x) => x.bag_id))
    const w = print ? openPrintWindow('QC pouch labels') : null
    const { data: n, error } = await supabase.rpc('create_qc_samples', { p_bag_ids: ids, p_location: loc })
    if (error) { w?.close(); throw error }
    const fresh = bags.filter((b) => !had.has(b.id))
    toast(n ? `${n} pouch record${n > 1 ? 's' : ''} created` : 'Those bags already have a pouch record')
    if (w) {
      if (fresh.length) await printLabels(w, fresh.map(pouchLabel), { layout: 'sheet' })
      else w.close()
    }
    onDone()
  }

  async function forLot() {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.from('bags').select(BAG_SELECT).eq('batch_id', lot).neq('status', 'rejected').order('bag_no').limit(2000)
      if (error) throw error
      await make(data)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  async function forBag() {
    const no = bagNoFromScan(single)
    if (!no) return setErr('Type or scan a bag number like NG-261027-0001')
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.from('bags').select(BAG_SELECT).eq('bag_no', no).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('No bag with that number')
      await make([data])
      setSingle('')
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="card form">
      <strong>Make 1 kg QC pouch records</strong>
      <p className="muted" style={{ margin: 0 }}>Each pouch gets the same serial number as its bag, and its label carries the same QR, so the lab report you attach to that serial opens from either one. Needs a connection.</p>
      <div className="split">
        <label><span>Lot</span>
          <select value={lot} onChange={(e) => setLot(e.target.value)}>
            <option value="">-</option>
            {batches.rows.map((b) => <option key={b.id} value={b.id}>{b.batch_no} - {gradeLabel(b.grades, b.grade_meshes)}</option>)}
          </select>
        </label>
        <label><span>Where the pouches are kept (optional)</span><input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Shelf A, box 3" /></label>
      </div>
      <label className="check"><input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} /><span>Print pouch labels now</span></label>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn primary" disabled={!lot || busy} onClick={forLot}>Create for every bag in this lot</button>
        <span className="muted">or one bag:</span>
        <input style={{ maxWidth: 220 }} placeholder="NG-261027-0001" value={single} onChange={(e) => setSingle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), forBag())} />
        <button className="btn" disabled={busy} onClick={forBag}>Add</button>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  )
}

const statusTone = { retained: 'green', used: 'grey', discarded: 'red' }

function Pouches() {
  const { role } = useAuth()
  const reports = useRows('lab_reports', { select: 'id, batch_id, bag_id, status', limit: 5000 })
  const [key, setKey] = useState(0)
  const reportState = (r) => {
    const own = reports.rows.filter((x) => x.bag_id === r.bag_id)
    if (own.some((x) => x.status === 'approved')) return <Badge tone="green">bag report approved</Badge>
    if (own.length) return <Badge tone="amber">bag report in draft</Badge>
    if (reports.rows.some((x) => x.batch_id === r.batch_id && !x.bag_id && x.status === 'approved')) return <Badge tone="blue">lot report</Badge>
    return <span className="muted">none yet</span>
  }
  return (
    <>
      {can(role, 'qc_samples', 'insert') && <PouchForm onDone={() => setKey((k) => k + 1)} />}
      <DataPage
        key={key}
        title="QC pouches"
        table="qc_samples"
        select={`*, bags(bag_no, weight_kg, bag_type, packed_at), batches(batch_no, cert_token, grades(name), grade_meshes(mesh))`}
        order="created_at"
        addable={false}
        canDelete={false}
        fields={[
          { name: 'location', label: 'Where kept' },
          { name: 'status', label: 'Status', type: 'select', required: true, options: ['retained', 'used', 'discarded'].map((v) => ({ value: v, label: v })) },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        rowActions={(r) => (
          <button className="link" onClick={() => printLabels(null, [pouchLabel({ ...r.bags, bag_no: r.sample_no, batches: r.batches })], { layout: 'sheet' })}>Label</button>
        )}
        columns={[
          { label: 'Serial no.', render: (r) => <strong>{r.sample_no}</strong> },
          { label: 'Lot', render: (r) => r.batches?.batch_no },
          { label: 'Product', render: (r) => gradeLabel(r.batches?.grades, r.batches?.grade_meshes) },
          { label: 'Pouch', render: (r) => fmtKg(r.pouch_kg) },
          { label: 'Kept at', render: (r) => r.location || '-' },
          { label: 'Status', render: (r) => <Badge tone={statusTone[r.status]}>{r.status}</Badge> },
          { label: 'Report', render: (r) => reportState(r) },
          { label: 'Made', render: (r) => fmtDateTime(r.created_at) },
        ]}
      />
    </>
  )
}

// PDFs named by lot / bag number
function Reports() {
  const { name } = useAuth()
  const batches = useRows('batches', { select: '*, mills(name), grades(name, spec_min_sio2, spec_max_fe2o3, spec_max_moisture, spec_min_whiteness), grade_meshes(mesh, spec_min_sio2, spec_max_fe2o3, spec_max_moisture, spec_min_whiteness)', order: 'created_at', limit: 300 })
  const [lot, setLot] = useState('')
  const [bagNo, setBagNo] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const b = batches.rows.find((x) => x.id === lot)

  async function bagCert() {
    const no = bagNoFromScan(bagNo)
    if (!no) return setMsg('Type a bag number like NG-261027-0001')
    setBusy(true); setMsg(null)
    try {
      const { data: bag, error } = await supabase.from('bags').select('bag_no, batches(cert_token)').eq('bag_no', no).maybeSingle()
      if (error) throw error
      if (!bag) throw new Error('No bag with that number')
      const { data: c, error: e2 } = await supabase.rpc('public_bag_certificate', { p_bag_no: no, p_token: bag.batches?.cert_token })
      if (e2) throw e2
      if (!c) throw new Error('No certificate for that bag')
      if (c.held) throw new Error('That bag is in a lot on QC hold')
      const report = { ...(c.report || {}), sio2_pct: c.sio2_pct, fe2o3_pct: c.fe2o3_pct, moisture_pct: c.moisture_pct, whiteness_pct: c.whiteness_pct, tested_on: c.report?.tested_on || c.tested_on }
      const { exportReport } = await import('../pdf.js')
      await exportReport(buildCoa({ report, batch: { batch_no: c.batch_no, produced_on: c.produced_on }, bag: { bag_no: c.bag_no }, grade: { name: c.grade }, mesh: c.mesh ? { mesh: c.mesh } : null, limits: c.limits }), { user: name, filename: `certificate-${c.batch_no}-${c.bag_no}` })
    } catch (e) { setMsg(e.message) }
    setBusy(false)
  }

  async function register() {
    const { exportReport } = await import('../pdf.js')
    const rows = batches.rows.map((x) => [x.batch_no, fmtDate(x.produced_on), gradeLabel(x.grades, x.grade_meshes), x.whiteness_pct ?? '-', x.sio2_pct ?? '-', x.fe2o3_pct ?? '-', x.moisture_pct ?? '-', x.qc_hold ? 'ON HOLD' : ''])
    await exportReport({ title: 'QC register', subtitle: `${rows.length} lots`, sections: [{ columns: ['Lot', 'Date', 'Product', 'Whiteness', 'SiO2', 'Fe2O3', 'Moisture', 'Hold'].map((h, i) => ({ header: h, align: i > 2 && i < 7 ? 'right' : undefined })), rows }] }, { user: name, filename: 'qc-register' })
  }

  return (
    <div>
      <div className="card form">
        <strong>Lot certificate</strong>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={{ maxWidth: 340 }} value={lot} onChange={(e) => setLot(e.target.value)}>
            <option value="">Pick a lot</option>
            {batches.rows.map((x) => <option key={x.id} value={x.id}>{x.batch_no} - {gradeLabel(x.grades, x.grade_meshes)}</option>)}
          </select>
          <button className="btn primary" disabled={!b} onClick={() => certificate(b, name)}>Download PDF</button>
        </div>
        <small className="muted">Results for the lot and the list of all its bags. File name carries the lot number.</small>
      </div>
      <div className="card form">
        <strong>Bag certificate</strong>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ maxWidth: 260 }} placeholder="NG-261027-0001" value={bagNo} onChange={(e) => setBagNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && bagCert()} />
          <button className="btn primary" disabled={busy} onClick={bagCert}>Download PDF</button>
        </div>
        <small className="muted">The same certificate a customer sees when they scan the bag (the bag's own test if there is one, otherwise the lot's). File name carries the lot and bag numbers.</small>
        {msg && <div className="error">{msg}</div>}
      </div>
      <div className="card form">
        <strong>QC register</strong>
        <div className="row"><button className="btn" disabled={!batches.rows.length} onClick={register}>Download all lots as PDF</button></div>
        <small className="muted">Individual lab reports download from the Lab reports tab (Report PDF), and the pouch list from the Pouches tab (PDF button).</small>
      </div>
    </div>
  )
}

export default function QC() {
  const [tab, setTab] = useState('Lots')
  const tabs = { Lots: Batches, 'Lab reports': Lab, Pouches, Reports }
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
