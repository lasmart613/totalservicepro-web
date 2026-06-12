'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';

export default function ManualsLibrary() {
  const [manuals, setManuals] = useState<any[]>([]);
  const [myLibrary, setMyLibrary] = useState<any[]>([]);
  const [tab, setTab] = useState<'browse' | 'library'>('browse');
  const [loading, setLoading] = useState(true);
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
    // Call the edge function for signed URL (same as Android)
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

  const list = tab === 'browse' ? manuals : myLibrary;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-5">
        <h1 className="text-2xl font-extrabold mb-1">📚 Service Manuals</h1>
        <p className="text-sm text-[var(--text3)] mb-4">Color-coded bookshelf • Premium access via your subscription</p>

        <div className="flex border-b border-[var(--border)] mb-4">
          <button onClick={() => setTab('browse')} className={`px-5 py-2 font-semibold text-sm ${tab === 'browse' ? 'border-b-2 border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}>Browse All</button>
          <button onClick={() => setTab('library')} className={`px-5 py-2 font-semibold text-sm ${tab === 'library' ? 'border-b-2 border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}>My Library</button>
        </div>

        {loading ? <div className="p-8 text-center">Loading manuals...</div> : (
          <div className="shelf">
            <div className="flex flex-wrap gap-4">
              {list.length === 0 && <div className="text-sm p-4 text-[#d4af37]">No manuals in this view. Add via the mobile app or contact support.</div>}
              {list.map((m, idx) => (
                <div key={idx} className="book" onClick={() => openManual(m)} title={m.title}>
                  <div className="book-spine" style={{ background: m.brand?.toLowerCase().includes('candela') ? '#3a2a1f' : m.brand?.toLowerCase().includes('lumenis') ? '#2f3a2a' : '#3a2f22' }}>
                    <div className="book-title">{m.title}</div>
                    <div style={{ fontSize: '7px', opacity: 0.7 }}>{m.brand}</div>
                  </div>
                  {tab === 'browse' && myLibrary.some((o: any) => o.id === m.id) && (
                    <div className="owned-badge text-[9px]">OWNED</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 text-xs text-[var(--text3)]">Tip: Premium manuals (Candela etc.) require active subscription. PDFs open in new tab via secure signed URLs.</div>
      </div>
    </div>
  );
}
