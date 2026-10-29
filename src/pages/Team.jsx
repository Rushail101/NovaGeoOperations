import { useState } from 'react'
import { UserPlus, KeyRound, HardDriveUpload } from 'lucide-react'
import { supabase } from '../supabase.js'
import { uuid } from '../offline.js'
import { useAuth } from '../auth.jsx'
import { useRows, Modal, Form, Badge, toast, fmtDate } from '../lib.jsx'
import { ASSIGNABLE_ROLES, ROLE_LABELS } from '../perms.js'

const ROLE_HELP = {
  admin: 'Everything, including users, settings, deleting records and the audit trail.',
  supervisor: 'Orders, dispatch, masters, QC hold, approving lab reports and everything below. Cannot delete or manage users.',
  weighbridge: 'Inbound weighments, dispatch (with bag scan), papers and invoice numbers.',
  operator: 'Mill runs, batches, packing and labels, downtime, dust, stock movements.',
  maintenance: 'Maintenance logs and schedules, assets, lining inspections, spares, downtime.',
  lab: 'Enters lab reports and uploads outside lab reports. Cannot approve them. Otherwise read-only.',
  viewer: 'Read-only access to everything except admin pages.',
  pending: 'Signed up but has no access until a role is given.',
}
const CREATABLE = ASSIGNABLE_ROLES.filter((r) => r !== 'pending')

// Call the admin-users edge function; returns the data or throws a readable error
async function adminCall(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error || msg } catch {}
    if (/not found|404|Failed to send|fetch/i.test(msg)) msg = 'The user-management function is not set up yet. Follow "Setting up user management" in the README (one-time, 2 minutes).'
    const e = new Error(msg)
    e.notSetUp = msg.startsWith('The user-management function')
    throw e
  }
  if (data?.error) throw new Error(data.error)
  return data
}

function AddUser({ onDone }) {
  const fields = [
    { name: 'username', label: 'Username (they sign in with this)', required: true, hint: 'Lowercase letters and numbers, for example gate1 or anita.lab' },
    { name: 'full_name', label: 'Full name' },
    { name: 'role', label: 'Role', type: 'select', required: true, options: CREATABLE.map((r) => ({ value: r, label: ROLE_LABELS[r] })) },
    { name: 'pin', label: 'PIN / password (6 or more characters)', required: true, hint: 'Tell them the PIN in person. They can change it themselves from the side menu.' },
  ]
  async function submit(v) {
    try {
      await adminCall({ action: 'create', username: v.username, full_name: v.full_name, role: v.role, pin: v.pin })
    } catch (e) {
      if (e.notSetUp) throw new Error('Could not reach the admin-users function. In Supabase > Edge Functions open admin-users, switch "Verify JWT" OFF (the function checks the admin itself), and redeploy. If the function does not exist yet, create it from supabase/functions/admin-users/index.ts.')
      throw e
    }
    toast(`Added ${v.username.toLowerCase()}`)
    onDone()
  }
  return <Form grid fields={fields} initial={{ role: 'operator' }} onSubmit={submit} onCancel={onDone} submitLabel="Add person" />
}

// Walks through what a weighment upload needs and says exactly which step fails.
function UploadCheck() {
  const [steps, setSteps] = useState(null)
  async function run() {
    const out = []
    const add = (name, ok, detail) => { out.push({ name, ok, detail }); setSteps([...out]) }
    setSteps([])
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const path = `_check/${uuid()}.png`
    const up = await supabase.storage.from('photos').upload(path, new Blob([png], { type: 'image/png' }), { contentType: 'image/png' })
    add('Upload a test picture to the "photos" storage bucket', !up.error, up.error ? `${up.error.message}. Run migration_v6.sql in the Supabase SQL editor, then check Storage > photos exists.` : 'worked')
    if (up.error) return
    const sg = await supabase.storage.from('photos').createSignedUrl(path, 60)
    add('Create a viewing link for it', !sg.error, sg.error ? sg.error.message : 'worked')
    if (!sg.error) {
      try {
        const r = await fetch(sg.data.signedUrl)
        add('Open the picture through that link', r.ok, r.ok ? 'worked' : `HTTP ${r.status}`)
      } catch (e) { add('Open the picture through that link', false, e.message) }
    }
    const rm = await supabase.storage.from('photos').remove([path])
    add('Remove the test picture', !rm.error, rm.error ? rm.error.message : 'worked')
    const col = await supabase.from('weighments').select('doc_paths, photo_paths').limit(1)
    add('Weighments table can hold files', !col.error, col.error ? `${col.error.message}. Run migration_v4.sql.` : 'worked')
  }
  return (
    <div className="form">
      <p className="muted" style={{ margin: 0 }}>Uploads a tiny test picture and removes it again. If a step fails, the message says what to fix.</p>
      <div className="row"><button className="btn primary" onClick={run}>Run check</button></div>
      {steps?.map((s) => (
        <div key={s.name} className={s.ok ? 'ok' : 'error'}>{s.ok ? 'OK' : 'FAILED'}: {s.name} - {s.detail}</div>
      ))}
    </div>
  )
}

