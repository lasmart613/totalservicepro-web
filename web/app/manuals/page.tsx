'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';
import { useRouter } from 'next/navigation';

const WAVELENGTH_OPTIONS = [
  { label: 'All Wavelengths', value: '' },
  { label: '532nm (KTP)', value: '532' },
  { label: '755nm (Alexandrite)', value: '755' },
  { label: '1064nm (Nd:YAG)', value: '1064' },
  { label: '10,600nm (CO₂)', value: '10600' },
  { label: '585-595nm (Pulsed Dye)', value: '595' },
  { label: 'Multi-Wavelength', value: 'multi' },
];

export default function ManualsLibrary() {
  const [manuals, setManuals] = useState<any[]>([]);
  const [myLibrary, setMyLibrary] = useState<any[]>([]);
  const [tab, setTab] = useState<'browse' | 'library'>('browse');
  const [loading, setLoading] = useState(true);
  const [selectedWavelength, setSelectedWavelength] = useState('');
  const [hasAccess, setHasAccess] = useState(false);
  const router = useRouter();
  const supabase = getSupabaseClient();

  useEffect(() => {
    checkAccessAndLoad();
  }, []);

  async function checkAccessAndLoad() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      // Check organization type - only service_company allowed
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (prof?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('type')
          .eq('id', prof.organization_id)
          .single();

        if (org?.type !== 'service_company') {
          setHasAccess(false);
          setLoading(false);
          return;
        }
      } else {
        setHasAccess(false);
        setLoading(false);
        return;
      }

      setHasAccess(true);
      await loadData();
    } catch (e) {
      console.error(e);
      setHasAccess(false);
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    try {
      const { data: all } = await supabase.from('manuals').select('*').order('brand').order('title');
      setManuals(all || []);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: owned } = await supabase
          .from('user_manuals')
          .select('manual_id, manuals(*)')
          .eq('user_id', user.id);
        setMyLibrary((owned || []).map((o: any) => o.manuals).filter(Boolean));
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function openManual(m: any) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch('https://yljztfajyvjzqikxdddf.supabase.co/functions/v1/get-manual-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ storage_path: m.storage_path }),
      });
      const json = await resp.json();
      if (json.url) {
        window.open(json.url, '_blank');
      } else {
        alert('Access denied or error: ' + (json.error || 'Unknown'));
      }
    } catch (e: any) {
      alert('Failed to open manual: ' + e.message);
    }
  }

  const matchesWavelength = (manual: any, wavelength: string) => {
    if (!wavelength) return true;
    const title = (manual.title || '').toLowerCase();

    if (wavelength === 'multi') {
      return title.includes('multi') || title.includes('combination') || title.includes('dual');
    }
    if (wavelength === '532' && (title.includes('532') || title.includes('ktp'))) return true;
    if (wavelength === '755' && (title.includes('755') || title.includes('alex'))) return true;
    if (wavelength === '1064' && (title.includes('1064') || title.includes('nd:yag') || title.includes('ndyag'))) return true;
    if (wavelength === '10600' && (title.includes('co2') || title.includes('10600'))) return true;
    if (wavelength === '595' && (title.includes('595') || title.includes('dye') || title.includes('pdl'))) return true;

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

  const getBookColor = (manual: any) => {
    const title = (manual.title || '').toLowerCase();
    if (title.includes('alex') || title.includes('755')) return '#166534';
    if (title.includes('nd:yag') || title.includes('1064')) return '#1e3a8a';
    if (title.includes('co2') || title.includes('10600')) return '#9f1239';
    if (title.includes('dye') || title.includes('595')) return '#831843';
    if (title.includes('multi') || title.includes('combination')) return 'linear-gradient(135deg, #166534, #1e3a8a, #831843)';
    return '#854d0e';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-md mx-auto mt-20 text-center">
          <h1 className="text-2xl font-bold mb-4">Access Restricted</h1>
          <p className="text-[var(--text3)]">The Manuals Library is only available to Service Company organizations.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#111827]">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">📚 Service Manuals</h1>
            <p className="text-sm text-[var(--text3)]">Bookshelf view • Filter by wavelength</p>
          </div>

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

        <div className="flex border-b border-[var(--border)] mb-6">
          <button
            onClick={() => setTab('browse')}
            className={`px-6 py-2 text-sm font-semibold ${tab === 'browse' ? 'border-b-2 border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}
          >
            Browse All
          </button>
          <button
            onClick={() => setTab('library')}
            className={`px-6 py-2 text-sm font-semibold ${tab === 'library' ? 'border-b-2 border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}
          >
            My Library
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-[var(--text3)]">Loading bookshelf...</div>
        ) : (
          <div className="space-y-12">
            {Object.keys(groupedManuals).length === 0 && (
              <div className="text-center py-12 text-[var(--text3)]">No manuals found for the selected filter.</div>
            )}

            {Object.entries(groupedManuals).map(([brand, brandManuals]) => (
              <div key={brand} className="shelf-container">
                <div className="flex items-center gap-3 mb-2 px-1">
                  <div className="text-xl font-bold text-[#d4af37] tracking-wide">{brand}</div>
                  <div className="flex-1 h-[2px] bg-gradient-to-r from-[#d4af37]/60 to-transparent" />
                  <div className="text-xs text-[var(--text3)] bg-[#1f2937] px-2 py-0.5 rounded">{brandManuals.length} books</div>
                </div>

                <div className="relative">
                  <div className="h-2 bg-gradient-to-b from-[#78350f] to-[#451a03] rounded mb-1 shadow-inner" />
                  <div className="shelf overflow-x-auto pb-3 -mx-1 px-1">
                    <div className="flex gap-2 min-w-max">
                      {brandManuals.map((m, index) => (
                        <div
                          key={index}
                          onClick={() => openManual(m)}
                          className="book w-24 flex-shrink-0 cursor-pointer group"
                          title={m.title}
                        >
                          <div
                            className="book-spine h-36 w-full rounded-sm flex flex-col justify-between p-2.5 text-white shadow-lg transition-all duration-200 group-hover:-translate-y-0.5"
                            style={{
                              background: getBookColor(m),
                              boxShadow: 'inset 0 0 25px rgba(0,0,0,0.35), 5px 5px 10px rgba(0,0,0,0.5)',
                            }}
                          >
                            <div className="text-[11px] font-semibold leading-tight line-clamp-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]">
                              {m.title}
                            </div>
                            <div className="h-1 w-full bg-black/20 rounded mt-auto" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="h-1.5 bg-[#451a03] rounded-b shadow-md" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}