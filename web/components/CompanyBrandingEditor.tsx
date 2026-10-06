'use client';
import { useFormatDate } from '@/lib/use-format-date';
import { useT } from '@/lib/fa/locale';

import React, { useEffect, useState } from 'react';
import { UpgradePlanLink } from '@/components/UpgradePlanLink';
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
  label: 'Primary' | 'Accent';
  value: string;
  onChange: (hex: string) => void;
}) {
  const t = useT();
  const normalized = normalizeHex(value);
  const check = contrastCheck(normalized || '#111827');
  const pickerLabel = label === 'Accent' ? t('Accent picker') : t('Primary picker');
  const hexLabel = label === 'Accent' ? t('Accent hex') : t('Primary hex');
  return (
    <div>
      <label className="label">{t(label)}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={pickerLabel}
          className="h-10 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent p-1"
          value={normalized || '#111827'}
          onChange={(e) => onChange(normalizeHex(e.target.value) || '')}
        />
        <input
          className="input font-mono uppercase"
          aria-label={hexLabel}
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
        {t('Text')} {check.text === '#FFFFFF' ? t('white') : t('dark')} · {check.ratio.toFixed(2)}:1{' '}
        {check.aaa ? 'AAA' : check.aa ? 'AA' : t('below AA')}
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
  const t = useT();
  const { format, locale } = useFormatDate();
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
    format('2026-09-28'),
    { theme: preview, themeScope: 'document', locale }
  );

  return (
    <div className="space-y-5">
      {showLogoUpload && (
        <div>
          <label className="label">{t('Company logo')}</label>
          <div
            className="cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center"
            onClick={() => document.getElementById('brandLogoInput')?.click()}
          >
            {logoUrl ? (
              <img src={logoUrl} alt={t('Company logo')} className="mx-auto max-h-20" />
            ) : (
              <div className="text-sm text-[var(--text2)]">
                {uploadingLogo ? t('Uploading...') : t('Tap to choose a logo (PNG, JPG, WebP, or SVG)')}
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
              {t('Remove logo')}
            </button>
          )}
        </div>
      )}

      {premium ? (
        <div className="space-y-4">
          <div>
            <div className="label">{t('Presets')}</div>
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
                    {t(preset.label)}
                  </button>
                );
              })}
              <button
                type="button"
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text3)]"
                onClick={() => commitPair(CLEARED_BRAND_COLORS.primary, CLEARED_BRAND_COLORS.accent)}
              >{t('RepairPlanet default')}</button>
            </div>
          </div>

          {suggestions && (
            <div>
              <div className="label">{t('Suggested from your logo')}</div>
              <button
                type="button"
                className="flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs"
                onClick={() => commitPair(suggestions.primary, suggestions.accent)}
              >
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: suggestions.primary }} />
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: suggestions.accent }} />
                {t('Use {primary} and {accent}').split('{primary}')[0]}
                <bdi dir="ltr">{suggestions.primary}</bdi>
                {t('Use {primary} and {accent}').split('{primary}')[1]?.split('{accent}')[0]}
                <bdi dir="ltr">{suggestions.accent}</bdi>
                {t('Use {primary} and {accent}').split('{accent}')[1]}
              </button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Primary" value={primary} onChange={(hex) => commitPair(hex, accent)} />
            <ColorField label="Accent" value={accent} onChange={(hex) => commitPair(primary, hex)} />
          </div>
          <p className="text-xs text-[var(--text3)]" dir="auto">
            {t('Text on each color is chosen automatically so it stays readable. AA is the WCAG target for body text.')}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface3)] p-4">
          <div className="font-semibold">{t('Custom colors are a Premium feature')}</div>
          <p className="mt-1 text-sm text-[var(--text2)]" dir="auto">
            {t('Free accounts keep the RepairPlanet theme on invoices, estimates, service reports, and customer emails. Your logo still appears. Upgrade to set a primary and accent color.')}
          </p>
          <UpgradePlanLink className="btn btn-primary mt-3 inline-flex text-sm">{t('Upgrade to Premium')}</UpgradePlanLink>
        </div>
      )}

      <div>
        <div className="label">{t('Invoice header preview')}</div>
        <div
          className="overflow-hidden rounded-xl border border-[var(--border)] bg-white p-4 text-black"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    </div>
  );
}
