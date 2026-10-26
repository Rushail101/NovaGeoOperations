import { useEffect, useState } from 'react'
import { supabase, configured } from './supabase.js'
import Dashboard from './pages/Dashboard.jsx'
import Orders from './pages/Orders.jsx'
import Weighments from './pages/Weighments.jsx'
import Runs from './pages/Runs.jsx'
import Maintenance from './pages/Maintenance.jsx'
import Lining from './pages/Lining.jsx'
import Masters from './pages/Masters.jsx'

const pages = {
  Dashboard,
  Orders,
  Weighments,
  'Mill runs': Runs,
  Maintenance,
  Lining,
  Masters,
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <h1>BallMill Ops</h1>
        <label><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label><span>Password</span><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary" disabled={busy}>Sign in</button>
        <p className="muted">Create users in Supabase: Authentication &gt; Users.</p>
      </form>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [page, setPage] = useState('Dashboard')

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configured)
    return (
      <div className="login">
        <div className="card">
          <h1>Setup needed</h1>
          <p>Copy <code>.env.example</code> to <code>.env</code> and add your Supabase URL and anon key, then restart.</p>
        </div>
      </div>
    )
  if (session === undefined) return <p className="muted pad">Loading...</p>
  if (!session) return <Login />

  const Page = pages[page]
  return (
    <div className="app">
      <header>
        <strong>BallMill Ops</strong>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <nav>
        {Object.keys(pages).map((k) => (
          <button key={k} className={page === k ? 'on' : ''} onClick={() => setPage(k)}>{k}</button>
        ))}
      </nav>
      <main><Page key={page} /></main>
    </div>
  )
}
