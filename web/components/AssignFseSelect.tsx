'use client';

import { roleLabel } from '@/lib/labels';
import type { TicketAssignee } from '@/lib/ticket-assignees';

export function AssignFseSelect({
  value,
  onChange,
  assignees,
  userId,
  selfName,
  className = 'input',
}: {
  value: string;
  onChange: (id: string) => void;
  assignees: TicketAssignee[];
  userId?: string | null;
  selfName?: string;
  className?: string;
}) {
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Assign to FSE"
    >
      <option value="">Unassigned</option>
      {userId && (
        <option value={userId}>
          Me{selfName ? ` — ${selfName}` : ''}
        </option>
      )}
      {assignees
        .filter((a) => a.id !== userId)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {roleLabel(a.role)}
          </option>
        ))}
    </select>
  );
}
