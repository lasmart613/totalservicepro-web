'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient, getSupabaseUrl } from '@/lib/supabase/client';

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
      if (user) {
        const { data: owned } = await supabase
          .from('user_manuals')
          .select('manual_id, manuals(*)')
          .eq('user_id', user.id);
        setMyLibrary((owned || []).map((o: any) => o.manuals).filter(Boolean));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function openManual(m: any) {
    try {
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = getSupabaseUrl();

      if (!supabaseUrl) throw new Error('Supabase URL not configured');

      const resp = await fetch(`${supabaseUrl}/functions/v1/get-manual-url`, {
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
        alert('Could not open manual: ' + (json.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Failed to open manual: ' + e.message);
    }
  }

  const matchesWavelength = (manual: any, wavelength: string) => {
    if (!wavelength) return true;
    const title = (manual.title || '').toLowerCase();

    if (wavelength === 'multi') return title.includes('multi') || title.includes('combination');
    if (wavelength === '532') return title.includes('532') || title.includes('ktp');
    if (wavelength === '755') return title.includes('755') || title.includes('alex');
    if (wavelength === '1064') return title.includes('1064') || title.includes('nd:yag');
    if (wavelength === '10600') return title.includes('co2') || title.includes('10600');
    if (wavelength === '595') return title.includes('595') || title.includes('dye') || title.includes('pdl');
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

  return (
    <div className="min-h-screen flex flex-col bg-[#111827]">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">📚 Service Manuals</h1>
            <p className="text-sm text-[var(--text3)]">Bookshelf view • Filter by wavelength</p>
          </div>

          {/* Wavelength Filter */}
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
              <div className="text-center py-12 text-[var(--text3)]">No manuals found for this filter.</div>
            )}

            {Object.entries(groupedManuals).map(([brand, brandManuals]) => (
              <div key={brand}>
                {/* Books Row */}
                <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
                  {brandManuals.map((m, index) => (
                    <div
                      key={index}
                      onClick={() => openManual(m)}
                      className="group relative w-[88px] flex-shrink-0 cursor-pointer"
                      title={m.title}
                    >
                      <div
                        className="book-spine h-48 w-full rounded-sm flex flex-col justify-between p-3 text-white shadow-xl transition-all duration-200 group-hover:-translate-y-0.5 group-hover:scale-[1.03]"
                        style={{
                          background: getBookColor(m),
                          boxShadow: `
                            inset 0 0 30px rgba(0,0,0,0.5),
                            inset -10px 0 15px rgba(255,255,255,0.1),
                            6px 8px 14px rgba(0,0,0,0.55)
                          `,
                          borderLeft: '4px solid rgba(0,0,0,0.3)',
                        }}
                      >
                        {/* Subtle texture */}
                        <div 
                          className="absolute inset-0 rounded-sm pointer-events-none"
                          style={{
                            background: `repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255,255,255,0.06) 2px, rgba(255,255,255,0.06) 3px)`
                          }}
                        />

                        <div className="text-[10px] font-semibold leading-tight line-clamp-6 relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                          {m.title}
                        </div>

                        <div className="h-[3px] w-full bg-black/40 rounded relative z-10 mt-auto" />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Wooden Shelf */}
                <div 
                  className="h-7 rounded-md flex items-center px-4 mt-1 shadow-inner"
                  style={{
                    background: 'linear-gradient(to bottom, #854d0e 0%, #5c3311 45%, #3f230c 100%)',
                    boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.2), inset 0 -2px 4px rgba(0,0,0,0.6)',
                  }}
                >
                  <span className="text-sm font-bold text-[#f5d9a0] tracking-wider">
                    {brand}
                  </span>
                  <span className="ml-auto text-xs text-[#d4af37]/70">
                    {brandManuals.length} manuals
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}