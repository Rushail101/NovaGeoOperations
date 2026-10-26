import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useRows, fmtKg } from '../lib.jsx'
import { printDispatchSlip } from '../print.js'
import Scanner from '../Scanner.jsx'

const TOLERANCE_PCT = 1 // warn when the weighbridge net differs from the sum of bag weights by more than this

export default function Dispatch() {
  const orders = useRows('orders', { select: 'id, order_no, qty_kg, status, grade_id, customers(name), grades(name)', order: 'created_at' })
  const progress = useRows('order_progress')
  const [orderId, setOrderId] = useState('')
  const [bags, setBags] = useState([])
  const [input, setInput] = useState('')
  const [cam, setCam] = useState(false)
  const [msg, setMsg] = useState(null) // {tone, text}
  const [f, setF] = useState({ vehicle: '', gross: '', tare: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const open = orders.rows.filter((o) => !['dispatched', 'cancelled'].includes(o.status))
  const order = open.find((o) => o.id === orderId)
  const pending = progress.rows.find((p) => p.id === orderId)?.pending_kg
  const bagTotal = bags.reduce((a, b) => a + Number(b.weight_kg), 0)
  const net = f.gross !== '' && f.tare !== '' ? Number(f.gross) - Number(f.tare) : null
  const diff = net != null ? net - bagTotal : null
  const diffPct = diff != null && bagTotal > 0 ? (Math.abs(diff) / bagTotal) * 100 : null

  async function addBag(raw) {
    const no = raw.trim().toUpperCase()
    if (!no) return
    setInput('')
    if (bags.some((b) => b.bag_no === no)) return setMsg({ tone: 'warn', text: `${no} is already on this load` })
    const { data, error } = await supabase
      .from('bags')
      .select('*, batches(batch_no, grade_id, grades(name))')
      .eq('bag_no', no)
      .maybeSingle()
    if (error) return setMsg({ tone: 'error', text: error.message })
    if (!data) return setMsg({ tone: 'error', text: `${no}: no such bag` })
    if (data.status !== 'in_stock') return setMsg({ tone: 'error', text: `${no} is ${data.status.replace('_', ' ')}, cannot be dispatched` })
    const mismatch = order && data.batches?.grade_id !== order.grade_id
    setBags((p) => [...p, data])
    setMsg(
      mismatch
        ? { tone: 'warn', text: `${no} added, but its grade (${data.batches?.grades?.name}) is not the order grade (${order.grades?.name})` }
        : { tone: 'ok', text: `${no} added - ${fmtKg(data.weight_kg)}` }
    )
  }

  async function submit(e) {
    e.preventDefault()
    if (!order) return alert('Pick an order')
    if (bags.length === 0) return alert('Add at least one bag')
    if (net == null || net <= 0) return alert('Enter gross and tare weights (gross must be more than tare)')
    const odd = bags.filter((b) => b.batches?.grade_id !== order.grade_id)
    if (odd.length && !confirm(`${odd.length} bag(s) are a different grade than the order. Dispatch anyway?`)) return
    if (diffPct > TOLERANCE_PCT && !confirm(`Weighbridge net (${fmtKg(net)}) differs from bag total (${fmtKg(bagTotal)}) by ${diffPct.toFixed(1)}%. Dispatch anyway?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('dispatch_bags', {
      p_order: order.id,
      p_vehicle: f.vehicle || null,
      p_gross: Number(f.gross),
      p_tare: Number(f.tare),
      p_bag_nos: bags.map((b) => b.bag_no),
      p_notes: f.notes || null,
    })
    setBusy(false)
    if (error) return setMsg({ tone: 'error', text: error.message })
    setDone({
      no: 'D-' + String(data).slice(0, 8).toUpperCase(),
      date: new Date().toLocaleString('en-IN'),
      company: 'Nova Geo Resources',
      customer: order.customers?.name,
      order_no: order.order_no,
      grade: order.grades?.name,
      vehicle: f.vehicle,
      gross: Number(f.gross),
      tare: Number(f.tare),
      net,
      bags: bags.map((b) => ({ bag_no: b.bag_no, batch_no: b.batches?.batch_no, weight_kg: b.weight_kg })),
      bag_total: bagTotal,
      notes: f.notes,
    })
    setBags([])
    setF({ vehicle: '', gross: '', tare: '', notes: '' })
    setMsg(null)
    orders.reload()
    progress.reload()
  }

  return (
    <section>
      <div className="head"><h2>Dispatch</h2></div>

      {done && (
        <div className="card">
          <strong className="ok">Dispatched {done.bags.length} bags on {done.vehicle || 'vehicle'} ({done.no})</strong>
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
            {open.map((o) => <option key={o.id} value={o.id}>{o.order_no} - {o.customers?.name} - {o.grades?.name}</option>)}
          </select>
        </label>
        {order && <div className="muted">Order {fmtKg(order.qty_kg)}, pending {fmtKg(pending ?? order.qty_kg)}, grade {order.grades?.name}</div>}

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
            <table>
              <thead><tr><th>#</th><th>Bag</th><th>Batch</th><th>Grade</th><th>Weight</th><th /></tr></thead>
              <tbody>
                {bags.map((b, i) => (
                  <tr key={b.id}>
                    <td>{i + 1}</td><td>{b.bag_no}</td><td>{b.batches?.batch_no}</td>
                    <td className={order && b.batches?.grade_id !== order.grade_id ? 'warn' : ''}>{b.batches?.grades?.name}</td>
                    <td>{fmtKg(b.weight_kg)}</td>
                    <td className="actions"><button type="button" className="link danger" onClick={() => setBags(bags.filter((x) => x.id !== b.id))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan="4"><strong>{bags.length} bags</strong></td><td colSpan="2"><strong>{fmtKg(bagTotal)}</strong></td></tr></tfoot>
            </table>
          </div>
        )}

        <div className="split">
          <label><span>Vehicle no.</span><input value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value.toUpperCase() })} /></label>
          <label><span>Gross (kg)</span><input type="number" step="any" value={f.gross} onChange={(e) => setF({ ...f, gross: e.target.value })} /></label>
          <label><span>Tare (kg)</span><input type="number" step="any" value={f.tare} onChange={(e) => setF({ ...f, tare: e.target.value })} /></label>
        </div>
        {net != null && (
          <div>
            Net weighed <strong>{fmtKg(net)}</strong>, bag total <strong>{fmtKg(bagTotal)}</strong>,
            difference <strong className={diffPct > TOLERANCE_PCT ? 'warn' : 'ok'}>{fmtKg(diff)}{diffPct != null ? ` (${diffPct.toFixed(1)}%)` : ''}</strong>
          </div>
        )}
        <label><span>Notes</span><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Confirm dispatch'}</button></div>
      </form>
    </section>
  )
}
