// Offline support.
//  - reads are cached on the device and shown (marked as saved data) when there is no signal
//  - new records and a few actions (pack bags, dispatch, mark maintenance done) are saved in an outbox and sent later
//  - bag numbers are reserved in blocks, so bags can be numbered and labelled while offline
import { useSyncExternalStore } from 'react'
import { supabase, configured } from './supabase.js'

// ---------- tiny key/value store on IndexedDB (falls back to localStorage) ----------
let dbp
function openDb() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('ballmill-ops', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  return dbp
}
export async function kvGet(key) {
  try {
    const db = await openDb()
    return await new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(key)
      q.onsuccess = () => res(q.result)
      q.onerror = () => rej(q.error)
    })
  } catch {
    try { return JSON.parse(localStorage.getItem('kv:' + key)) ?? undefined } catch { return undefined }
  }
}
export async function kvSet(key, value) {
  try {
    const db = await openDb()
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(value, key)
      tx.oncomplete = res
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    try { localStorage.setItem('kv:' + key, JSON.stringify(value)) } catch {}
  }
}

export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16) })

export function isNetworkError(e) {
  if (!e) return false
  if (e.name === 'AbortError' || e instanceof TypeError) return true
  return !e.code && /failed to fetch|networkerror|load failed|network request failed|aborted|fetch failed|timed out/i.test(`${e.message || ''} ${e.details || ''}`)
}

// ---------- shared state ----------
let state = { items: [], netDown: false, onLine: typeof navigator === 'undefined' ? true : navigator.onLine, flushing: false, lastSync: 0 }
const listeners = new Set()
function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
const subscribe = (l) => (listeners.add(l), () => listeners.delete(l))
const snapshot = () => state
export const useSync = () => useSyncExternalStore(subscribe, snapshot)
export const isOnline = () => state.onLine && !state.netDown
export const useOnline = () => {
  const s = useSync()
  return s.onLine && !s.netDown
}
export function noteNetwork(err) {
  if (isNetworkError(err)) set({ netDown: true })
  else if (state.netDown) set({ netDown: false })
}

async function persist(items) {
  set({ items })
  await kvSet('outbox', items)
}

// ---------- outbox ----------
export async function enqueue(item) {
  const items = [...state.items, { ...item, qid: uuid(), createdAt: Date.now() }]
  await persist(items)
  flush()
}
export const discard = (qid) => persist(state.items.filter((i) => i.qid !== qid))
export const retryItem = async (qid) => {
  await persist(state.items.map((i) => (i.qid === qid ? { ...i, failed: false, error: null } : i)))
  flush()
}

async function runItem(it) {
  let r
  try {
    r = it.kind === 'insert' ? await supabase.from(it.table).insert(it.payload) : await supabase.rpc(it.fn, it.args)
  } catch (e) {
    return { network: true }
  }
  const err = r.error
  if (!err) return { ok: true }
  if (isNetworkError(err)) return { network: true }
  if (err.code === '23505') return { ok: true } // already there: an earlier attempt got through
  return { error: err.message }
}

export async function flush() {
  if (state.flushing || !state.items.length || !isOnlineish()) return
  set({ flushing: true })
  let synced = 0
  try {
    for (const it of [...state.items]) {
      if (it.failed) continue
      const res = await runItem(it)
      if (res.network) {
        set({ netDown: true })
        break
      }
      set({ netDown: false })
      if (res.ok) {
        synced++
        await persist(state.items.filter((x) => x.qid !== it.qid))
      } else {
        await persist(state.items.map((x) => (x.qid === it.qid ? { ...x, failed: true, error: res.error } : x)))
      }
    }
  } finally {
    set({ flushing: false, lastSync: synced ? Date.now() : state.lastSync })
  }
  if (synced) {
    window.dispatchEvent(new CustomEvent('outbox-synced'))
    refreshBagIndex()
    ensureBagBlock()
  }
}
const isOnlineish = () => state.onLine // try even if netDown: the attempt itself finds out

// Insert now if possible, otherwise keep it on the device. The id is made here so a retry cannot duplicate it.
export async function saveInsert(table, payload, label) {
  const row = { ...payload, id: payload.id || uuid() }
  const { error } = await supabase.from(table).insert(row)
  noteNetwork(error)
  if (!error) return { synced: true, row }
  if (isNetworkError(error)) {
    await enqueue({ kind: 'insert', table, payload: row, label })
    return { queued: true, row }
  }
  throw error
}

// Call a database function now, or queue it if there is no signal. Returns { data } or { queued: true }.
export async function callRpc(fn, args, label) {
  const { data, error } = await supabase.rpc(fn, args)
  noteNetwork(error)
  if (!error) return { data }
  if (isNetworkError(error)) {
    await enqueue({ kind: 'rpc', fn, args, label })
    return { queued: true }
  }
  throw error
}

