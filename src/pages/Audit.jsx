import { useState } from 'react'
import { useRows, fmtDateTime, Badge } from '../lib.jsx'

const SKIP = new Set(['created_at', 'id'])
function summarize(r) {
  if (r.action === 'INSERT') return 'created'
  if (r.action === 'DELETE') return 'deleted'
  const o = r.old_data || {}, n = r.new_data || {}
  const ch = Object.keys(n).filter((k) => !SKIP.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
  return ch.map((k) => `${k}: ${fmt(o[k])} -> ${fmt(n[k])}`).join('; ') || 'no visible change'
}
const fmt = (v) => (v == null ? 'empty' : String(v).length > 40 ? String(v).slice(0, 40) + '...' : String(v))
const tone = { INSERT: 'green', UPDATE: 'amber', DELETE: 'red' }

export default function Audit() {
  const { rows, loading, error } = useRows('audit_log', { order: 'at', limit: 400 })
  const [table, setTable] = useState('')
  const tables = [...new Set(rows.map((r) => r.table_name))].sort()
  const shown = rows.filter((r) => !table || r.table_name === table)
  return (
    <section>
      <div className="head">
        <h2>Audit trail</h2>
        <select style={{ width: 'auto' }} value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">All tables</option>
          {tables.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <p className="muted">Latest 400 changes. Every create, edit and delete is recorded with who did it.</p>
      {error && <div className="error">{error}</div>}
      {loading ? <p className="muted">Loading...</p> : (
        <div className="tablewrap">
          <table className="stack">
            <thead><tr><th>When</th><th>Who</th><th>Table</th><th>Action</th><th>Change</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td data-label="When">{fmtDateTime(r.at)}</td>
                  <td data-label="Who">{r.user_name || 'system'}</td>
                  <td data-label="Table">{r.table_name}</td>
                  <td data-label="Action"><Badge tone={tone[r.action]}>{r.action.toLowerCase()}</Badge></td>
                  <td className="wrap" data-label="Change">{summarize(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
