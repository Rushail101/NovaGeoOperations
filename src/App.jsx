import { useState } from 'react'
import { supabase, configured } from './supabase.js'
import { AuthProvider, useAuth, toEmail } from './auth.jsx'
import { ROLE_LABELS, canDispatch, isAdmin } from './perms.js'
import Dashboard from './pages/Dashboard.jsx'
import Orders from './pages/Orders.jsx'
import Weighments from './pages/Weighments.jsx'
import Runs from './pages/Runs.jsx'
import Batches from './pages/Batches.jsx'
import Bags from './pages/Bags.jsx'
import Dispatch from './pages/Dispatch.jsx'
import Maintenance from './pages/Maintenance.jsx'
import Lining from './pages/Lining.jsx'
import Masters from './pages/Masters.jsx'
import Team from './pages/Team.jsx'
import Audit from './pages/Audit.jsx'

const PAGES = [
  { name: 'Dashboard', C: Dashboard },
  { name: 'Orders', C: Orders },
  { name: 'Weighments', C: Weighments },
  { name: 'Mill runs', C: Runs },
  { name: 'Batches', C: Batches },
  { name: 'Bags', C: Bags },
  { name: 'Dispatch', C: Dispatch, show: canDispatch },
  { name: 'Maintenance', C: Maintenance },
  { name: 'Lining', C: Lining },
  { name: 'Masters', C: Masters, show: (r) => ['admin', 'supervisor'].includes(r) },
  { name: 'Team', C: Team, show: isAdmin },
  { name: 'Audit', C: Audit, show: isAdmin },
]

function Login() {
  const [user, setUser] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email: toEmail(user), password: pin })
    if (error) setErr('Wrong username or PIN')
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <h1>BallMill Ops</h1>
        <label>
          <span>Username</span>
          <input autoCapitalize="none" autoCorrect="off" required value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label>
          <span>PIN</span>
          <input type="password" inputMode="numeric" required value={pin} onChange={(e) => setPin(e.target.value)} />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  )
}

function Shell() {
  const { session, role, name, loading } = useAuth()
  const [page, setPage] = useState('Dashboard')

  if (!configured)
    return (
      <div className="login">
        <div className="card">
          <h1>Setup needed</h1>
          <p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> as environment variables, then redeploy.</p>
        </div>
      </div>
    )
  if (loading) return <p className="muted pad">Loading...</p>
  if (!session) return <Login />

  if (role === 'pending')
    return (
      <div className="login">
        <div className="card">
          <h1>Waiting for access</h1>
          <p>Signed in as <strong>{name}</strong>. An admin needs to give you a role before you can use the app.</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    )

  async function changePin() {
    const a = prompt('New PIN (at least 6 characters):')
    if (!a) return
    if (a.length < 6) return alert('PIN must be at least 6 characters')
    if (prompt('Type the new PIN again:') !== a) return alert('PINs did not match')
    const { error } = await supabase.auth.updateUser({ password: a })
    alert(error ? error.message : 'PIN changed')
  }

  const visible = PAGES.filter((p) => !p.show || p.show(role))
  const Page = (visible.find((p) => p.name === page) || visible[0]).C
  return (
    <div className="app">
      <header>
        <strong>BallMill Ops</strong>
        <span className="who">
          {name} <span className="badge blue">{ROLE_LABELS[role]}</span>
          <button className="link" onClick={changePin}>Change PIN</button>
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </span>
      </header>
      <nav>
        {visible.map((p) => (
          <button key={p.name} className={page === p.name ? 'on' : ''} onClick={() => setPage(p.name)}>{p.name}</button>
        ))}
      </nav>
      <main><Page key={page} /></main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