export default function Team() {
  const { session } = useAuth()
  const me = session?.user?.id
  const { rows, loading, error, reload } = useRows('profiles', { order: 'created_at', asc: true })
  const [adding, setAdding] = useState(false)
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState(null)

  async function run(fn) {
    setMsg(null)
    try { await fn() } catch (e) { setMsg(e.message) }
    reload()
  }
  const setRole = (p, role) => run(async () => {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', p.id)
    if (error) throw error
    toast(`${p.username} is now ${ROLE_LABELS[role]}`)
  })
  const resetPin = (p) => run(async () => {
    const pin = prompt(`New PIN for ${p.username} (6 or more characters):`)
    if (!pin) return
    await adminCall({ action: 'reset_pin', id: p.id, pin })
    toast(`PIN changed for ${p.username}`)
  })
  const setActive = (p, active) => run(async () => {
    if (!active && !confirm(`Block ${p.username}? They will not be able to sign in.`)) return
    try {
      await adminCall({ action: 'set_active', id: p.id, active })
    } catch (e) {
      if (!e.notSetUp) throw e
      const { error } = await supabase.from('profiles').update({ active }).eq('id', p.id) // blocks access to the app
      if (error) throw error
    }
    toast(active ? `${p.username} can sign in again` : `${p.username} is blocked`)
  })

  return (
    <section>
      <div className="head">
        <h2>Users and roles</h2>
        <div className="headbtns">
          <button className="btn" onClick={() => setChecking(true)}><HardDriveUpload size={17} /> Check file uploads</button>
          <button className="btn primary" onClick={() => setAdding(true)}><UserPlus size={17} /> Add person</button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="error">{msg}</div>}
      {loading ? <p className="muted">Loading...</p> : (
        <div className="tablewrap">
          <table className="stack">
            <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td data-label="Username"><strong>{p.username}</strong>{p.id === me && <span className="muted"> (you)</span>}</td>
                  <td data-label="Name">{p.full_name || '-'}</td>
                  <td data-label="Role">
                    <select value={p.role} onChange={(e) => setRole(p, e.target.value)} aria-label={`Role of ${p.username}`} style={{ minWidth: 190 }}>
                      {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td data-label="Status">{p.role === 'pending' ? <Badge tone="amber">no access yet</Badge> : p.active ? <Badge tone="green">active</Badge> : <Badge tone="red">blocked</Badge>}</td>
                  <td data-label="Added">{fmtDate(p.created_at)}</td>
                  <td className="actions">
                    <button className="link" onClick={() => resetPin(p)}><KeyRound size={14} /> Reset PIN</button>
                    {p.id !== me && (p.active
                      ? <button className="link danger" onClick={() => setActive(p, false)}>Block</button>
                      : <button className="link" onClick={() => setActive(p, true)}>Unblock</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">People who sign up on their own show as "no access yet" until you give them a role here.</p>

      <h2>What each role can do</h2>
      <div className="tablewrap">
        <table className="stack">
          <thead><tr><th>Role</th><th>Access</th></tr></thead>
          <tbody>
            {ASSIGNABLE_ROLES.map((r) => (
              <tr key={r}><td data-label="Role"><strong>{ROLE_LABELS[r]}</strong></td><td data-label="Access" className="wrap">{ROLE_HELP[r]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {checking && (
        <Modal title="Check file uploads" onClose={() => setChecking(false)}>
          <UploadCheck />
        </Modal>
      )}
      {adding && (
        <Modal title="Add a person" onClose={() => setAdding(false)}>
          <AddUser onDone={() => { setAdding(false); reload() }} />
        </Modal>
      )}
    </section>
  )
}
