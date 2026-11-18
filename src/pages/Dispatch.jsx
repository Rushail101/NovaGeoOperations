import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useRows, fmtKg, fmtDateTime, gradeLabel, bagNoFromScan, Modal, Form, toast, Badge } from '../lib.jsx'
import { printDispatchSlip } from '../print.js'
import { OutboxList } from '../Outbox.jsx'
import { callRpc, lookupBag, indexRemoveBags, uuid, useOnline } from '../offline.js'
import { checkSpec, effectiveSpec } from '../spec.js'
import Scanner from '../Scanner.jsx'
import { PhotoLink } from '../PhotoField.jsx'
import { AttachFiles } from '../Papers.jsx'

const TOLERANCE_PCT = 1 // warn when the weighbridge net differs from the sum of bag weights by more than this
const EMPTY = { vehicle: '', gross: '', tare: '', notes: '', invoice: '', eway: '', transporter: '', lr: '' }
const ewayOk = (v) => !v || /^\d{12}$/.test(v.trim())

function DocsForm({ row, onDone }) {
  const fields = [
    { name: 'invoice_no', label: 'Invoice no.' },
    { name: 'eway_bill_no', label: 'E-way bill no. (12 digits)' },
    { name: 'transporter', label: 'Transporter' },
    { name: 'lr_no', label: 'LR no.' },
    { name: 'transit_pass_no', label: 'Mineral transit pass no.', hint: 'From the Mines & Geology e-permit system' },
  ]
  async function submit(v) {
    if (!ewayOk(v.eway_bill_no) && !confirm('An e-way bill number is normally 12 digits. Save anyway?')) return
    const r = await callRpc('set_dispatch_docs', { p_id: row.id, p_invoice: v.invoice_no || null, p_eway: v.eway_bill_no || null, p_transporter: v.transporter || null, p_lr: v.lr_no || null, ...(v.transit_pass_no ? { p_transit: v.transit_pass_no } : {}) }, `Invoice details for ${row.vehicle_no || 'dispatch'}`)
    if (r.queued) toast('No connection. Saved on this device and will be sent automatically.')
    onDone()
  }
  return <Form grid fields={fields} initial={row} onSubmit={submit} />
}

// A bag is the wrong product if its grade differs, or the order names a mesh size and the batch is another one
const notMatching = (bag, order) =>
  bag.batches?.grade_id !== order.grade_id || (order.mesh_id && bag.batches?.mesh_id !== order.mesh_id)

