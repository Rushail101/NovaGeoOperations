import { useCallback, useEffect, useState } from 'react'
import { X, FileDown, Plus } from 'lucide-react'
import { supabase } from './supabase.js'
import { useAuth } from './auth.jsx'
import { can } from './perms.js'

export const fmtKg = (n) =>
  n == null ? '-' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' kg'
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '-')
export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-'
export const toLocalInput = (d = new Date()) => {
  const x = new Date(d)
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset())
  return x.toISOString().slice(0, 16)
}

export function useRows(table, { select = '*', order, asc = false, limit = 500, eq } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    let q = supabase.from(table).select(select).limit(limit)
    if (eq) q = q.eq(eq[0], eq[1])
    if (order) q = q.order(order, { ascending: asc })
    const { data, error } = await q
    if (error) setError(error.message)
    else {
      setError(null)
      setRows(data || [])
    }
    setLoading(false)
  }, [table, select, order, asc, limit, eq && eq[0], eq && eq[1]])

  useEffect(() => {
    reload()
  }, [reload])

  return { rows, loading, error, reload }
}

export const opts = (rows, label = 'name') =>
  rows.map((r) => ({ value: r.id, label: typeof label === 'function' ? label(r) : r[label] }))

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// Plain text of a React node (used to put table cells into PDFs)
export function textOf(n) {
  if (n == null || n === false || n === true) return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  return textOf(n.props?.children)
}

const NUMERIC = /^-?[\d,.]+( ?(kg|%|h|mm|kWh\/t))?$/

export async function exportList(title, columns, rows, user) {
  const { exportReport } = await import('./pdf.js')
  const cols = columns.map((c) => ({ header: c.label }))
  const body = rows.map((r) => columns.map((c) => (c.render ? textOf(c.render(r)) : r[c.key] ?? '')).map((x) => (x === '' ? '-' : String(x))))
  cols.forEach((c, i) => {
    const vals = body.map((b) => b[i]).filter((x) => x !== '-')
    if (vals.length && vals.every((x) => NUMERIC.test(x))) c.align = 'right'
  })
  await exportReport({ title, subtitle: `${rows.length} records`, sections: [{ columns: cols, rows: body }] }, { user })
}

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
    <form className={"form" + (grid ? " grid2" : "")} onSubmit={submit}>
      {fields
        .filter((f) => !f.showIf || f.showIf(v))
        .map((f) => (
          <label key={f.name} className={f.type === 'checkbox' ? 'check' : f.type === 'textarea' ? 'wide' : ''}>
            <span>{f.label}</span>
            {f.type === 'select' ? (
              <select
                value={v[f.name] ?? ''}
                required={f.required}
                onChange={(e) => set(f.name, e.target.value)}
              >
                <option value="">-</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea
                rows={2}
                value={v[f.name] ?? ''}
                onChange={(e) => set(f.name, e.target.value)}
              />
            ) : f.type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={!!v[f.name]}
                onChange={(e) => set(f.name, e.target.checked)}
              />
            ) : (
              <input
                type={f.type || 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                value={v[f.name] ?? ''}
                required={f.required}
                onChange={(e) => set(f.name, e.target.value)}
              />
            )}
          </label>
        ))}
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? 'Saving...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
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
    out[f.name] = x
  }
  return out
}

// Generic list + add/edit/delete page
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
}) {
  const { role, name } = useAuth()
  const pt = permTable || table
  const allowAdd = addable && can(role, pt, 'insert')
  const allowEdit = can(role, pt, 'update')
  const allowDelete = canDelete && can(role, pt, 'delete')
  const { rows, loading, error, reload } = useRows(table, { select, order, asc, eq })
  const [editing, setEditing] = useState(null) // null | 'new' | row

  async function save(values) {
    const payload = clean(values, fields)
    let res
    if (editing === 'new') res = await supabase.from(table).insert(payload).select().single()
    else res = await supabase.from(table).update(payload).eq('id', editing.id).select().single()
    if (res.error) throw res.error
    if (afterSave) await afterSave(res.data)
    setEditing(null)
    reload()
  }

  async function remove(row) {
    if (!confirm('Delete this record?')) return
    const { error } = await supabase.from(table).delete().eq('id', row.id)
    if (error) alert(error.message)
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

  return (
    <section>
      <div className="head">
        <h2>{title}</h2>
        <div className="headbtns">
          {rows.length > 0 && (
            <button className="btn" onClick={() => exportList(title, columns, rows, name)}>
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
      {extra}
      {editing && (
        <Modal title={editing === 'new' ? `Add to ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`} onClose={() => setEditing(null)}>
          <Form grid fields={fields} initial={initial} onSubmit={save} onCancel={() => setEditing(null)} />
        </Modal>
      )}
      {loading ? (
        <p className="muted">Loading...</p>
      ) : rows.length === 0 ? (
        <div className="empty">{allowAdd ? 'Nothing here yet. Use Add to create the first record.' : 'Nothing here yet.'}</div>
      ) : (
        <div className="tablewrap">
          <table className="stack">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.label}>{c.label}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => (
                    <td key={c.label} data-label={c.label}>{c.render ? c.render(r) : r[c.key] ?? '-'}</td>
                  ))}
                  <td className="actions">
                    {rowActions && rowActions(r, reload)}
                    {allowEdit && (
                      <button className="link" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                    )}
                    {allowDelete && (
                      <button className="link danger" onClick={() => remove(r)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export const Badge = ({ tone = 'grey', children }) => (
  <span className={'badge ' + tone}>{children}</span>
)
