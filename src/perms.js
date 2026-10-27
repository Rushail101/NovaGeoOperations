// Mirrors the row-level-security policies in migration_v2.sql (the database is the real gatekeeper;
// this file only decides which buttons and tabs to show).
const A = 'admin', S = 'supervisor', W = 'weighbridge', O = 'operator', M = 'maintenance'

export const ROLE_LABELS = {
  admin: 'Admin / Owner',
  supervisor: 'Supervisor',
  weighbridge: 'Weighbridge',
  operator: 'Mill operator / packing',
  maintenance: 'Maintenance',
  viewer: 'Viewer (read only)',
  pending: 'Pending (no access)',
}
export const ASSIGNABLE_ROLES = ['admin', 'supervisor', 'weighbridge', 'operator', 'maintenance', 'viewer', 'pending']

const PERMS = {
  mills: { insert: [A, S], update: [A, S] },
  customers: { insert: [A, S], update: [A, S] },
  suppliers: { insert: [A, S], update: [A, S] },
  grades: { insert: [A, S], update: [A, S] },
  orders: { insert: [A, S], update: [A, S] },
  weighments: { insert: [A, S, W], update: [A, S] },
  mill_runs: { insert: [A, S, O], update: [A, S, O] },
  assets: { insert: [A, S, M], update: [A, S, M] },
  maintenance_schedules: { insert: [A, S, M], update: [A, S, M] },
  maintenance_logs: { insert: [A, S, M, O], update: [A, S, M] },
  lining_inspections: { insert: [A, S, M], update: [A, S, M] },
  batches: { insert: [A, S, O], update: [A, S, O] },
  bags: { insert: [A, S, O], update: [A, S] }, // bags are created through create_bags()
  spare_items: { insert: [A, S, M], update: [A, S, M] },
  spare_moves: { insert: [A, S, M, O], update: [A, S] },
  downtime: { insert: [A, S, O, M], update: [A, S, O, M] },
  shift_notes: { insert: [A, S, W, O, M], update: [A, S] },
  dust_logs: { insert: [A, S, O], update: [A, S, O] },
  profiles: { insert: [], update: [A] },
}

export function can(role, table, action) {
  if (action === 'delete') return role === A && table !== 'profiles'
  return (PERMS[table]?.[action] || []).includes(role)
}

export const canMarkDone = (role) => [A, S, M].includes(role)
export const canHold = (role) => [A, S].includes(role)
export const canDispatch = (role) => [A, S, W].includes(role)
export const canPack = (role) => [A, S, O].includes(role)
export const isAdmin = (role) => role === A
