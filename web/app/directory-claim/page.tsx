'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';

function ClaimInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, [supabase]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/directory-claim?token=${encodeURIComponent(token)}` },
    });
    setBusy(false);
    setMsg(error ? error.message : 'Check your email for a sign-in link, then come back to this page.');
  }

  async function claim() {
    setBusy(true);
    setMsg('');
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/directory/claim', {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && j.ok) {
      setDone(true);
      setMsg('Your listing is linked to your account.');
    } else {
      setMsg(j.error || 'Could not claim this listing.');
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <div className="max-w-lg mx-auto w-full px-4 py-10">
        <h1 className="text-2xl font-bold mb-2">Manage your directory listing</h1>
        <p className="text-sm text-[var(--text3)] mb-6">
          Medical Repair Network listings are managed in RepairPlanet. Sign in with the email address the invite was sent to.
        </p>
        {msg && <div className="card p-3 mb-4 text-sm">{msg}</div>}
        {!token ? (
          <div className="card p-4">This link is missing its invite. Open the link from your email again.</div>
        ) : done ? (
          <a className="btn btn-primary" href="/company">Open your company profile</a>
        ) : signedIn === null ? (
          <div className="text-[var(--text3)]">Loading…</div>
        ) : signedIn ? (
          <button className="btn btn-primary" disabled={busy} onClick={claim}>Claim this listing</button>
        ) : (
          <form className="card p-4 space-y-3" onSubmit={sendLink}>
            <label className="label" htmlFor="claim-email">Email</label>
            <input id="claim-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-primary" disabled={busy} type="submit">Email me a sign-in link</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function DirectoryClaimPage() {
  return (
    <Suspense fallback={null}>
      <ClaimInner />
    </Suspense>
  );
}
