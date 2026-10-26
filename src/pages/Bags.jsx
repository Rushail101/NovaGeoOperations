import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { canPack, can } from '../perms.js'
import { useRows, fmtKg, fmtDate, fmtDateTime, Badge } from '../lib.jsx'
import { openPrintWindow, printLabels } from '../print.js'
import Scanner from '../Scanner.jsx'

const tone = { in_stock: 'green', dispatched: 'grey', rejected: 'red' }

const labelOf = (b) => ({
  bag_no: b.bag_no,
  bag_type: b.bag_type,
  weight_kg: b.weight_kg,
  batch_no: b.batches?.batch_no,
  grade: b.batches?.grades?.name,
  packed_on: fmtDate(b.packed_at),
})

function PackForm({ onDone }) {
  const batches = useRows('batches', { select: 'id, batch_no, grades(name)', order: 'created_at', limit: 100 })
  const [v, setV] = useState({ batch: '', type: 'bag', weight: '25', count: '10', print: true, layout: 'sheet' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, x) => setV((p) => ({ ...p, [k]: x }))

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const w = v.print ? openPrintWindow('Bag labels') : null
    const { data, error } = await supabase.rpc('create_bags', {
      p_batch: v.batch,
      p_type: v.type,
      p_weight: Number(v.weight),
      p_count: Number(v.count),
    })
    setBusy(false)
    if (error) {
      w?.close()
      return setErr(error.message)
    }
    const b = batches.rows.find((x) => x.id === v.batch)
    if (w)
      await printLabels(
        w,
        data.map((x) => ({ ...labelOf({ ...x, batches: b }) })),
        { layout: v.layout }
      )
    onDone()
  }

  return (
    <form className="card form" onSubmit={submit}>
      <strong>Pack bags (numbers are generated automatically)</strong>
      <div className="split">
        <label><span>Batch</span>
          <select required value={v.batch} onChange={(e) => set('batch', e.target.value)}>
            <option value="">-</option>
            {batches.rows.map((b) => <option key={b.id} value={b.id}>{b.batch_no} - {b.grades?.name}</option>)}
          </select>
        </label>
        <label><span>Type</span>
          <select value={v.type} onChange={(e) => set('type', e.target.value)}>
            <option value="bag">Bag</option><option value="jumbo">Jumbo bag</option>
          </select>
        </label>
        <label><span>Weight per bag (kg)</span><input type="number" step="any" required value={v.weight} onChange={(e) => set('weight', e.target.value)} /></label>
        <label><span>How many bags</span><input type="number" min="1" max="500" required value={v.count} onChange={(e) => set('count', e.target.value)} /></label>
      </div>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="check"><input type="checkbox" checked={v.print} onChange={(e) => set('print', e.target.checked)} /><span>Print QR labels now</span></label>
        <select style={{ width: 'auto' }} value={v.layout} onChange={(e) => set('layout', e.target.value)}>
          <option value="sheet">A4 sheet (3 columns)</option>
          <option value="label">Label printer (70 x 50 mm)</option>
        </select>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Creating...' : 'Create bags'}</button></div>
    </form>
  )
}

