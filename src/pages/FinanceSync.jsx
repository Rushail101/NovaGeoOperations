import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useRows, Badge, toast } from '../lib.jsx'
import { useFinance, normName } from '../financeLink.js'

// Suppliers / customers kept in the finance ERP: link or import them here so names and GSTIN are typed once.
function Section({ title, kind, financeRows, opsRows, reloadOps, mapRow }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const byFin = new Map(opsRows.filter((o) => o.finance_id != null).map((o) => [Number(o.finance_id), o]))
  const byName = new Map(opsRows.filter((o) => o.finance_id == null).map((o) => [normName(o.name), o]))
  const rows = financeRows.map((f) => {
    const linked = byFin.get(Number(f.id))
    const same = !linked && byName.get(normName(f.name))
    return { f, linked, same, state: linked ? 'linked' : same ? 'match' : 'new' }
  })
  const todo = rows.filter((r) => r.state !== 'linked')

  async function apply(list) {
    setBusy(true); setMsg(null)
    try {
      for (const r of list) {
        if (r.state === 'match') {
          const { error } = await supabase.from(kind).update({ finance_id: r.f.id, ...(kind === 'customers' ? { gstin: r.f.gstin ?? null, state: r.f.state ?? null } : {}) }).eq('id', r.same.id)
          if (error) throw error
        } else if (r.state === 'new') {
          const { error } = await supabase.from(kind).insert({ finance_id: r.f.id, ...mapRow(r.f) })
          if (error) throw error
        }
      }
      toast(`${list.length} ${kind} linked`)
      reloadOps()
    } catch (e) { setMsg(e.message) }
    setBusy(false)
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div className="head">
        <h2>{title}</h2>
        {todo.length > 0 && <div className="headbtns"><button className="btn primary" disabled={busy} onClick={() => apply(todo)}>Link / import all {todo.length}</button></div>}
      </div>
      {msg && <div className="error">{msg}</div>}
      <div className="tablewrap">
        <table className="stack">
          <thead><tr><th>In finance</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.f.id}>
                <td data-label="In finance"><strong>{r.f.name}</strong>{r.f.gstin ? <span className="muted"> | {r.f.gstin}</span> : null}</td>
                <td data-label="Status">
                  {r.state === 'linked' && <Badge tone="green">linked</Badge>}
                  {r.state === 'match' && <><Badge tone="amber">same name in ops</Badge> <span className="muted">not linked yet</span></>}
                  {r.state === 'new' && <Badge tone="blue">not in ops</Badge>}
                </td>
                <td className="actions">{r.state !== 'linked' && <button className="link" disabled={busy} onClick={() => apply([r])}>{r.state === 'match' ? 'Link' : 'Import'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="empty">Nothing in finance yet.</div>}
    </div>
  )
}

export default function FinanceSync() {
  const sup = useFinance({ action: 'suppliers' })
  const cus = useFinance({ action: 'customers' })
  const opsSup = useRows('suppliers', { order: 'name', asc: true, limit: 2000 })
  const opsCus = useRows('customers', { order: 'name', asc: true, limit: 2000 })
  const error = sup.error || cus.error
  return (
    <section>
      <p className="muted">Read-only link to your finance ERP. Importing copies the name (and GSTIN for customers) into this app and remembers which finance record it is. Nothing is ever written to finance, and linking does not change your existing weighments or orders.</p>
      {error && <div className="error">{error}</div>}
      {(sup.loading || cus.loading) && <p className="muted">Reading from finance...</p>}
      {!error && !sup.loading && (
        <Section title="Suppliers" kind="suppliers" financeRows={sup.rows} opsRows={opsSup.rows} reloadOps={opsSup.reload} mapRow={(f) => ({ name: f.name, phone: f.phone || null })} />
      )}
      {!error && !cus.loading && (
        <Section title="Customers" kind="customers" financeRows={cus.rows} opsRows={opsCus.rows} reloadOps={opsCus.reload} mapRow={(f) => ({ name: f.name, phone: f.phone || null, address: f.address || null, gstin: f.gstin || null, state: f.state || null })} />
      )}
      {!error && <button className="btn" onClick={() => { sup.reload(); cus.reload() }}>Refresh from finance</button>}
    </section>
  )
}
