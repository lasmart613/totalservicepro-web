'use client';

import React from 'react';
import { paramDisplayLabel, paramInputMode, paramStorageKey, type ModelParam } from '@/lib/models';

export function SystemParameterFields({
  params,
  values,
  onChange,
}: {
  params: ModelParam[];
  values: Record<string, any>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {params.map((param) => {
        const key = paramStorageKey(param);
        const label = paramDisplayLabel(param);
        const mode = paramInputMode(param);
        return (
          <div key={key}>
            <label className="text-xs font-semibold text-[var(--text2)]" htmlFor={`param-${slug(key)}`}>
              {label}
            </label>
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
