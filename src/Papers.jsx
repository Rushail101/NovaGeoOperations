import { useState } from 'react'
import { supabase } from './supabase.js'
import { isNetworkError } from './offline.js'
import PhotoField, { PhotoLink } from './PhotoField.jsx'
import { Form, toast, clean } from './lib.jsx'
import { callRpc } from './offline.js'

// Attach scanned papers (PDF or photo) to an existing weighment. Needs a connection because of the upload.
export function AttachFiles({ row, folder, hint, onDone }) {
  const [paths, setPaths] = useState([])
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('add_weighment_docs', { p_id: row.id, p_paths: paths })
    setBusy(false)
    if (error) return setErr(isNetworkError(error) ? 'No connection. Try again when you have signal.' : error.message)
    toast('Files saved')
    onDone()
  }
  return (
    <div className="form">
      {hint && <p className="muted" style={{ margin: 0 }}>{hint}</p>}
      {row.doc_paths?.length > 0 && <div><span className="tag">Already attached:</span> <PhotoLink paths={row.doc_paths} /></div>}
      <PhotoField docs value={paths} onChange={setPaths} folder={folder} />
      {err && <div className="error">{err}</div>}
      <div className="row"><button className="btn primary" disabled={!paths.length || busy} onClick={save}>{busy ? 'Saving...' : 'Save files'}</button></div>
    </div>
  )
}

// Fill in or correct inbound paperwork after weighing (the weighbridge cannot edit weighments directly, this goes through a safe function)
export function InboundPapersForm({ row, onDone }) {
  const fields = [
    { name: 'supplier_invoice_no', label: 'Supplier invoice no.' },
    { name: 'supplier_invoice_date', label: 'Invoice date', type: 'date' },
    { name: 'permit_no', label: 'Transit permit no.' },
    { name: 'permit_qty_kg', label: 'Quantity on permit (kg)', type: 'number' },
    { name: 'permit_valid_until', label: 'Permit valid until', type: 'date' },
    { name: 'eway_bill_no', label: 'E-way bill no. (if any)' },
  ]
  async function submit(v) {
    const p = clean(v, fields)
    const r = await callRpc('set_inbound_docs', {
      p_id: row.id, p_invoice_no: p.supplier_invoice_no, p_invoice_date: p.supplier_invoice_date, p_permit_no: p.permit_no,
      p_permit_qty: p.permit_qty_kg, p_permit_valid: p.permit_valid_until, p_eway: p.eway_bill_no,
    }, `Papers for ${row.vehicle_no || 'inbound load'}`)
    if (r.queued) toast('No connection. Saved on this device and will be sent automatically.')
    onDone()
  }
  return (
    <>
      <Form grid fields={fields} initial={row} onSubmit={submit} />
      <h3 style={{ margin: '18px 0 8px' }}>Scanned copies</h3>
      <AttachFiles row={row} folder="inbound" onDone={onDone} />
    </>
  )
}
