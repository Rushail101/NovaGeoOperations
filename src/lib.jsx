import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, Plus, Search } from 'lucide-react'
import { supabase } from './supabase.js'
import { useAuth } from './auth.jsx'
import { can } from './perms.js'
import { saveInsert, noteNetwork, isNetworkError, cacheGet, cacheSet, useOnline } from './offline.js'
import PhotoField from './PhotoField.jsx'
import Modal from './Modal.jsx'
import { OutboxList } from './Outbox.jsx'

export * from './fmt.js'
export { Modal }

// ---------- toast ----------
export const toast = (msg) => window.dispatchEvent(new CustomEvent('toast', { detail: msg }))
export function Toaster() {
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    let t
    const on = (e) => {
      setMsg(e.detail)
      clearTimeout(t)
      t = setTimeout(() => setMsg(null), 5000)
    }
    window.addEventListener('toast', on)
    return () => window.removeEventListener('toast', on)
  }, [])
  return msg ? <div className="toast" role="status">{msg}</div> : null
}

// ---------- data hook (cached on the device, so lists still open without signal) ----------
export function useRows(table, { select = '*', order, asc = false, limit = 500, eq, range } = {}) {
  const key = JSON.stringify([table, select, order, asc, limit, eq, range])
  const [st, setSt] = useState({ rows: [], loading: true, error: null, stale: false })

  const reload = useCallback(async () => {
    let q = supabase.from(table).select(select).limit(limit)
    if (eq) q = q.eq(eq[0], eq[1])
    if (range?.from) q = q.gte(range.field, range.from)
    if (range?.to) q = q.lte(range.field, range.to)
    if (order) q = q.order(order, { ascending: asc })
    const { data, error } = await q
    noteNetwork(error)
    if (!error) {
      setSt({ rows: data || [], loading: false, error: null, stale: false })
      cacheSet(key, data || [])
    } else if (isNetworkError(error)) {
      const c = await cacheGet(key)
      setSt({ rows: c || [], loading: false, error: c ? null : 'No connection, and nothing is saved on this device for this list yet.', stale: !!c })
    } else {
      setSt((s) => ({ ...s, loading: false, error: error.message }))
    }
  }, [key])

  useEffect(() => {
    reload()
  }, [reload])
  useEffect(() => {
    window.addEventListener('outbox-synced', reload)
    return () => window.removeEventListener('outbox-synced', reload)
  }, [reload])

  return { ...st, reload }
}

export const opts = (rows, label = 'name') =>
  rows.map((r) => ({ value: r.id, label: typeof label === 'function' ? label(r) : r[label] }))

// Plain text of a React node (used to search lists and to put cells into PDFs)
export function textOf(n) {
  if (n == null || n === false || n === true) return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  return textOf(n.props?.children)
}

const NUMERIC = /^-?[\d,.]+( ?(kg|%|h|mm|kWh\/t))?$/
const cellText = (c, r) => (c.render ? textOf(c.render(r)) : r[c.key] ?? '')

export async function exportList(title, columns, rows, user) {
  const { exportReport } = await import('./pdf.js')
  const cols = columns.map((c) => ({ header: c.label }))
  const body = rows.map((r) => columns.map((c) => cellText(c, r)).map((x) => (x === '' ? '-' : String(x))))
  cols.forEach((c, i) => {
    const vals = body.map((b) => b[i]).filter((x) => x !== '-')
    if (vals.length && vals.every((x) => NUMERIC.test(x))) c.align = 'right'
  })
  await exportReport({ title, subtitle: `${rows.length} records`, sections: [{ columns: cols, rows: body }] }, { user })
}

