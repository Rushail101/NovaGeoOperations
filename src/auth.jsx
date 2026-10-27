import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, configured } from './supabase.js'
import { kvGet, kvSet, startSync, isNetworkError } from './offline.js'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

// Staff sign in with a username + PIN. Behind the scenes that maps to an email like gate@ops.local.
export const toEmail = (u) => (u.includes('@') ? u.trim() : `${u.trim().toLowerCase()}@ops.local`)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user?.id
  useEffect(() => {
    if (!uid) {
      setProfile(null)
      return
    }
    setProfileLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error && isNetworkError(error)) data = await kvGet('profile:' + uid) // opened with no signal
        else if (data) kvSet('profile:' + uid, data)
        setProfile(data || null)
        setProfileLoading(false)
        if (data) startSync()
      })
  }, [uid])

  const role = profile && profile.active ? profile.role : 'pending'
  const name = profile?.full_name || profile?.username || session?.user?.email || ''

  return (
    <Ctx.Provider value={{ session, profile, role, name, loading: session === undefined || profileLoading }}>
      {children}
    </Ctx.Provider>
  )
}
