'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function Profile() {
  const [profile, setProfile] = useState<any>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sigData, setSigData] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const supabase = getSupabaseClient();

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      let data: any = null;
      const withSig = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (withSig.error && /signature_data/i.test(withSig.error.message || '')) {
        const bare = await supabase
          .from('user_profiles')
          .select('id, first_name, last_name, phone, job_title, role, email')
          .eq('id', user.id)
          .maybeSingle();
        data = bare.data;
      } else {
        data = withSig.data;
      }
      if (data) {
        setProfile(data);
        if (data.signature_data) setSigData(data.signature_data);
      } else {
        setProfile({
          first_name: user.user_metadata?.first_name || '',
          last_name: user.user_metadata?.last_name || '',
          email: user.email,
        });
      }
      if (!data?.phone && user.user_metadata?.phone) {
        setProfile((p: any) => ({ ...p, phone: user.user_metadata.phone }));
      }
    })();
  }, [supabase]);

  // Init / paint signature canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 320;
    canvas.height = 100;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (sigData && String(sigData).startsWith('data:image')) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = sigData;
    }
  }, [sigData, canvasRef.current]);

  function posFromEvent(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e && e.touches[0]) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    const me = e as React.MouseEvent;
    return { x: me.clientX - rect.left, y: me.clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setDrawing(true);
    lastPos.current = posFromEvent(e);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !lastPos.current) return;
    const p = posFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPos.current = p;
  }

  function endDraw() {
    if (!drawing) return;
    setDrawing(false);
    lastPos.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        setSigData(canvas.toDataURL('image/png'));
      } catch {
        /* ignore */
      }
    }
  }

  function clearSig() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setSigData(null);
  }

  async function save() {
    if (!userId) {
      toast.error('Sign in to save profile');
      return;
    }
    setSaving(true);
    try {
      // Capture latest canvas if drawn
      let signature = sigData;
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          const blank = document.createElement('canvas');
          blank.width = canvas.width;
          blank.height = canvas.height;
          const drawn = canvas.toDataURL('image/png');
          if (drawn && drawn !== blank.toDataURL('image/png') && drawn.length > 500) {
            signature = drawn;
          }
        } catch {
          /* ignore */
        }
      }

      const payload: Record<string, any> = {
        id: userId,
        first_name: profile.first_name || null,
        last_name: profile.last_name || null,
        phone: profile.phone || null,
        job_title: profile.job_title || null,
      };
      if (signature) payload.signature_data = signature;
      else payload.signature_data = null;

      let { error } = await supabase.from('user_profiles').upsert(payload);
      if (error && /signature_data/i.test(error.message || '')) {
        delete payload.signature_data;
        ({ error } = await supabase.from('user_profiles').upsert(payload));
        if (!error) {
          toast.message('Profile saved (signature column not available yet)');
        }
      }
      if (error) throw error;

      await supabase.auth.updateUser({
        data: { first_name: profile.first_name, last_name: profile.last_name },
      });
      toast.success('Profile saved');
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-lg mx-auto w-full p-6">
        <h1 className="text-xl font-bold mb-4">👤 Your Profile</h1>

        <div className="space-y-4 card p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First Name</label>
              <input
                className="input"
                value={profile.first_name || ''}
                onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input
                className="input"
                value={profile.last_name || ''}
                onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              value={profile.phone || ''}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Job Title</label>
            <input
              className="input"
              value={profile.job_title || ''}
              onChange={(e) => setProfile({ ...profile, job_title: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Role</label>
            <input className="input" value={profile.role || '—'} disabled />
          </div>
          <p className="text-[10px] text-[var(--text3)]">
            Role is set during onboarding or by a company admin. Signature below is used as a
            default on service reports when you don&apos;t re-sign on the form.
          </p>
        </div>

        <div className="card p-5 mt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Technician Signature</label>
            <button type="button" className="btn btn-ghost text-xs" onClick={clearSig}>
              Clear
            </button>
          </div>
          <canvas
            ref={canvasRef}
            className="w-full max-w-[320px] border border-[var(--gold)] rounded bg-white touch-none cursor-crosshair"
            style={{ height: 100 }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
          <p className="text-[10px] text-[var(--text3)] mt-2">
            Draw with mouse or finger. Saved to your profile as{' '}
            <code className="text-[var(--gold)]">signature_data</code> (Android SR fallback).
          </p>
        </div>

        <button onClick={save} disabled={saving} className="btn btn-primary mt-5 w-full">
          {saving ? 'Saving…' : 'Save Profile'}
        </button>
        <p className="text-xs text-center mt-4 text-[var(--text3)]">
          Changes sync across web and Android apps.
        </p>
      </div>
    </div>
  );
}
