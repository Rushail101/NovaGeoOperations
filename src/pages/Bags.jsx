import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { canPack, can } from '../perms.js'
import { useRows, fmtKg, fmtDate, fmtDateTime, gradeLabel, certUrl, bagNoFromScan, Badge } from '../lib.jsx'
import { openPrintWindow, printLabels } from '../print.js'
import { OutboxList } from '../Outbox.jsx'
import { enqueue, takeBagNumbers, indexAddBags, ensureBagBlock, bagNumbersLeft, isOnline, noteNetwork, isNetworkError } from '../offline.js'
import { toast } from '../lib.jsx'
import Scanner from '../Scanner.jsx'

const tone = { in_stock: 'green', dispatched: 'grey', rejected: 'red' }

const labelOf = (b) => ({
  bag_no: b.bag_no,
  bag_type: b.bag_type,
  weight_kg: b.weight_kg,
  batch_no: b.batches?.batch_no,
  grade: gradeLabel(b.batches?.grades, b.batches?.grade_meshes),
  cert_url: certUrl(b.bag_no, b.batches?.cert_token),
  packed_on: fmtDate(b.packed_at),
})

function PackForm({ onDone }) {
  const batches = useRows('batches', {
    select: 'id, batch_no, cert_token, grade_id, mesh_id, qc_hold, sio2_pct, fe2o3_pct, moisture_pct, whiteness_pct, grades(name), grade_meshes(mesh)',
    order: 'created_at',
    limit: 100,
  })
  const [v, setV] = useState({ batch: '', type: 'bag', weight: '25', count: '10', each: false, list: '', print: true, layout: 'sheet' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [left, setLeft] = useState(null)
  const set = (k, x) => setV((p) => ({ ...p, [k]: x }))
  useEffect(() => { bagNumbersLeft().then(setLeft) }, [busy])

  const each = v.each || v.type === 'jumbo'
  const parsed = each ? v.list.split(/[\s,;]+/).filter(Boolean).map(Number) : []
  const weights = each ? parsed : Array.from({ length: Number(v.count) || 0 }, () => Number(v.weight))
  const badList = each && (parsed.length === 0 || parsed.some((x) => !(x > 0)))

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (badList || !weights.length) return setErr('Enter the weight of each bag, separated by spaces, commas or new lines.')
    if (weights.length > 500) return setErr('At most 500 bags at a time.')
    setBusy(true)
    const w = v.print ? openPrintWindow('Bag labels') : null
    const batch = batches.rows.find((x) => x.id === v.batch)
    try {
      let made = null
      if (isOnline()) {
        const { data, error } = await supabase.rpc('create_bags_weights', { p_batch: v.batch, p_type: v.type, p_weights: weights })
        noteNetwork(error)
        if (error && !isNetworkError(error)) throw error
        if (!error) made = data
      }
      if (!made) {
        // no signal: use bag numbers reserved on this device and send them later
        const nos = await takeBagNumbers(weights.length)
        made = weights.map((wt, i) => ({ id: nos[i], bag_no: nos[i], bag_type: v.type, weight_kg: wt, batch_id: v.batch, status: 'in_stock', packed_at: new Date().toISOString(), batches: batch }))
        await enqueue({ kind: 'rpc', fn: 'create_bags_numbered', args: { p_batch: v.batch, p_type: v.type, p_weights: weights, p_bag_nos: nos }, label: `Packed ${nos.length} ${v.type} bags (${nos[0]} to ${nos[nos.length - 1]}) from ${batch?.batch_no}` })
        await indexAddBags(made)
        toast('No connection. Bags saved on this device and numbered; they will be sent when online.')
      }
      if (w) await printLabels(w, made.map((x) => labelOf({ ...x, batches: batch })), { layout: v.layout })
      ensureBagBlock()
      onDone()
    } catch (ex) {
      w?.close()
      setErr(ex.message)
    }
    setBusy(false)
  }

  return (
    <form className="card form" onSubmit={submit}>
      <strong>Pack bags (numbers are generated automatically)</strong>
      <div className="split">
        <label><span>Batch</span>
          <select required value={v.batch} onChange={(e) => set('batch', e.target.value)}>
            <option value="">-</option>
            {batches.rows.map((b) => <option key={b.id} value={b.id}>{b.batch_no} - {gradeLabel(b.grades, b.grade_meshes)}{b.qc_hold ? ' (on hold)' : ''}</option>)}
          </select>
        </label>
        <label><span>Type</span>
          <select value={v.type} onChange={(e) => set('type', e.target.value)}>
            <option value="bag">Bag</option><option value="jumbo">Jumbo bag</option>
          </select>
        </label>
        {!each && <label><span>Weight per bag (kg)</span><input type="number" step="any" required value={v.weight} onChange={(e) => set('weight', e.target.value)} /></label>}
        {!each && <label><span>How many bags</span><input type="number" min="1" max="500" required value={v.count} onChange={(e) => set('count', e.target.value)} /></label>}
      </div>
      {v.type === 'bag' && <label className="check"><input type="checkbox" checked={v.each} onChange={(e) => set('each', e.target.checked)} /><span>Weigh each bag separately</span></label>}
      {each && (
        <label><span>Actual weight of each bag (kg): one per bag, separated by spaces, commas or new lines</span>
          <textarea rows={3} value={v.list} onChange={(e) => set('list', e.target.value)} placeholder="1002 998.5 1011" />
          <small className="muted">{parsed.length} bags, {parsed.reduce((a, x) => a + (x || 0), 0).toLocaleString('en-IN')} kg</small>
        </label>
      )}
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="check"><input type="checkbox" checked={v.print} onChange={(e) => set('print', e.target.checked)} /><span>Print QR labels now</span></label>
        <select style={{ width: 'auto' }} value={v.layout} onChange={(e) => set('layout', e.target.value)}>
          <option value="sheet">A4 sheet (3 columns)</option>
          <option value="label">Label printer (70 x 50 mm)</option>
        </select>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={busy || !v.batch}>{busy ? 'Creating...' : `Create ${weights.length || ''} bags`}</button>
        {left != null && <span className="muted">{left} bag numbers ready for offline use</span>}
      </div>
    </form>
  )
}

function Trace() {
  const [no, setNo] = useState('')
  const [cam, setCam] = useState(false)
  const [res, setRes] = useState(null)
  const [msg, setMsg] = useState(null)

  async function find(n) {
    const bagNo = bagNoFromScan(n ?? no)
    if (!bagNo) return
    setNo(bagNo)
    setMsg(null)
    const { data, error } = await supabase
      .from('bags')
      .select('*, batches(*, grades(name), grade_meshes(mesh), mills(name)), orders(order_no, customers(name)), weighments(vehicle_no, weighed_at, net_kg)')
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
            Batch {res.batches?.batch_no} | {gradeLabel(res.batches?.grades, res.batches?.grade_meshes)} | {res.batches?.mills?.name} | produced {fmtDate(res.batches?.produced_on)}
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

function BagStock() {
  const st = useRows('stock_summary').rows[0]
  const [out, setOut] = useState(null)
  useEffect(() => {
    supabase.from('bags').select('id', { count: 'exact', head: true }).eq('status', 'dispatched').then(({ count }) => setOut(count))
  }, [])
  const bulk = st ? Number(st.dispatched_kg) - Number(st.dispatched_bags_kg) : 0
  const loose = st ? Number(st.produced_kg) - Number(st.packed_kg) - bulk : null
  return (
    <div className="stats">
      <div className="stat"><div className="label">Bags in stock</div><div className="value">{st?.bags_in_stock ?? '-'}</div><div className="muted">{fmtKg(st?.packed_in_stock_kg)}</div></div>
      <div className="stat"><div className="label">Bags shipped out</div><div className="value">{out ?? '-'}</div><div className="muted">{fmtKg(st?.dispatched_bags_kg)}</div></div>
      <div className="stat"><div className="label">Powder not yet packed</div><div className="value">{fmtKg(loose)}</div><div className="muted">goes down as bags are made</div></div>
    </div>
  )
}

export default function Bags() {
  const { role } = useAuth()
  const { rows, loading, error, reload } = useRows('bags', {
    select: '*, batches(batch_no, cert_token, grades(name), grade_meshes(mesh)), orders(order_no), packer:profiles!packed_by(full_name, username)',
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
      <BagStock />
      {canPack(role) && <PackForm onDone={reload} />}
      <OutboxList filter={(i) => i.fn === 'create_bags_numbered'} title="Bags packed offline, waiting to send" />
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
          <table className="stack">
            <thead><tr>
              <th><input type="checkbox" onChange={(e) => setSel(Object.fromEntries(shown.map((b) => [b.id, e.target.checked])))} /></th>
              <th>Bag no.</th><th>Type</th><th>Weight</th><th>Batch</th><th>Grade</th><th>Packed</th><th>By</th><th>Status</th><th>Order</th><th />
            </tr></thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id}>
                  <td data-label=""><input type="checkbox" checked={!!sel[b.id]} onChange={(e) => setSel({ ...sel, [b.id]: e.target.checked })} /></td>
                  <td data-label="Bag no."><strong>{b.bag_no}</strong></td>
                  <td data-label="Type">{b.bag_type}</td>
                  <td data-label="Weight">{fmtKg(b.weight_kg)}</td>
                  <td data-label="Batch">{b.batches?.batch_no}</td>
                  <td data-label="Grade">{gradeLabel(b.batches?.grades, b.batches?.grade_meshes)}</td>
                  <td data-label="Packed">{fmtDateTime(b.packed_at)}</td>
                  <td data-label="By">{b.packer?.full_name || b.packer?.username || '-'}</td>
                  <td data-label="Status"><Badge tone={tone[b.status]}>{b.status.replace('_', ' ')}</Badge></td>
                  <td data-label="Order">{b.orders?.order_no || '-'}</td>
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
