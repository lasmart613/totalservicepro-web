'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';

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
  const supabase = getSupabaseClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
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

  // Helper to determine if a manual matches the selected wavelength
  const matchesWavelength = (manual: any, wavelength: string) => {
    if (!wavelength) return true;

    const title = (manual.title || '').toLowerCase();
    const brand = (manual.brand || '').toLowerCase();

    if (wavelength === 'multi') {
      return title.includes('multi') || title.includes('combination') || title.includes('dual');
    }

    // Check common wavelength patterns
    if (wavelength === '532' && (title.includes('532') || title.includes('ktp'))) return true;
    if (wavelength === '755' && (title.includes('755') || title.includes('alex'))) return true;
    if (wavelength === '1064' && (title.includes('1064') || title.includes('nd:yag') || title.includes('ndyag'))) return true;
    if (wavelength === '10600' && (title.includes('co2') || title.includes('10600'))) return true;
    if (wavelength === '595' && (title.includes('595') || title.includes('dye') || title.includes('pdl'))) return true;

    return false;
  };

  // Group by brand and filter by wavelength
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

  // Color coding
  const getBookColor = (manual: any) => {
    const title = (manual.title || '').toLowerCase();

    if (title.includes('alex') || title.includes('755')) return '#10b981';
    if (title.includes('nd:yag') || title.includes('1064')) return '#3b82f6';
    if (title.includes('co2') || title.includes('10600')) return '#ef4444';
    if (title.includes('dye') || title.includes('595')) return '#ec4899';
    if (title.includes('multi') || title.includes('combination')) return 'linear-gradient(135deg, #10b981, #3b82f6, #ec4899)';

    return '#d4af37';
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0f0f0f]">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-6">
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
          <div className="space-y-10">
            {Object.keys(groupedManuals).length === 0 && (
              <div className="text-center py-12 text-[var(--text3)]">
                No manuals found for the selected wavelength.
              </div>
            )}

            {Object.entries(groupedManuals).map(([brand, brandManuals]) => (
              <div key={brand} className="shelf-container">
                <div className="flex items-center gap-3 mb-3 px-2">
                  <div className="text-lg font-bold text-[var(--gold)]">{brand}</div>
                  <div className="flex-1 h-px bg-[var(--border)]" />
                  <div className="text-xs text-[var(--text3)]">{brandManuals.length} manuals</div>
                </div>

                {/* Horizontal Scrollable Shelf */}
                <div className="shelf overflow-x-auto pb-4">
                  <div className="flex gap-4 min-w-max px-2">
                    {brandManuals.map((m, index) => (
                      <div
                        key={index}
                        onClick={() => openManual(m)}
                        className="book w-28 flex-shrink-0 cursor-pointer group"
                        title={m.title}
                      >
                        <div
                          className="book-spine h-40 w-full rounded-sm shadow-lg flex flex-col justify-between p-2 text-white relative overflow-hidden transition-transform group-hover:scale-105"
                          style={{
                            background: getBookColor(m),
                            boxShadow: 'inset 0 0 20px rgba(0,0,0,0.3), 4px 4px 8px rgba(0,0,0,0.4)',
                          }}
                        >
                          <div className="text-[10px] font-semibold opacity-80 leading-tight line-clamp-3">
                            {m.title}
                          </div>
                          <div className="text-[9px] opacity-70 mt-auto">{m.brand}</div>
                          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-black/20" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}