// ---------- cached reads ----------
export async function cacheGet(key) {
  return kvGet('c:' + key)
}
export function cacheSet(key, value) {
  return kvSet('c:' + key, value)
}

// ---------- bag number blocks ----------
const pad = (n) => String(n).padStart(4, '0')
export async function bagNumbersLeft() {
  const blocks = (await kvGet('bagblocks')) || []
  return blocks.reduce((a, b) => a + (b.last - b.next + 1), 0)
}
let reserving = false
export async function ensureBagBlock(min = 150) {
  if (reserving || !isOnline()) return
  reserving = true
  try {
    if ((await bagNumbersLeft()) >= min) return
    const { data, error } = await supabase.rpc('reserve_bag_numbers', { p_count: 300 })
    noteNetwork(error)
    if (error || !data) return
    const blocks = (await kvGet('bagblocks')) || []
    blocks.push({ day: data.day, next: data.first, last: data.last })
    await kvSet('bagblocks', blocks)
  } finally {
    reserving = false
  }
}
export async function takeBagNumbers(n) {
  const blocks = (await kvGet('bagblocks')) || []
  const out = []
  for (const b of blocks) {
    while (out.length < n && b.next <= b.last) out.push(`NG-${b.day}-${pad(b.next++)}`)
  }
  if (out.length < n) throw new Error('Not enough bag numbers saved on this device. Connect to the internet once to get more.')
  await kvSet('bagblocks', blocks.filter((b) => b.next <= b.last))
  return out
}

// ---------- local index of bags in stock (so scanning works offline) ----------
const BAG_SELECT =
  'id, bag_no, bag_type, weight_kg, status, packed_at, batch_id, batches(batch_no, grade_id, mesh_id, qc_hold, hold_reason, sio2_pct, fe2o3_pct, moisture_pct, whiteness_pct, grades(name), grade_meshes(mesh))'
let indexing = false
export async function refreshBagIndex() {
  if (indexing || !isOnline() || !configured) return
  indexing = true
  try {
    const bags = {}
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await supabase.from('bags').select(BAG_SELECT).eq('status', 'in_stock').order('packed_at').range(from, from + 999)
      noteNetwork(error)
      if (error) return
      data.forEach((b) => (bags[b.bag_no] = b))
      if (data.length < 1000) break
    }
    // keep bags that were made offline and have not synced yet
    const old = (await kvGet('bagindex')) || { bags: {} }
    const pending = new Set(state.items.filter((i) => i.fn === 'create_bags_numbered').flatMap((i) => i.args.p_bag_nos))
    for (const no of pending) if (old.bags[no]) bags[no] = old.bags[no]
    // and drop bags that a queued dispatch has already taken
    for (const i of state.items.filter((x) => x.fn === 'dispatch_bags')) i.args.p_bag_nos.forEach((no) => delete bags[no])
    await kvSet('bagindex', { at: Date.now(), bags })
  } finally {
    indexing = false
  }
}
export async function indexAddBags(list) {
  const idx = (await kvGet('bagindex')) || { at: 0, bags: {} }
  list.forEach((b) => (idx.bags[b.bag_no] = b))
  await kvSet('bagindex', idx)
}
export async function indexRemoveBags(nos) {
  const idx = (await kvGet('bagindex')) || { at: 0, bags: {} }
  nos.forEach((n) => delete idx.bags[n])
  await kvSet('bagindex', idx)
}
// -> { bag } | { error }
export async function lookupBag(no) {
  if (isOnline()) {
    const { data, error } = await supabase.from('bags').select(BAG_SELECT).eq('bag_no', no).maybeSingle()
    noteNetwork(error)
    if (!error) return data ? { bag: data } : { error: `${no}: no such bag` }
    if (!isNetworkError(error)) return { error: error.message }
  }
  const idx = await kvGet('bagindex')
  if (!idx) return { error: 'No signal and no saved bag list on this device yet. Open Dispatch once with a connection.' }
  const bag = idx.bags[no]
  return bag ? { bag, local: true } : { error: `${no} is not in the saved stock list (it may be dispatched, or packed after the list was saved)` }
}

// ---------- start-up ----------
let started = false
export async function startSync() {
  if (started || !configured) return
  started = true
  set({ items: (await kvGet('outbox')) || [] })
  window.addEventListener('online', () => { set({ onLine: true, netDown: false }); flush(); refreshBagIndex(); ensureBagBlock() })
  window.addEventListener('offline', () => set({ onLine: false }))
  setInterval(async () => {
    if (!state.onLine) return
    if (state.netDown || state.items.some((i) => !i.failed)) {
      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
        set({ netDown: false })
        flush()
      } catch {
        set({ netDown: true })
      }
    }
  }, 15000)
  flush()
  refreshBagIndex()
  ensureBagBlock()
}
