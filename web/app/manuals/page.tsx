'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { ShelfScroller } from '@/components/ShelfScroller';
import { getSupabaseClient, getSupabaseUrl } from '@/lib/supabase/client';
import { isUnlimitedManualSlots, manualSlotLimit } from '@/lib/org-plan';
import { useRouter } from 'next/navigation';
import { manualViewHref, stashManualView, type ManualViewPayload } from '@/lib/manuals';
import { toast } from 'sonner';

const WAVELENGTH_OPTIONS = [
  { label: 'All Wavelengths', value: '' },
  { label: '532nm (KTP)', value: '532' },
  { label: '755nm (Alexandrite)', value: '755' },
  { label: '1064nm (Nd:YAG)', value: '1064' },
  { label: '10,600nm (CO₂)', value: '10600' },
  { label: '585-595nm (Pulsed Dye)', value: '595' },
  { label: 'Multi-Wavelength', value: 'multi' },
];

const DEFAULT_SLOT_LIMIT = 5; // free default; Premium is 15 via manualSlotLimit()

export default function ManualsLibrary() {
  const router = useRouter();
  const [manuals, setManuals] = useState<any[]>([]);
  const [myLibrary, setMyLibrary] = useState<any[]>([]);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'browse' | 'library'>('browse');
  const [loading, setLoading] = useState(true);
  const [selectedWavelength, setSelectedWavelength] = useState('');
  const [slotLimit, setSlotLimit] = useState(DEFAULT_SLOT_LIMIT);
  const [orgId, setOrgId] = useState<string | number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const supabase = getSupabaseClient();
    try {
      const { data: all } = await supabase.from('manuals').select('*').order('brand').order('title');
      setManuals(all || []);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setMyLibrary([]);
        setOwnedIds(new Set());
        return;
      }

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      const oId = prof?.organization_id ?? null;
      setOrgId(oId);
      if (oId != null) {
        let org: Record<string, unknown> | null = null;
        let orgRes = await supabase
          .from('organizations')
          .select('manual_slots, subscription_tier, plan, is_premium')
          .eq('id', oId)
          .maybeSingle();
        if (orgRes.error && /subscription_tier|plan|manual_slots|column/i.test(orgRes.error.message || '')) {
          orgRes = await supabase
            .from('organizations')
            .select('is_premium, subscription_tier, plan')
            .eq('id', oId)
            .maybeSingle();
        }
        if (orgRes.error && /subscription_tier|plan|column/i.test(orgRes.error.message || '')) {
          orgRes = await supabase.from('organizations').select('is_premium').eq('id', oId).maybeSingle();
        }
        org = orgRes.data as Record<string, unknown> | null;
        setSlotLimit(manualSlotLimit(org));
      } else {
        setSlotLimit(DEFAULT_SLOT_LIMIT);
      }

      const ids = new Set<string>();
      const lib: any[] = [];

      // Company library (preferred)
      if (oId != null) {
        const { data: orgOwned, error: omErr } = await supabase
          .from('organization_manuals')
          .select('manual_id, manuals(*)')
          .eq('organization_id', oId);
        if (!omErr && orgOwned) {
          orgOwned.forEach((row: any) => {
            if (row.manual_id != null) ids.add(String(row.manual_id));
            if (row.manuals) lib.push(row.manuals);
          });
        }
      }

      // Legacy personal library merge
      const { data: userOwned } = await supabase
        .from('user_manuals')
        .select('manual_id, manuals(*)')
        .eq('user_id', user.id);
      (userOwned || []).forEach((row: any) => {
        if (row.manual_id != null) ids.add(String(row.manual_id));
        if (row.manuals && !lib.some((m) => String(m.id) === String(row.manuals.id))) {
          lib.push(row.manuals);
        }
      });

      setOwnedIds(ids);
      setMyLibrary(lib);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function isOwned(m: any): boolean {
    return m?.id != null && ownedIds.has(String(m.id));
  }

  async function callGetManualUrl(payload: Record<string, unknown>) {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) throw new Error('Supabase URL not configured');
    if (!session?.access_token) throw new Error('Please log in first');

    // Edge auth (same as Android pdf_viewer): short anon key in Authorization.
    // Large ES256 user JWTs in Authorization can get HTML 400 from the gateway
    // before the function runs. User JWT goes in the JSON body only.
    const anon =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      '';
    if (!anon) throw new Error('Supabase anon key not configured');
    const resp = await fetch(`${supabaseUrl}/functions/v1/get-manual-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anon}`,
        apikey: anon,
      },
      body: JSON.stringify({
        ...payload,
        access_token: session.access_token,
      }),
    });
    const json = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, json };
  }

  /** Client-side add when edge action=add unavailable; mirrors Android flow */
  async function addToCompanyLibrary(m: any): Promise<boolean> {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Please log in first');
      return false;
    }
    if (orgId == null) {
      toast.error('No service company on your profile — complete onboarding first. Manuals are shared by your organization.');
      return false;
    }
    if (!isUnlimitedManualSlots(slotLimit) && ownedIds.size >= slotLimit) {
      toast.error(`Library full (${ownedIds.size}/${slotLimit}). Upgrade or remove a manual.`);
      return false;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token) {
      try {
        const res = await fetch('/api/manuals/library', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ manual_id: m.id }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          personal?: boolean;
          slot_limit?: number;
        };
        if (res.ok && json?.ok) {
          if (json.personal) {
            toast.message('Added to personal library (company library table not set up yet)');
          }
          if (json.slot_limit != null) setSlotLimit(Number(json.slot_limit) || slotLimit);
          return true;
        }
        if (res.status === 409) {
          toast.error(json?.error || `Library full (${ownedIds.size}/${slotLimit}). Upgrade or remove a manual.`);
          return false;
        }
        if (json?.error && res.status < 500) {
          toast.error(json.error);
          return false;
        }
      } catch {
        /* API unreachable — fall through to local insert, still capped above */
      }
    }

    // Fallback only if the API is unavailable; still honor the local Premium=15 cap.
    let { error } = await supabase.from('organization_manuals').insert({
      organization_id: orgId,
      manual_id: m.id,
      added_by: user.id,
    });
    if (error && /duplicate|unique|23505/i.test(error.message || '')) {
      return true;
    }
    if (error && /schema cache|does not exist|relation/i.test(error.message || '')) {
      const um = await supabase.from('user_manuals').insert({
        user_id: user.id,
        manual_id: m.id,
      });
      if (um.error && !/duplicate|unique|23505/i.test(um.error.message || '')) {
        toast.error(um.error.message || 'Could not add manual');
        return false;
      }
      toast.message('Added to personal library (company library table not set up yet)');
      return true;
    }
    if (error) {
      toast.error(error.message || 'Could not add to company library');
      return false;
    }
    return true;
  }

  function openInAppViewer(json: any, manual: any, titleHint?: string) {
    const payload: ManualViewPayload = {
      manualId: manual?.id ?? null,
      title: titleHint || manual?.title || 'Service Manual',
      storagePath: json?.storage_path || manual?.storage_path || null,
      url: json?.url || null,
      dataBase64: json?.data_base64 || null,
      contentType: json?.content_type || null,
      chapters: Array.isArray(json?.chapters) ? json.chapters : null,
    };
    stashManualView(payload);
    router.push(manualViewHref({ id: payload.manualId, title: payload.title }));
    return true;
  }

  function openPayloadUrl(json: any, manual: any, titleHint?: string) {
    if (json?.url || json?.data_base64) {
      return openInAppViewer(json, manual, titleHint);
    }
    // Folder response without auto-resolved URL: open first chapter PDF
    if (Array.isArray(json?.chapters) && json.chapters.length) {
      const first = json.chapters.find((c: any) => c?.storage_path) || json.chapters[0];
      if (first?.storage_path) {
        // Caller will re-request with chapter path when this returns 'chapter'
        (openPayloadUrl as any)._pendingChapter = first.storage_path;
        return 'chapter' as const;
      }
    }
    return false;
  }

  async function openManual(m: any) {
    try {
      const payload: Record<string, unknown> = {
        manual_id: m.id,
        storage_path: m.storage_path,
      };
      const { json, status } = await callGetManualUrl(payload);

      const opened = openPayloadUrl(json, m, m.title);
      if (opened === true) return;
      if (opened === 'chapter') {
        const chapterPath = (openPayloadUrl as any)._pendingChapter;
        const chRes = await callGetManualUrl({
          manual_id: m.id,
          storage_path: chapterPath,
        });
        if (openPayloadUrl({ ...chRes.json, chapters: json.chapters }, m, m.title) === true) return;
        toast.error(chRes.json.error || 'Could not open first chapter');
        return;
      }

      // Not in library → offer to add (Browse All)
      const needsAdd =
        json.requires_add === true ||
        /not in company library|access denied/i.test(String(json.error || ''));

      if (needsAdd) {
        if (isOwned(m)) {
          // Ownership out of sync — try force-open after client add
          toast.message('Refreshing library…');
          await loadData();
        }
        const used = ownedIds.size;
        const limit = slotLimit;
        const remaining = isUnlimitedManualSlots(limit) ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
        if (!isUnlimitedManualSlots(limit) && remaining <= 0) {
          toast.error(`Company library is full (${used}/${limit}). Upgrade for more slots.`);
          return;
        }
        const confirmAdd = window.confirm(
          `Add "${m.title}" to your company library?\n\n` +
            `Slots used: ${used} of ${isUnlimitedManualSlots(limit) ? 'unlimited' : limit}` +
            `${isUnlimitedManualSlots(limit) ? '' : ` (${remaining} left)`}.\n` +
            `Everyone in your service company can open it after you add it.`
        );
        if (!confirmAdd) return;

        const added = await addToCompanyLibrary(m);
        if (!added) return;
        await loadData();
        const openRes = await callGetManualUrl(payload);
        if (openPayloadUrl(openRes.json, m, m.title) === true) {
          toast.success('Added to company library');
        } else {
          toast.error(openRes.json.error || 'Added, but could not open PDF yet. Try again from My Library.');
        }
        return;
      }

      // Empty storage / missing PDFs (e.g. Sciton placeholders)
      if (
        status === 404 ||
        /no pdf files found|not been uploaded/i.test(String(json.error || ''))
      ) {
        toast.error(
          json.error ||
            `No PDF uploaded yet for "${m.title}". The catalog entry exists, but files are missing under ${m.storage_path || 'storage'}.`
        );
        return;
      }

      toast.error(json.error || json.hint || 'Could not open manual');
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to open manual');
    }
  }

  /** Prefer DB wavelengths[] tags; fall back to title heuristics for older rows. */
  const matchesWavelength = (manual: any, wavelength: string) => {
    if (!wavelength) return true;

    const tags: string[] = Array.isArray(manual?.wavelengths)
      ? manual.wavelengths.map((w: any) => String(w).toLowerCase())
      : [];

    if (tags.length) {
      if (wavelength === 'multi') {
        // Multi pill: explicit multi tag, or 2+ primary aesthetic wavelengths
        if (tags.includes('multi')) return true;
        const primary = ['532', '755', '1064', '10600', '595'];
        return primary.filter((p) => tags.includes(p)).length >= 2;
      }
      return tags.includes(String(wavelength).toLowerCase());
    }

    // Legacy title fallback (pre-wavelengths column)
    const title = (manual.title || '').toLowerCase();
    if (wavelength === 'multi') return title.includes('multi') || title.includes('combination');
    if (wavelength === '532') return title.includes('532') || title.includes('ktp') || title.includes('greenlight');
    if (wavelength === '755') return title.includes('755') || title.includes('alex') || title.includes('gentlelase');
    if (wavelength === '1064') return title.includes('1064') || title.includes('nd:yag') || title.includes('gentleyag');
    if (wavelength === '10600') return title.includes('co2') || title.includes('10600') || title.includes('ultrapulse') || title.includes('acupulse');
    if (wavelength === '595') return title.includes('595') || title.includes('dye') || title.includes('pdl') || title.includes('vbeam') || title.includes('sclero');
    return false;
  };

  const groupedManuals = React.useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    const list = tab === 'browse' ? manuals : myLibrary;

    list.forEach((m) => {
      if (!matchesWavelength(m, selectedWavelength)) return;
      const brand = m.brand || 'Other';
      if (!groups[brand]) groups[brand] = [];
      groups[brand].push(m);
    });
    return groups;
  }, [manuals, myLibrary, tab, selectedWavelength]);

  /** Light spines so books contrast with the wood shelf; dark text on top */
  const getBookColor = (manual: any) => {
    const title = (manual.title || '').toLowerCase();
    if (title.includes('alex') || title.includes('755')) return 'linear-gradient(90deg, #f5ebe0, #fff, #f5ebe0)';
    if (title.includes('nd:yag') || title.includes('1064')) return 'linear-gradient(90deg, #e3eefc, #fff, #e3eefc)';
    if (title.includes('co2') || title.includes('10600')) return 'linear-gradient(90deg, #e6f4ea, #fff, #e6f4ea)';
    if (title.includes('dye') || title.includes('595') || title.includes('vbeam')) return 'linear-gradient(90deg, #fce8f1, #fff, #fce8f1)';
    if (title.includes('diode')) return 'linear-gradient(90deg, #fff0e6, #fff, #fff0e6)';
    if (title.includes('multi') || title.includes('combination')) return 'linear-gradient(90deg, #f0eef8, #fff, #e8f0fa)';
    return 'linear-gradient(90deg, #f4f1ea, #ffffff, #f4f1ea)';
  };

  /**
   * Wavelength → stripe color (bottom of spine). Multi-WL books get one strip per line.
   * Order is low → high nm for a consistent left-to-right stack.
   */
  const WL_STRIPE_COLORS: Record<string, { color: string; label: string; order: number }> = {
    '450': { color: '#2563eb', label: '450 nm diode', order: 10 },
    '488': { color: '#0d9488', label: '488 nm argon', order: 15 },
    argon: { color: '#14b8a6', label: 'Argon', order: 16 },
    '514': { color: '#0f766e', label: '514 nm argon', order: 17 },
    '532': { color: '#22c55e', label: '532 nm KTP', order: 20 },
    '585': { color: '#db2777', label: '585 nm PDL', order: 25 },
    '595': { color: '#ec4899', label: '595 nm PDL', order: 26 },
    '694': { color: '#ef4444', label: '694 nm ruby', order: 30 },
    ruby: { color: '#ef4444', label: 'Ruby', order: 30 },
    '755': { color: '#7f1d1d', label: '755 nm alexandrite', order: 40 },
    '810': { color: '#f59e0b', label: '810 nm diode', order: 50 },
    '940': { color: '#d97706', label: '940 nm diode', order: 55 },
    '1064': { color: '#1d4ed8', label: '1064 nm Nd:YAG', order: 60 },
    '1319': { color: '#3730a3', label: '1319 nm Nd:YAG', order: 65 },
    '1450': { color: '#c2410c', label: '1450 nm diode', order: 70 },
    '1470': { color: '#a855f7', label: '1470 nm', order: 72 },
    '1927': { color: '#9333ea', label: '1927 nm', order: 75 },
    '2013': { color: '#7c3aed', label: '2013 nm thulium', order: 80 },
    '2100': { color: '#6d28d9', label: '2100 nm holmium', order: 85 },
    '2940': { color: '#e11d48', label: '2940 nm Er:YAG', order: 90 },
    '10600': { color: '#15803d', label: '10,600 nm CO₂', order: 100 },
  };

  const getWavelengthStripes = (manual: any): Array<{ color: string; label: string; key: string }> => {
    const raw: string[] = Array.isArray(manual?.wavelengths)
      ? manual.wavelengths.map((w: any) => String(w).toLowerCase().trim())
      : [];
    // Prefer concrete wavelengths; ignore bare "multi" when specifics exist
    const concrete = raw.filter((w) => w && w !== 'multi' && WL_STRIPE_COLORS[w]);
    let keys = concrete.length ? concrete : raw.filter((w) => WL_STRIPE_COLORS[w]);
    // Deduplicate + sort by spectral order
    keys = [...new Set(keys)].sort(
      (a, b) => (WL_STRIPE_COLORS[a]?.order ?? 999) - (WL_STRIPE_COLORS[b]?.order ?? 999)
    );
    if (!keys.length && raw.includes('multi')) {
      // Platform-only multi with no line tags: show a thin rainbow hint
      return [
        { key: 'multi-g', color: '#22c55e', label: 'Multi-wavelength' },
        { key: 'multi-b', color: '#2563eb', label: 'Multi-wavelength' },
        { key: 'multi-r', color: '#ef4444', label: 'Multi-wavelength' },
      ];
    }
    return keys.map((k) => ({
      key: k,
      color: WL_STRIPE_COLORS[k].color,
      label: WL_STRIPE_COLORS[k].label,
    }));
  };

  /**
   * Spine label = model / trim only (never brand).
   * Shelf header already shows the manufacturer (e.g. OmniGuide → spine "FELS-25A").
   */
  const getSpineTitle = (fullTitle: string | null | undefined, brand?: string | null) => {
    if (!fullTitle) return 'Manual';
    let t = String(fullTitle)
      .replace(/\bService\s+Manuals?\b/gi, ' ')
      .replace(/\bOperator'?s?\s+Manuals?\b/gi, ' ')
      .replace(/\bUser\s+Manuals?\b/gi, ' ')
      .replace(/\bTechnical\s+Manuals?\b/gi, ' ')
      .replace(/\bParts\s*(?:and|&)\s*Service\b/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    t = t.replace(/\b(Service|Manuals?|Instructions?)\b$/gi, '').trim();

    const brandRes: RegExp[] = [
      ...(brand
        ? [new RegExp(`^\\s*${String(brand).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b[\\s\\-/:]*`, 'i')]
        : []),
      /\bomni\s*guide\b[\s\-/:]*|\bomniguide\b[\s\-/:]*|\bo\s*mini\s*guide\b[\s\-/:]*/gi,
      /\bcandela\b[\s\-/:]*|\bsyneron(?:\s*candela)?\b[\s\-/:]*/gi,
      /\blumenis\b[\s\-/:]*|\bcoherent\b[\s\-/:]*|\bcynosure\b[\s\-/:]*|\bpalomar\b[\s\-/:]*/gi,
      /\bcutera\b[\s\-/:]*|\balma\b[\s\-/:]*|\bdeka\b[\s\-/:]*|\bzeiss\b[\s\-/:]*|\bnidek\b[\s\-/:]*/gi,
      /\bquanta(?:\s*system)?\b[\s\-/:]*|\biridex\b[\s\-/:]*|\blutronic\b[\s\-/:]*|\bjeisys\b[\s\-/:]*/gi,
      /\bsciton\b[\s\-/:]*|\bfotona\b[\s\-/:]*|\bellex\b[\s\-/:]*|\blightmed\b[\s\-/:]*/gi,
      /\brohrer(?:\s*aesthetics)?\b[\s\-/:]*/gi,
    ];
    for (const re of brandRes) t = t.replace(re, ' ');
    t = t.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:/|]+|[\s\-–—:/|]+$/g, '').trim();
    if (!t) t = String(fullTitle).replace(/\bService\s+Manuals?\b/gi, '').trim() || 'Manual';

    // Model shortcuts (no brand)
    if (/fels[-\s]?25a|intelliguide/i.test(t) || /fels[-\s]?25a|intelliguide/i.test(fullTitle)) return 'FELS-25A';
    if (/v-?beam.*perfecta/i.test(t)) return 'VBEAM PF';
    if (/gentlemax\s*pro/i.test(t)) return 'GENTLEMAX PRO';
    if (/excel\s*hr/i.test(t)) return 'EXCEL HR';

    if (t.length > 32) t = t.slice(0, 30).trimEnd() + '…';
    return t;
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">📚 Service Manuals</h1>
            <p className="text-sm text-[var(--text3)]">Bookshelf view • Filter by wavelength</p>
          </div>

          {/* Wavelength Filter Pills */}
          <div className="flex flex-wrap gap-2">
            {WAVELENGTH_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setSelectedWavelength(option.value)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-all ${
                  selectedWavelength === option.value
                    ? 'bg-[var(--gold)] text-black border-[var(--gold)]'
                    : 'border-[var(--border)] text-[var(--text3)] hover:border-[var(--gold)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)] mb-8">
          <button
            onClick={() => setTab('browse')}
            className={`px-6 py-2 text-sm font-semibold ${tab === 'browse' ? 'border-b-2 border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}
            title={`${manuals.length} manuals in the catalog`}
          >
            Browse All{' '}
            <span className="ml-1 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-[var(--surface3)] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[var(--text2,#ccc)] border border-[var(--border2)]">
              {loading ? '…' : manuals.length}
            </span>
          </button>
          <button
            onClick={() => setTab('library')}
            className={`px-6 py-2 text-sm font-semibold ${tab === 'library' ? 'border-b-2 border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}
          >
            My Library ({ownedIds.size}/{isUnlimitedManualSlots(slotLimit) ? '∞' : slotLimit})
          </button>
        </div>

        {tab === 'browse' && (
          <p className="text-sm text-[var(--text3)] mb-4">
            Tap a manual to <strong className="text-[var(--text)]">add it to your company library</strong>
            {!isUnlimitedManualSlots(slotLimit) ? ` (${Math.max(0, slotLimit - ownedIds.size)} slots left)` : ''}, then open the PDF.
            Manuals are shared with everyone in your service company.
          </p>
        )}
        {tab === 'library' && ownedIds.size === 0 && (
          <p className="text-sm text-[var(--text3)] mb-4">
            Your company library is empty. Switch to <strong className="text-[var(--gold)]">Browse All</strong> and tap a book to add it.
          </p>
        )}

        {loading ? (
          <div className="p-12 text-center text-[var(--text3)]">Loading bookshelf...</div>
        ) : (
          <div className="space-y-12">
            {Object.keys(groupedManuals).length === 0 && (
              <div className="text-center py-12 text-[var(--text3)]">No manuals found for this filter.</div>
            )}

            {Object.entries(groupedManuals).map(([brand, brandManuals]) => (
              <div key={brand} className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--gold)] px-1">
                  {brand}
                  <span className="ml-2 font-semibold normal-case tracking-normal text-[var(--text3)]">
                    {brandManuals.length} manuals
                  </span>
                </div>

                {/* Books sit on the wood ledge; carets scroll the row (no scrollbar) */}
                <div className="shelf">
                  <ShelfScroller>
                    {brandManuals.map((m, index) => {
                      const stripes = getWavelengthStripes(m);
                      const wlHint = stripes.map((s) => s.label).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
                      return (
                      <div
                        key={m.id != null ? String(m.id) : index}
                        onClick={() => openManual(m)}
                        className="book relative w-12 flex-shrink-0 cursor-pointer active:scale-[0.98]"
                        title={
                          (isOwned(m)
                            ? `${m.title} (in library — tap to open)`
                            : `${m.title} (tap to add to company library)`) +
                          (wlHint ? `\n${wlHint}` : '')
                        }
                        style={{ width: 50 + (index % 4) * 2 }}
                      >
                        <div
                          className="book-spine w-full"
                          style={{
                            background: getBookColor(m),
                            height: 138 + (index % 5) * 6,
                          }}
                        >
                          <div className="book-title relative z-10 px-0.5 text-neutral-900">
                            {getSpineTitle(m.title, m.brand)}
                          </div>
                          {stripes.length > 0 && (
                            <div className="wl-stripes" aria-hidden>
                              {stripes.map((s) => (
                                <span
                                  key={s.key}
                                  className="wl-stripe"
                                  style={{ background: s.color }}
                                  title={s.label}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        {isOwned(m) && (
                          <div className="absolute -top-1 -right-1 z-10 rounded-full bg-green-600 text-white text-[9px] font-bold px-1.5 py-0.5 shadow">
                            ✓
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </ShelfScroller>
                  <div className="shelf-ledge" aria-hidden />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}