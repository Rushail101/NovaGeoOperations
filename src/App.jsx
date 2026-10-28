import { useEffect, useState } from 'react'
import {
  LayoutDashboard, ClipboardList, FlaskConical, Package, Truck, Wrench,
  Database, Users, ShieldCheck, Menu, X, Sun, Moon, KeyRound, LogOut, Mountain, Boxes, NotebookPen, Download,
} from 'lucide-react'
import { supabase, configured } from './supabase.js'
import { Toaster } from './lib.jsx'
import { SyncStatus } from './Outbox.jsx'
import { AuthProvider, useAuth, toEmail } from './auth.jsx'
import { ROLE_LABELS, isAdmin } from './perms.js'
import Dashboard from './pages/Dashboard.jsx'
import Orders from './pages/Orders.jsx'
import Shipments from './pages/Shipments.jsx'
import QC from './pages/QC.jsx'
import PlantLogs from './pages/PlantLogs.jsx'
import Bags from './pages/Bags.jsx'
import Maintenance from './pages/Maintenance.jsx'
import Spares from './pages/Spares.jsx'
import PublicCertificate from './pages/PublicCertificate.jsx'
import Masters from './pages/Masters.jsx'
import Team from './pages/Team.jsx'
import Audit from './pages/Audit.jsx'

// Who sees which tab. Admin, supervisor and viewer see everything except the admin-only pages.
const seen = (...extra) => (r) => ['admin', 'supervisor', 'viewer', ...extra].includes(r)

const GROUPS = [
  {
    label: null,
    pages: [
      { name: 'Dashboard', C: Dashboard, I: LayoutDashboard },
      { name: 'Orders', C: Orders, I: ClipboardList, show: seen('weighbridge', 'operator') },
      { name: 'Shipments', C: Shipments, I: Truck, show: seen('weighbridge') },
      { name: 'QC', C: QC, I: FlaskConical, show: seen('operator', 'lab') },
      { name: 'Bags', C: Bags, I: Package, show: seen('operator', 'lab') },
      { name: 'Plant Logs', C: PlantLogs, I: NotebookPen, show: seen('operator', 'maintenance', 'weighbridge') },
      { name: 'Maintenance', C: Maintenance, I: Wrench, show: seen('maintenance', 'operator') },
      { name: 'Spares', C: Spares, I: Boxes, show: seen('maintenance', 'operator') },
    ],
  },
  {
    label: 'Admin',
    pages: [
      { name: 'Masters', C: Masters, I: Database, show: (r) => ['admin', 'supervisor'].includes(r) },
      { name: 'Team', C: Team, I: Users, show: isAdmin },
      { name: 'Audit', C: Audit, I: ShieldCheck, show: isAdmin },
    ],
  },
]

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const t = localStorage.getItem('theme')
      if (t) return t
    } catch {}
    return 'dark'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch {}
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

function useInstall() {
  const [evt, setEvt] = useState(null)
  useEffect(() => {
    const on = (e) => { e.preventDefault(); setEvt(e) }
    window.addEventListener('beforeinstallprompt', on)
    window.addEventListener('appinstalled', () => setEvt(null))
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  return evt && (async () => { evt.prompt(); await evt.userChoice; setEvt(null) })
}

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
    if (error) setErr('Wrong username or PIN. Check both and try again.')
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <div className="brand" style={{ padding: 0, color: 'inherit' }}>
          <span className="brand-mark"><Mountain size={18} /></span><span>BallMill Ops<small>Nova Geo Resources</small></span>
        </div>
        <label>
          <span>Username</span>
          <input autoCapitalize="none" autoCorrect="off" autoComplete="username" required value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label>
          <span>PIN</span>
          <input type="password" inputMode="numeric" autoComplete="current-password" required value={pin} onChange={(e) => setPin(e.target.value)} />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  )
}

function Shell() {
  const { session, role, name, loading } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const [page, setPage] = useState(() => decodeURIComponent(location.hash.slice(1)) || 'Dashboard')
  const [open, setOpen] = useState(false)
  const install = useInstall()

  useEffect(() => {
    const onHash = () => setPage(decodeURIComponent(location.hash.slice(1)) || 'Dashboard')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

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
    if (prompt('Type the new PIN again:') !== a) return alert('The two PINs did not match')
    const { error } = await supabase.auth.updateUser({ password: a })
    alert(error ? error.message : 'PIN changed')
  }

  const groups = GROUPS.map((g) => ({ ...g, pages: g.pages.filter((p) => !p.show || p.show(role)) })).filter((g) => g.pages.length)
  const all = groups.flatMap((g) => g.pages)
  const current = all.find((p) => p.name === page) || all[0]
  const Page = current.C
  const go = (n) => {
    location.hash = encodeURIComponent(n)
    setPage(n)
    setOpen(false)
    window.scrollTo(0, 0)
  }

  return (
    <div className={'shell' + (open ? ' open' : '')}>
      <div className="topbar">
        <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={24} /></button>
        <span className="ttl">{current.name}</span>
        <SyncStatus />
        <button className="icon-btn" onClick={toggleTheme} aria-label="Switch light or dark">{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
      </div>
      <div className="scrim" onClick={() => setOpen(false)} />
      <aside className="side" aria-label="Main menu">
        <div className="brand">
          <span className="brand-mark"><Mountain size={18} /></span><span>BallMill Ops<small>Nova Geo Resources</small></span>
          <button className="icon-btn" style={{ marginLeft: 'auto', color: 'var(--side-ink)', display: open ? 'inline-grid' : 'none' }} onClick={() => setOpen(false)} aria-label="Close menu"><X size={22} /></button>
        </div>
        <nav className="navgroups">
          {groups.map((g, i) => (
            <div key={i}>
              {g.label && <div className="navlabel">{g.label}</div>}
              {g.pages.map((p) => (
                <button key={p.name} className={'navitem' + (p.name === current.name ? ' on' : '')} onClick={() => go(p.name)}>
                  <p.I size={19} /> {p.name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidefoot">
          <div className="me">{name}<small>{ROLE_LABELS[role]}</small></div>
          <div className="sidebtns">
            <button onClick={toggleTheme}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {theme === 'dark' ? 'Light' : 'Dark'}</button>
            <button onClick={changePin}><KeyRound size={15} /> PIN</button>
            {install && <button onClick={install}><Download size={15} /> Install app</button>}
            <button onClick={() => supabase.auth.signOut()}><LogOut size={15} /> Sign out</button>
          </div>
        </div>
      </aside>
      <main className="content"><Page key={current.name} /></main>
      <Toaster />
    </div>
  )
}

const CERT = /^#\/c\/([^/]+)\/([^/]+)\/?$/

export default function App() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // Bag QR codes open a public certificate page: no sign-in
  const m = hash.match(CERT)
  if (m) return <PublicCertificate bagNo={decodeURIComponent(m[1])} token={decodeURIComponent(m[2])} />
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
