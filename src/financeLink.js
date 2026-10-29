import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Read-only calls into the finance ERP's database through the "finance-link" edge function.
export async function financeCall(body) {
  const { data, error } = await supabase.functions.invoke('finance-link', { body })
  if (error) throw new Error('Cannot reach the finance link. Deploy the finance-link function (see README, "Finance link").')
  if (data?.error === 'not_configured') throw new Error('The finance-link function is deployed, but its FINANCE_URL and FINANCE_KEY secrets are not set yet.')
  if (data?.error) throw new Error(data.error)
  return data
}

const cache = new Map() // key -> { at, rows }
export function useFinance(body, { enabled = true } = {}) {
  const key = JSON.stringify(body)
  const [st, setSt] = useState({ rows: cache.get(key)?.rows || [], loading: enabled && !cache.has(key), error: null })
  const load = useCallback(async (force) => {
    const hit = cache.get(key)
    if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) return setSt({ rows: hit.rows, loading: false, error: null })
    setSt((s) => ({ ...s, loading: true, error: null }))
    try {
      const { rows } = await financeCall(body)
      cache.set(key, { at: Date.now(), rows })
      setSt({ rows, loading: false, error: null })
    } catch (e) {
      setSt((s) => ({ ...s, loading: false, error: e.message }))
    }
  }, [key])
  useEffect(() => { if (enabled) load(false) }, [load, enabled])
  return { ...st, reload: () => load(true) }
}

export const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
