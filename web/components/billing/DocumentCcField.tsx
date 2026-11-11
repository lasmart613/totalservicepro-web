'use client';

import { useT } from '@/lib/fa/locale';

/**
 * Optional CC for one document send. Never prefilled with the ops blind copy.
 */
export default function DocumentCcField({
  value,
  onChange,
  disabled,
  id = 'document-cc',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const t = useT();
  const hintId = `${id}-hint`;
  return (
    <div className="sm:col-span-2">
      <label className="text-xs text-[var(--text3)]" htmlFor={id}>
        {t('CC')}
      </label>
      <input
        id={id}
        className="input mt-1"
        type="text"
        inputMode="email"
        autoComplete="off"
        data-field="document-cc"
        placeholder="billing@clinic.com, office@clinic.com"
        value={value}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={hintId} className="text-[11px] text-[var(--text3)] mt-1">
        {t(
          'Optional. Separate multiple addresses with commas. They are copied on this email. The To address stays the one on file.'
        )}
      </p>
    </div>
  );
}
