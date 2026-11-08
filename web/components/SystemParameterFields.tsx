'use client';

import React from 'react';
import { paramDisplayLabel, paramInputMode, paramStorageKey, type ModelParam } from '@/lib/models';

export function SystemParameterFields({
  params,
  values,
  onChange,
  onRemove,
  removeLabel = 'Remove parameter',
}: {
  params: ModelParam[];
  values: Record<string, any>;
  onChange: (key: string, value: string) => void;
  /** When set, each row gets an × so the tech can drop it for this job. */
  onRemove?: (key: string) => void;
  removeLabel?: string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {params.map((param) => {
        const key = paramStorageKey(param);
        const label = paramDisplayLabel(param);
        const mode = paramInputMode(param);
        return (
          <div key={key}>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-[var(--text2)]" htmlFor={`param-${slug(key)}`}>
                {label}
              </label>
              {onRemove && (
                <button
                  type="button"
                  className="text-xs text-[var(--text3)] hover:text-red-500 px-1"
                  data-testid={`param-remove-${slug(key)}`}
                  aria-label={`${removeLabel}: ${label}`}
                  title={removeLabel}
                  onClick={() => onRemove(key)}
                >
                  ×
                </button>
              )}
            </div>
            <input
              id={`param-${slug(key)}`}
              className="input"
              data-testid={`param-${slug(key)}`}
              type={mode === 'text' ? 'text' : 'number'}
              inputMode={mode === 'text' ? 'text' : mode === 'numeric' ? 'numeric' : 'decimal'}
              step={mode === 'numeric' ? '1' : mode === 'text' ? undefined : 'any'}
              min={mode === 'numeric' ? '0' : undefined}
              value={values[key] ?? ''}
              onChange={(e) => onChange(key, e.target.value)}
              placeholder={label}
            />
          </div>
        );
      })}
    </div>
  );
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
