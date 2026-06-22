'use client';

import React, { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = getSupabaseClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      if (isSignUp) {
        if (!firstName || !lastName) {
          setMessage('First and last name required for sign up.');
          setLoading(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { first_name: firstName, last_name: lastName } }
        });
        if (error) throw error;
        if (data.session) {
          // Auto logged in
          // Create profile row
          await supabase.from('user_profiles').upsert({
            id: data.user!.id,
            first_name: firstName,
            last_name: lastName,
            email,
            // role intentionally not set here - direct users to org-type signup flows (/signup/company etc) for proper onboarding. FSE role assigned when added to Service Company org. (see /signup/fse for individuals)
            onboarding_completed: false,
          }, { onConflict: 'id' });
          // After quick signup, send to role selection for robust onboarding
          router.push('/signup');
        } else {
          setMessage('Account created! Check your email to confirm, then sign in.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/');
      }
    } catch (err: any) {
      const msg = err.message || 'Authentication failed';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('user already exists') || msg.toLowerCase().includes('duplicate')) {
        setMessage('An account with this email already exists. Please check your email (including spam) for a confirmation link from a previous signup attempt. If a prior signup failed after auth, a partial auth user may remain – try a different email or ask an admin to clean up the auth.users table in Supabase. You can also try signing in.');
      } else {
        setMessage(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const sendMagic = async () => {
    if (!email) return setMessage('Enter email first');
    const { error } = await supabase.auth.signInWithOtp({ email });
    setMessage(error ? error.message : 'Magic link sent — check your email.');
  };

  const forgot = async () => {
    if (!email) return setMessage('Enter your email first');
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setMessage(error ? error.message : 'Password reset link sent!');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </Link>
          <p className="text-[var(--text3)] mt-1 text-sm tracking-wide">Professional Laser Service Tools</p>
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--gold)' }}>{isSignUp ? 'Create Account' : 'Sign In'}</h1>

          {message && (
            <div className={`mb-4 p-3 rounded text-sm ${message.includes('sent') || message.includes('created') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {isSignUp && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">First Name</label>
                  <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required />
                </div>
                <div>
                  <label className="label">Last Name</label>
                  <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} required />
                </div>
              </div>
            )}

            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>

            <div>
              <label className="label">Password</label>
              <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60"
            >
              {loading ? 'Please wait...' : (isSignUp ? 'Create Account' : 'Sign In')}
            </button>
          </form>

          <div className="mt-6 space-y-3 text-center text-sm">
            <button onClick={() => { setIsSignUp(!isSignUp); setMessage(''); }} className="text-[var(--gold)] hover:underline">
              {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </button>

            <div>
              <button onClick={sendMagic} className="text-[var(--text3)] hover:text-[var(--gold)] underline">Sign in with Magic Link</button>
            </div>
            <div>
              <button onClick={forgot} className="text-[var(--text3)] hover:text-[var(--gold)] underline">Forgot password?</button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          Web version of Total Service Pro • Shares data with the mobile app via Supabase
        </p>

        {/* Professional multi-type sign up links (marketplace vision) */}
        <div className="mt-8 card p-5 text-sm">
          <div className="font-bold mb-3 text-center" style={{ color: 'var(--gold)' }}>Join the Laser Service Network</div>
          <p className="text-center text-xs text-[var(--text3)] mb-4">Sign up by org type first (Service Company, Owner/Facility, Parts Supplier). FSE is a role added inside a Service Company (by its admin via /company Team). Owners post needs; Service Companies + FSEs bid &amp; fulfill (live at /marketplace).</p>
          <div className="grid grid-cols-1 gap-2">
            <Link href="/company" className="btn btn-secondary w-full justify-center text-sm py-2">Sign up as Service Organization</Link>
            <Link href="/signup/owner" className="btn btn-secondary w-full justify-center text-sm py-2">Sign up as Laser Owner / Facility</Link>
            <Link href="/signup/fse" className="btn btn-secondary w-full justify-center text-sm py-2">Sign up as FSE (to be added to Service Company)</Link>
          </div>
          <div className="text-center mt-3">
            <Link href="/signup" className="text-[var(--gold)] text-xs hover:underline">Or view all options →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
