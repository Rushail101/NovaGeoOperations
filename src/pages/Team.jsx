import { DataPage, Badge } from '../lib.jsx'
import { ASSIGNABLE_ROLES, ROLE_LABELS } from '../perms.js'

export default function Team() {
  return (
    <DataPage
      title="Team and roles"
      table="profiles"
      order="created_at"
      asc
      addable={false}
      canDelete={false}
      extra={
        <div className="card">
          <strong>Adding a person</strong>
          <ol className="muted">
            <li>Supabase &gt; Authentication &gt; Users &gt; Add user. Email: <code>username@ops.local</code> (for example <code>gate@ops.local</code>), password: their PIN (6 or more characters). Tick Auto Confirm User.</li>
            <li>They appear here as Pending. Give them a role, then they can sign in with just <em>username</em> and PIN.</li>
            <li>To reset someone's PIN, change the password of that user in Supabase.</li>
          </ol>
        </div>
      }
      fields={[
        { name: 'full_name', label: 'Full name' },
        { name: 'role', label: 'Role', type: 'select', required: true, options: ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) },
        { name: 'active', label: 'Active (untick to block sign-in)', type: 'checkbox' },
      ]}
      columns={[
        { label: 'Username', key: 'username' },
        { label: 'Name', key: 'full_name' },
        { label: 'Role', render: (r) => <Badge tone={r.role === 'pending' ? 'amber' : 'blue'}>{ROLE_LABELS[r.role]}</Badge> },
        { label: 'Active', render: (r) => (r.active ? 'Yes' : <Badge tone="red">Blocked</Badge>) },
      ]}
    />
  )
}
