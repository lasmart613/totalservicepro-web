'use client';

import { useT } from '@/lib/fa/locale';

export type OrgType = 'service' | 'clinic' | 'supplier';

/** Step 1. The loop variable must not be named `t` — that shadows useT(). */
export function OrgTypeStep({
  selected,
  onSelect,
}: {
  selected: OrgType | null;
  onSelect: (next: OrgType) => void;
}) {
  const t = useT();
  return (
    <div>
      <h2 className="text-2xl font-semibold text-center mb-6">{t('Confirm your organization type')}</h2>
      <div className="grid md:grid-cols-3 gap-4">
        {(['service', 'clinic', 'supplier'] as OrgType[]).map((orgType) => (
          <button key={orgType} onClick={() => onSelect(orgType)} className={`card p-6 text-left hover:border-[var(--gold)] ${selected === orgType ? 'border-[var(--gold)]' : ''}`}>
            <div className="text-2xl mb-2">{orgType === 'service' ? '👷' : orgType === 'clinic' ? '🏥' : '📦'}</div>
            <div className="font-bold">{orgType === 'service' ? 'Repair company' : orgType === 'clinic' ? 'Laser Owner (Clinic / Rental / Reseller)' : t('Parts Supplier')}</div>
            <div className="text-sm text-[var(--text3)]">{t('Click to select')}</div>
          </button>
        ))}
      </div>
      <div className="mt-6 text-xs text-[var(--text3)]">{t('Field engineers and service techs are added as roles inside a repair company (you can add them during this flow or later in Company > Team).')}</div>
    </div>
  );
}