function Trace() {
  const [no, setNo] = useState('')
  const [cam, setCam] = useState(false)
  const [res, setRes] = useState(null)
  const [msg, setMsg] = useState(null)

  async function find(n) {
    const bagNo = (n ?? no).trim().toUpperCase()
    if (!bagNo) return
    setNo(bagNo)
    setMsg(null)
    const { data, error } = await supabase
      .from('bags')
      .select('*, batches(*, grades(name), mills(name)), orders(order_no, customers(name)), weighments(vehicle_no, weighed_at, net_kg)')
      .eq('bag_no', bagNo)
      .maybeSingle()
    if (error) return setMsg(error.message)
    if (!data) return setMsg('No bag with that number')
    setRes(data)
  }

  return (
    <div className="card">
      <strong>Trace a bag</strong>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <input style={{ maxWidth: 260 }} placeholder="NG-261027-0001" value={no} onChange={(e) => setNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} />
        <button className="btn" onClick={() => find()}>Find</button>
        <button className="btn" onClick={() => setCam(!cam)}>{cam ? 'Close camera' : 'Scan QR'}</button>
      </div>
      {cam && <div style={{ marginTop: 8 }}><Scanner onScan={(t) => { find(t); setCam(false) }} onClose={() => setCam(false)} /></div>}
      {msg && <div className="error">{msg}</div>}
      {res && (
        <div style={{ marginTop: 10 }}>
          <div><strong>{res.bag_no}</strong> <Badge tone={tone[res.status]}>{res.status.replace('_', ' ')}</Badge> {res.bag_type} - {fmtKg(res.weight_kg)}, packed {fmtDateTime(res.packed_at)}</div>
          <div className="muted">
            Batch {res.batches?.batch_no} | {res.batches?.grades?.name} | {res.batches?.mills?.name} | produced {fmtDate(res.batches?.produced_on)}
            {res.batches?.inbound_lot_no ? ` | quartz lot ${res.batches.inbound_lot_no}` : ''}
          </div>
          <div className="muted">
            SiO2 {res.batches?.sio2_pct ?? '-'} % | Fe2O3 {res.batches?.fe2o3_pct ?? '-'} % | moisture {res.batches?.moisture_pct ?? '-'} %
            {res.batches?.lab_report_url && <> | <a href={res.batches.lab_report_url} target="_blank" rel="noreferrer">lab report</a></>}
          </div>
          {res.status === 'dispatched' && (
            <div className="muted">Dispatched {fmtDateTime(res.dispatched_at)} to {res.orders?.customers?.name} (order {res.orders?.order_no}), vehicle {res.weighments?.vehicle_no}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Bags() {
  const { role } = useAuth()
  const { rows, loading, error, reload } = useRows('bags', {
    select: '*, batches(batch_no, grades(name)), orders(order_no), packer:profiles!packed_by(full_name, username)',
    order: 'packed_at',
    limit: 500,
  })
  const [status, setStatus] = useState('in_stock')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState({})
  const [layout, setLayout] = useState('sheet')

  const shown = rows.filter(
    (b) =>
      (!status || b.status === status) &&
      (!q || (b.bag_no + ' ' + (b.batches?.batch_no || '')).toLowerCase().includes(q.toLowerCase()))
  )
  const chosen = shown.filter((b) => sel[b.id])
  const total = shown.reduce((a, b) => a + Number(b.weight_kg), 0)

  async function reject(b) {
    if (!confirm(`Mark ${b.bag_no} as rejected (removed from stock)?`)) return
    const { error } = await supabase.from('bags').update({ status: 'rejected' }).eq('id', b.id).eq('status', 'in_stock')
    if (error) alert(error.message)
    reload()
  }

  return (
    <section>
      <div className="head"><h2>Bags</h2></div>
      {canPack(role) && <PackForm onDone={reload} />}
      <Trace />
      <div className="row" style={{ flexWrap: 'wrap', margin: '10px 0', alignItems: 'center' }}>
        <div className="tabs">
          {[['in_stock', 'In stock'], ['dispatched', 'Dispatched'], ['rejected', 'Rejected'], ['', 'All']].map(([v, l]) => (
            <button key={v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </div>
        <input style={{ maxWidth: 220 }} placeholder="Search bag or batch no." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="muted">{shown.length} bags, {fmtKg(total)}</p>
      {chosen.length > 0 && (
        <div className="row" style={{ marginBottom: 8, alignItems: 'center' }}>
          <select style={{ width: 'auto' }} value={layout} onChange={(e) => setLayout(e.target.value)}>
            <option value="sheet">A4 sheet</option><option value="label">70 x 50 mm label</option>
          </select>
          <button className="btn primary" onClick={() => printLabels(null, chosen.map(labelOf), { layout })}>Print {chosen.length} labels</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {loading ? <p className="muted">Loading...</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th><input type="checkbox" onChange={(e) => setSel(Object.fromEntries(shown.map((b) => [b.id, e.target.checked])))} /></th>
              <th>Bag no.</th><th>Type</th><th>Weight</th><th>Batch</th><th>Grade</th><th>Packed</th><th>By</th><th>Status</th><th>Order</th><th />
            </tr></thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id}>
                  <td><input type="checkbox" checked={!!sel[b.id]} onChange={(e) => setSel({ ...sel, [b.id]: e.target.checked })} /></td>
                  <td><strong>{b.bag_no}</strong></td>
                  <td>{b.bag_type}</td>
                  <td>{fmtKg(b.weight_kg)}</td>
                  <td>{b.batches?.batch_no}</td>
                  <td>{b.batches?.grades?.name}</td>
                  <td>{fmtDateTime(b.packed_at)}</td>
                  <td>{b.packer?.full_name || b.packer?.username || '-'}</td>
                  <td><Badge tone={tone[b.status]}>{b.status.replace('_', ' ')}</Badge></td>
                  <td>{b.orders?.order_no || '-'}</td>
                  <td className="actions">{b.status === 'in_stock' && can(role, 'bags', 'update') && <button className="link danger" onClick={() => reject(b)}>Reject</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length >= 500 && <p className="muted">Showing the latest 500 bags. Use Trace to look up older ones.</p>}
    </section>
  )
}
