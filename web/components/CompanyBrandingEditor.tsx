'use client';

import React, { useEffect, useState } from 'react';
import { UpgradePlanLink } from '@/components/UpgradePlanLink';
import { LegalLinks } from '@/components/legal/LegalLinks';
import { buildDocTopHeader } from '@/lib/billing/doc-html';
import {
  BRAND_COLOR_PRESETS,
  CLEARED_BRAND_COLORS,
  contrastCheck,
  normalizeHex,
  resolveCompanyTheme,
  suggestBrandColorsFromUrl,
  type SuggestedBrandColors,
} from '@/lib/company-theme';

type CompanyBrandingEditorProps = {
  premium: boolean;
  companyName?: string;
  logoUrl?: string | null;
  primary: string;
  accent: string;
  onPrimaryChange?: (hex: string) => void;
  onAccentChange?: (hex: string) => void;
  /** Sets primary and accent together. Settings uses this so a preset cannot lose one color. */
  onColorsChange?: (primary: string, accent: string) => void;
  onLogoFile?: (file: File) => void;
  onLogoClear?: () => void;
  uploadingLogo?: boolean;
  /** Onboarding draws the file picker here. Company settings keeps its own logo control. */
  showLogoUpload?: boolean;
};

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const normalized = normalizeHex(value);
  const check = contrastCheck(normalized || '#111827');
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-10 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent p-1"
          value={normalized || '#111827'}
          onChange={(e) => onChange(normalizeHex(e.target.value) || '')}
        />
        <input
          className="input font-mono uppercase"
          aria-label={`${label} hex`}
          value={value}
          placeholder="#112233"
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const next = normalizeHex(value);
            if (next) onChange(next);
            else if (value.trim()) onChange('');
          }}
        />
      </div>
      <p className="mt-1 text-[11px] text-[var(--text3)]">
        Text {check.text === '#FFFFFF' ? 'white' : 'dark'} · {check.ratio.toFixed(2)}:1{' '}
        {check.aaa ? 'AAA' : check.aa ? 'AA' : 'below AA'}
      </p>
    </div>
  );
}

export function CompanyBrandingEditor({
  premium,
  companyName,
  logoUrl,
  primary,
  accent,
  onPrimaryChange,
  onAccentChange,
  onColorsChange,
  onLogoFile,
  onLogoClear,
  uploadingLogo,
  showLogoUpload,
}: CompanyBrandingEditorProps) {
  const [suggestions, setSuggestions] = useState<SuggestedBrandColors | null>(null);

  useEffect(() => {
    if (!premium || !logoUrl) {
      setSuggestions(null);
      return;
    }
    let cancelled = false;
    suggestBrandColorsFromUrl(logoUrl).then((next) => {
      if (!cancelled) setSuggestions(next);
    });
    return () => {
      cancelled = true;
    };
  }, [premium, logoUrl]);

  function commitPair(nextPrimary: string, nextAccent: string) {
    if (onColorsChange) {
      onColorsChange(nextPrimary, nextAccent);
      return;
    }
    onPrimaryChange?.(nextPrimary);
    onAccentChange?.(nextAccent);
  }

  const preview = resolveCompanyTheme(
    premium
      ? {
          is_premium: true,
          name: companyName || '',
          logo_url: logoUrl || null,
          brand_primary_color: normalizeHex(primary),
          brand_accent_color: normalizeHex(accent),
        }
      : {
          is_premium: false,
          name: companyName || '',
          logo_url: logoUrl || null,
          brand_primary_color: primary,
          brand_accent_color: accent,
        }
  );
  const previewHtml = buildDocTopHeader(
    {
      company_name: companyName || preview.companyName,
      address: '100 Clinic Way',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      phone: '(512) 555-0148',
      email: 'billing@example.com',
      logo_url: logoUrl || '',
    },
    'Invoice',
    'INV-1042',
    'Sep 28, 2026',
    { theme: preview, themeScope: 'document' }
  );

  return (
    <div className="space-y-5">
      {showLogoUpload && (
        <div>
          <label className="label">Company logo</label>
          <div
            className="cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center"
            onClick={() => document.getElementById('brandLogoInput')?.click()}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="Company logo" className="mx-auto max-h-20" />
            ) : (
              <div className="text-sm text-[var(--text2)]">
                {uploadingLogo ? 'Uploading…' : 'Tap to choose a logo (PNG, JPG, WebP, or SVG)'}
              </div>
            )}
          </div>
          <input
            id="brandLogoInput"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onLogoFile) onLogoFile(file);
              e.target.value = '';
            }}
          />
          {logoUrl && onLogoClear && (
            <button type="button" onClick={onLogoClear} className="mt-2 text-xs text-red-400">
              Remove logo
            </button>
          )}
        </div>
      )}

      {premium ? (
        <div className="space-y-4">
          <div>
            <div className="label">Presets</div>
            <div className="flex flex-wrap gap-2">
              {BRAND_COLOR_PRESETS.map((preset) => {
                const active =
                  normalizeHex(primary) === preset.primary && normalizeHex(accent) === preset.accent;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => commitPair(preset.primary, preset.accent)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                      active ? 'border-[var(--gold)]' : 'border-[var(--border)]'
                    }`}
                  >
                    <span
                      className="inline-block h-3 w-3 rounded-full border border-black/20"
                      style={{ background: preset.primary }}
                    />
                    <span
                      className="inline-block h-3 w-3 rounded-full border border-black/20"
                      style={{ background: preset.accent }}
                    />
                    {preset.label}
                  </button>
                );
              })}
              <button
                type="button"
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text3)]"
                onClick={() => commitPair(CLEARED_BRAND_COLORS.primary, CLEARED_BRAND_COLORS.accent)}
              >
                RepairPlanet default
              </button>
            </div>
          </div>

          {suggestions && (
            <div>
              <div className="label">Suggested from your logo</div>
              <button
                type="button"
                className="flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs"
                onClick={() => commitPair(suggestions.primary, suggestions.accent)}
              >
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: suggestions.primary }} />
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: suggestions.accent }} />
                Use {suggestions.primary} and {suggestions.accent}
              </button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Primary" value={primary} onChange={(hex) => commitPair(hex, accent)} />
            <ColorField label="Accent" value={accent} onChange={(hex) => commitPair(primary, hex)} />
          </div>
          <p className="text-xs text-[var(--text3)]">
            Text on each color is chosen automatically so it stays readable. AA is the WCAG target for body text.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface3)] p-4">
          <div className="font-semibold">Custom colors are a Premium feature</div>
          <p className="mt-1 text-sm text-[var(--text2)]">
            Free accounts keep the RepairPlanet theme on invoices, estimates, service reports, and customer emails.
            Your logo still appears. Upgrade to set a primary and accent color.
          </p>
          <UpgradePlanLink className="btn btn-primary mt-3 inline-flex text-sm">Upgrade to Premium</UpgradePlanLink>
          <LegalLinks className="mt-2" />
        </div>
      )}

      <div>
        <div className="label">Invoice header preview</div>
        <div
          className="overflow-hidden rounded-xl border border-[var(--border)] bg-white p-4 text-black"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    </div>
  );
}