// ---------- form ----------
export function Form({ fields, initial = {}, onSubmit, onCancel, submitLabel = 'Save', grid = false }) {
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await onSubmit(v)
    } catch (ex) {
      setErr(ex.message || String(ex))
    }
    setBusy(false)
  }

  return (
    <form className={'form' + (grid ? ' grid2' : '')} onSubmit={submit}>
      {fields
        .filter((f) => !f.showIf || f.showIf(v))
        .map((f) => (
          <label key={f.name} className={f.type === 'checkbox' ? 'check' : ['textarea', 'photos'].includes(f.type) || f.wide ? 'wide' : ''}>
            <span>{f.label}</span>
            {f.type === 'select' ? (
              <select value={v[f.name] ?? ''} required={f.required} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">-</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea rows={2} value={v[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" checked={!!v[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
            ) : f.type === 'photos' ? (
              <PhotoField value={v[f.name] || []} onChange={(x) => set(f.name, x)} folder={f.folder || 'misc'} />
            ) : (
              <>
                <input
                  type={f.type || 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  list={f.datalist ? `dl-${f.name}` : undefined}
                  value={v[f.name] ?? ''}
                  required={f.required}
                  onChange={(e) => set(f.name, e.target.value)}
                />
                {f.datalist && <datalist id={`dl-${f.name}`}>{f.datalist.map((d) => <option key={d} value={d} />)}</datalist>}
              </>
            )}
            {f.hint && <small className="muted">{f.hint}</small>}
          </label>
        ))}
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

// Clean a form payload: '' -> null, numeric fields -> numbers
export function clean(values, fields) {
  const out = {}
  for (const f of fields) {
    if (f.showIf && !f.showIf(values)) continue
    let x = values[f.name]
    if (x === '' || x === undefined) x = null
    if (x != null && f.type === 'number') x = Number(x)
    if (x != null && f.type === 'datetime-local') x = new Date(x).toISOString()
    if (f.type === 'checkbox') x = !!x
    if (f.type === 'photos') x = x && x.length ? x : null
    out[f.name] = x
  }
  return out
}

const istRange = (from, to) => ({
  from: from ? new Date(from + 'T00:00:00+05:30').toISOString() : null,
  to: to ? new Date(to + 'T23:59:59.999+05:30').toISOString() : null,
})

// ---------- generic list page ----------
export function DataPage({
  title,
  table,
  select = '*',
  order = 'created_at',
  asc = false,
  columns,
  fields,
  defaults = {},
  afterSave,
  extra,
  canDelete = true,
  addable = true,
  permTable,
  rowActions,
  eq,
  offline = false, // new records can be saved without signal
  offlineLabel,
  dateField, // adds From/To filters on this column
  pageSize = 200,
}) {
  const { role, name } = useAuth()
  const online = useOnline()
  const pt = permTable || table
  const allowAdd = addable && can(role, pt, 'insert')
  const allowEdit = can(role, pt, 'update')
  const allowDelete = canDelete && can(role, pt, 'delete')

  const [limit, setLimit] = useState(pageSize)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const range = useMemo(() => {
    if (!dateField || (!from && !to)) return undefined
    return dateField.endsWith('_at') ? { field: dateField, ...istRange(from, to) } : { field: dateField, from: from || null, to: to || null }
  }, [dateField, from, to])

  const { rows, loading, error, reload, stale } = useRows(table, { select, order, asc, eq, limit, range })
  const [editing, setEditing] = useState(null) // null | 'new' | row

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter((r) => columns.some((c) => String(cellText(c, r)).toLowerCase().includes(t)))
  }, [rows, q, columns])

  async function save(values) {
    const payload = clean(values, fields)
    if (editing === 'new') {
      if (offline) {
        const res = await saveInsert(table, payload, offlineLabel ? offlineLabel(payload) : `${title}: new entry`)
        if (res.queued) toast('No connection. Saved on this device and will be sent automatically.')
      } else {
        const res = await supabase.from(table).insert(payload).select().single()
        if (res.error) throw isNetworkError(res.error) ? new Error('No connection. This needs the internet.') : res.error
        if (afterSave) await afterSave(res.data)
      }
    } else {
      const res = await supabase.from(table).update(payload).eq('id', editing.id).select().single()
      if (res.error) throw isNetworkError(res.error) ? new Error('No connection. Editing an existing record needs the internet; new entries can be saved offline.') : res.error
      if (afterSave) await afterSave(res.data)
    }
    setEditing(null)
    reload()
  }

  async function remove(row) {
    if (!confirm('Delete this record?')) return
    const { error } = await supabase.from(table).delete().eq('id', row.id)
    if (error) alert(isNetworkError(error) ? 'No connection. Deleting needs the internet.' : error.message)
    else reload()
  }

  const initial =
    editing === 'new'
      ? defaults
      : editing
      ? Object.fromEntries(
          fields.map((f) => {
            let x = editing[f.name]
            if (f.type === 'datetime-local' && x) x = toLocalInput(x)
            return [f.name, x]
          })
        )
      : {}

  const filtered = q || from || to
  return (
    <section>
      <div className="head">
        <h2>{title}</h2>
        <div className="headbtns">
          {shown.length > 0 && (
            <button className="btn" onClick={() => exportList(title, columns, shown, name)}>
              <FileDown size={17} /> PDF
            </button>
          )}
          {allowAdd && (
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus size={17} /> Add
            </button>
          )}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {stale && <div className="notice">No connection. Showing the list as last saved on this device.</div>}
      {extra}
      {offline && <OutboxList filter={(i) => i.table === table} />}
      {(rows.length > 0 || filtered) && (
        <div className="filters">
          <label className="search">
            <Search size={16} />
            <input placeholder="Search this list" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {dateField && (
            <>
              <label><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
              <label><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
            </>
          )}
          {filtered && <button className="link" onClick={() => { setQ(''); setFrom(''); setTo('') }}>Clear</button>}
        </div>
      )}
      {editing && (
        <Modal title={editing === 'new' ? `Add to ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`} onClose={() => setEditing(null)}>
          {editing === 'new' && offline && !online && <div className="notice">No connection. This entry will be saved on this device and sent when the signal returns.</div>}
          <Form grid fields={fields} initial={initial} onSubmit={save} onCancel={() => setEditing(null)} />
        </Modal>
      )}
      {loading ? (
        <p className="muted">Loading...</p>
      ) : shown.length === 0 ? (
        <div className="empty">{filtered ? 'Nothing matches. Clear the search or widen the dates.' : allowAdd ? 'Nothing here yet. Use Add to create the first record.' : 'Nothing here yet.'}</div>
      ) : (
        <div className="tablewrap">
          <table className="stack">
            <thead>
              <tr>
                {columns.map((c) => (<th key={c.label}>{c.label}</th>))}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => (
                    <td key={c.label} data-label={c.label}>{c.render ? c.render(r) : r[c.key] ?? '-'}</td>
                  ))}
                  <td className="actions">
                    {rowActions && rowActions(r, reload)}
                    {allowEdit && <button className="link" onClick={() => setEditing(r)}>Edit</button>}
                    {allowDelete && <button className="link danger" onClick={() => remove(r)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && rows.length >= limit && (
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <button className="btn" onClick={() => setLimit(limit + 300)}>Show more (showing {rows.length})</button>
        </div>
      )}
    </section>
  )
}

export const Badge = ({ tone = 'grey', children }) => <span className={'badge ' + tone}>{children}</span>