export default function Dispatch() {
  const { name } = useAuth()
  const online = useOnline()
  const orders = useRows('orders', {
    select: 'id, order_no, qty_kg, status, grade_id, mesh_id, spec_min_sio2, spec_max_fe2o3, spec_max_moisture, spec_min_whiteness, customers(name), grades(name, spec_min_sio2, spec_max_fe2o3, spec_max_moisture, spec_min_whiteness), grade_meshes(mesh, spec_min_sio2, spec_max_fe2o3, spec_max_moisture, spec_min_whiteness)',
    order: 'created_at',
  })
  const progress = useRows('order_progress')
  const recent = useRows('weighments', { select: '*, orders(order_no, customers(name))', eq: ['type', 'dispatch'], order: 'weighed_at', limit: 30 })
  const [orderId, setOrderId] = useState('')
  const [bags, setBags] = useState([])
  const [input, setInput] = useState('')
  const [cam, setCam] = useState(false)
  const [msg, setMsg] = useState(null) // {tone, text}
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [docs, setDocs] = useState(null)
  const [attach, setAttach] = useState(null)

  const open = orders.rows.filter((o) => !['dispatched', 'cancelled'].includes(o.status))
  const order = open.find((o) => o.id === orderId)
  const spec = order ? effectiveSpec(order, order.grades, order.grade_meshes) : null
  const pending = progress.rows.find((p) => p.id === orderId)?.pending_kg
  const bagTotal = bags.reduce((a, b) => a + Number(b.weight_kg), 0)
  const net = f.gross !== '' && f.tare !== '' ? Number(f.gross) - Number(f.tare) : null
  const diff = net != null ? net - bagTotal : null
  const diffPct = diff != null && bagTotal > 0 ? (Math.abs(diff) / bagTotal) * 100 : null
  const setField = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const check = (b) => (spec ? checkSpec(b.batches, spec) : null)

  async function addBag(raw) {
    const no = bagNoFromScan(raw)
    if (!no) return
    setInput('')
    if (bags.some((b) => b.bag_no === no)) return setMsg({ tone: 'warn', text: `${no} is already on this load` })
    const { bag, error, local } = await lookupBag(no)
    if (error) return setMsg({ tone: 'error', text: error })
    if (bag.status !== 'in_stock') return setMsg({ tone: 'error', text: `${no} is ${bag.status.replace('_', ' ')}, cannot be dispatched` })
    if (bag.batches?.qc_hold) return setMsg({ tone: 'error', text: `${no} is in batch ${bag.batches.batch_no}, which is on QC hold${bag.batches.hold_reason ? ': ' + bag.batches.hold_reason : ''}` })
    setBags((p) => [...p, bag])
    const c = order ? checkSpec(bag.batches, effectiveSpec(order, order.grades, order.grade_meshes)) : null
    const mismatch = order && notMatching(bag, order)
    setMsg(
      mismatch ? { tone: 'warn', text: `${no} added, but its grade (${gradeLabel(bag.batches?.grades, bag.batches?.grade_meshes)}) is not the order's (${gradeLabel(order.grades, order.grade_meshes)})` }
      : c && c.fails.length ? { tone: 'warn', text: `${no} added, but outside the order's limits: ${c.fails.join('; ')}` }
      : c && c.untested.length ? { tone: 'warn', text: `${no} added, but not tested for ${c.untested.join(', ')}` }
      : { tone: 'ok', text: `${no} added - ${fmtKg(bag.weight_kg)}${local ? ' (from saved list)' : ''}` }
    )
  }

  async function submit(e) {
    e.preventDefault()
    if (!order) return alert('Pick an order')
    if (bags.length === 0) return alert('Add at least one bag')
    if (net == null || net <= 0) return alert('Enter gross and tare weights (gross must be more than tare)')
    const odd = bags.filter((b) => notMatching(b, order))
    if (odd.length && !confirm(`${odd.length} bag(s) are a different grade or mesh size than the order. Dispatch anyway?`)) return
    const off = bags.map((b) => ({ b, c: check(b) })).filter((x) => x.c && (x.c.fails.length || x.c.untested.length))
    let note = f.notes
    if (off.length) {
      const lines = [...new Set(off.map((x) => `${x.b.batches?.batch_no}: ${[...x.c.fails, ...x.c.untested.map((u) => u + ' not tested')].join('; ')}`))]
      if (!confirm(`These batches do not meet the order's limits:\n\n${lines.join('\n')}\n\nDispatch anyway?`)) return
      note = [note, `Limit override by ${name}: ${lines.join(' | ')}`].filter(Boolean).join('\n')
    }
    if (!ewayOk(f.eway) && !confirm('An e-way bill number is normally 12 digits. Continue anyway?')) return
    if (diffPct > TOLERANCE_PCT && !confirm(`Weighbridge net (${fmtKg(net)}) differs from bag total (${fmtKg(bagTotal)}) by ${diffPct.toFixed(1)}%. Dispatch anyway?`)) return

    setBusy(true)
    const id = uuid()
    const nos = bags.map((b) => b.bag_no)
    const args = { p_order: order.id, p_vehicle: f.vehicle || null, p_gross: Number(f.gross), p_tare: Number(f.tare), p_bag_nos: nos, p_notes: note || null, p_id: id, p_invoice: f.invoice || null, p_eway: f.eway || null, p_transporter: f.transporter || null, p_lr: f.lr || null }
    try {
      const r = await callRpc('dispatch_bags', args, `Dispatch ${f.vehicle || ''}: ${nos.length} bags to ${order.customers?.name}`)
      if (r.queued) {
        await indexRemoveBags(nos)
        toast('No connection. Dispatch saved on this device and will be sent automatically.')
      }
      setDone({
        no: 'D-' + id.slice(0, 8).toUpperCase(), date: new Date().toLocaleString('en-IN'), company: 'Nova Geo Resources',
        customer: order.customers?.name, order_no: order.order_no, grade: gradeLabel(order.grades, order.grade_meshes), vehicle: f.vehicle,
        gross: Number(f.gross), tare: Number(f.tare), net, bag_total: bagTotal, notes: note,
        invoice_no: f.invoice, eway_bill_no: f.eway, transporter: f.transporter, lr_no: f.lr,
        bags: bags.map((b) => ({ bag_no: b.bag_no, batch_no: b.batches?.batch_no, weight_kg: b.weight_kg })),
        queued: !!r.queued,
      })
      setBags([])
      setF(EMPTY)
      setMsg(null)
      orders.reload(); progress.reload(); recent.reload()
    } catch (ex) {
      setMsg({ tone: 'error', text: ex.message })
    }
    setBusy(false)
  }

  async function reprint(w) {
    const { data, error } = await supabase.from('bags').select('bag_no, weight_kg, batches(batch_no)').eq('dispatch_weighment_id', w.id).order('bag_no')
    if (error) return alert('Could not load the bags. This needs a connection.')
    printDispatchSlip(null, {
      no: 'D-' + w.id.slice(0, 8).toUpperCase(), date: fmtDateTime(w.weighed_at), company: 'Nova Geo Resources',
      customer: w.orders?.customers?.name, order_no: w.orders?.order_no, grade: '', vehicle: w.vehicle_no,
      gross: w.gross_kg, tare: w.tare_kg, net: w.net_kg, notes: w.notes, invoice_no: w.invoice_no, eway_bill_no: w.eway_bill_no,
      transporter: w.transporter, lr_no: w.lr_no,
      bags: data.map((b) => ({ bag_no: b.bag_no, batch_no: b.batches?.batch_no, weight_kg: b.weight_kg })), bag_total: data.reduce((a, b) => a + Number(b.weight_kg), 0),
    })
  }

  return (
    <section>
      <div className="head"><h2>Outbound shipments</h2></div>
      {!online && <div className="notice">No connection. Scanning uses the bag list saved on this device. The dispatch is sent automatically when the signal returns.</div>}
      <OutboxList filter={(i) => ['dispatch_bags', 'set_dispatch_docs'].includes(i.fn)} title="Dispatches saved offline, waiting to send" />

      {done && (
        <div className="card">
          <strong className="ok">{done.queued ? 'Saved on this device' : 'Dispatched'}: {done.bags.length} bags on {done.vehicle || 'vehicle'} ({done.no})</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => printDispatchSlip(null, done)}>Print dispatch slip</button>
            <button className="btn" onClick={() => setDone(null)}>Next truck</button>
          </div>
        </div>
      )}

      <form className="card form" onSubmit={submit}>
        <label><span>Order</span>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">-</option>
            {open.map((o) => <option key={o.id} value={o.id}>{o.order_no} - {o.customers?.name} - {gradeLabel(o.grades, o.grade_meshes)}</option>)}
          </select>
        </label>
        {order && (
          <div className="muted">
            Order {fmtKg(order.qty_kg)}, pending {fmtKg(pending ?? order.qty_kg)}, grade {gradeLabel(order.grades, order.grade_meshes)}
            {spec && Object.values(spec).some((x) => x != null) && (
              <> | limits: {[spec.min_whiteness != null && `whiteness >= ${spec.min_whiteness}`, spec.max_fe2o3 != null && `Fe2O3 <= ${spec.max_fe2o3}`, spec.min_sio2 != null && `SiO2 >= ${spec.min_sio2}`, spec.max_moisture != null && `moisture <= ${spec.max_moisture}`].filter(Boolean).join(', ')}</>
            )}
          </div>
        )}

        <div>
          <span className="muted">Bags on this load</span>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 4 }}>
            <input style={{ maxWidth: 260 }} placeholder="Type or scan bag no., press Enter" value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBag(input) } }} />
            <button type="button" className="btn" onClick={() => addBag(input)}>Add</button>
            <button type="button" className="btn" onClick={() => setCam(!cam)}>{cam ? 'Close camera' : 'Scan with camera'}</button>
          </div>
          {cam && <div style={{ marginTop: 8 }}><Scanner onScan={addBag} onClose={() => setCam(false)} /></div>}
          {msg && <div className={msg.tone === 'error' ? 'error' : msg.tone}>{msg.text}</div>}
        </div>

        {bags.length > 0 && (
          <div className="tablewrap">
            <table className="stack">
              <thead><tr><th>#</th><th>Bag</th><th>Batch</th><th>Grade</th><th>Limits</th><th>Weight</th><th /></tr></thead>
              <tbody>
                {bags.map((b, i) => {
                  const c = check(b)
                  return (
                    <tr key={b.bag_no}>
                      <td data-label="#">{i + 1}</td><td data-label="Bag">{b.bag_no}</td><td data-label="Batch">{b.batches?.batch_no}</td>
                      <td data-label="Grade" className={order && notMatching(b, order) ? 'warn' : ''}>{gradeLabel(b.batches?.grades, b.batches?.grade_meshes)}</td>
                      <td data-label="Limits">{!c || !c.limited ? '-' : c.fails.length ? <Badge tone="red">outside</Badge> : c.untested.length ? <Badge tone="amber">not tested</Badge> : <Badge tone="green">ok</Badge>}</td>
                      <td data-label="Weight">{fmtKg(b.weight_kg)}</td>
                      <td className="actions"><button type="button" className="link danger" onClick={() => setBags(bags.filter((x) => x.bag_no !== b.bag_no))}>Remove</button></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot><tr><td colSpan="5"><strong>{bags.length} bags</strong></td><td colSpan="2"><strong>{fmtKg(bagTotal)}</strong></td></tr></tfoot>
            </table>
          </div>
        )}

        <div className="split">
          <label><span>Vehicle no.</span><input value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value.toUpperCase() })} /></label>
          <label><span>Gross (kg)</span><input type="number" step="any" value={f.gross} onChange={setField('gross')} /></label>
          <label><span>Tare (kg)</span><input type="number" step="any" value={f.tare} onChange={setField('tare')} /></label>
        </div>
        {net != null && (
          <div>
            Net weighed <strong>{fmtKg(net)}</strong>, bag total <strong>{fmtKg(bagTotal)}</strong>,
            difference <strong className={diffPct > TOLERANCE_PCT ? 'warn' : 'ok'}>{fmtKg(diff)}{diffPct != null ? ` (${diffPct.toFixed(1)}%)` : ''}</strong>
          </div>
        )}
        <div className="split">
          <label><span>Invoice no. (from the finance app)</span><input value={f.invoice} onChange={setField('invoice')} /></label>
          <label><span>E-way bill no.</span><input inputMode="numeric" value={f.eway} onChange={setField('eway')} /></label>
          <label><span>Transporter</span><input value={f.transporter} onChange={setField('transporter')} /></label>
          <label><span>LR no.</span><input value={f.lr} onChange={setField('lr')} /></label>
        </div>
        <small className="muted">Invoice and e-way bill can also be added after the truck leaves, from the list below.</small>
        <label><span>Notes</span><textarea rows={2} value={f.notes} onChange={setField('notes')} /></label>
        <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Confirm dispatch'}</button></div>
      </form>

      <h2>Recent dispatches</h2>
      {recent.stale && <div className="notice">No connection. Showing the list as last saved on this device.</div>}
      {recent.rows.length === 0 ? <div className="empty">No dispatches yet.</div> : (
        <div className="tablewrap">
          <table className="stack">
            <thead><tr><th>When</th><th>Customer</th><th>Order</th><th>Vehicle</th><th>Net</th><th>Invoice</th><th>E-way bill</th><th>Files</th><th /></tr></thead>
            <tbody>
              {recent.rows.map((w) => (
                <tr key={w.id}>
                  <td data-label="When">{fmtDateTime(w.weighed_at)}</td>
                  <td data-label="Customer">{w.orders?.customers?.name || '-'}</td>
                  <td data-label="Order">{w.orders?.order_no || '-'}</td>
                  <td data-label="Vehicle">{w.vehicle_no || '-'}</td>
                  <td data-label="Net">{fmtKg(w.net_kg)}</td>
                  <td data-label="Invoice">{w.invoice_no || <span className="warn">missing</span>}</td>
                  <td data-label="E-way bill">{w.eway_bill_no || <span className="warn">missing</span>}</td>
                  <td data-label="Files"><PhotoLink paths={w.doc_paths} /></td>
                  <td className="actions">
                    <button className="link" onClick={() => setDocs(w)}>Invoice / e-way</button>
                    <button className="link" onClick={() => setAttach(w)}>Attach files</button>
                    <button className="link" onClick={() => reprint(w)}>Slip</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {attach && (
        <Modal title={`Papers: ${attach.vehicle_no || 'dispatch'}`} onClose={() => setAttach(null)}>
          <AttachFiles row={attach} folder="dispatch" hint="Invoice copy from the finance app, e-way bill, LR copy, lab certificate." onDone={() => { setAttach(null); recent.reload() }} />
        </Modal>
      )}
      {docs && (
        <Modal title={`Invoice and e-way bill: ${docs.vehicle_no || 'dispatch'}`} onClose={() => setDocs(null)}>
          <DocsForm row={docs} onDone={() => { setDocs(null); recent.reload() }} />
        </Modal>
      )}
    </section>
  )
}
