import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)

// A hung request on a weak plant connection should fail (so it can be queued), not spin forever.
function timeoutFetch(input, init = {}) {
  const ctrl = new AbortController()
  const slow = String(input).includes('/storage/v1/')
  const t = setTimeout(() => ctrl.abort(), slow ? 120000 : 20000)
  if (init.signal) init.signal.addEventListener('abort', () => ctrl.abort())
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t))
}

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  global: { fetch: timeoutFetch },
})
