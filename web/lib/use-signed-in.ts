'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasBrowserAuthHint } from '@/lib/auth-session';
import { GUEST_SIGNUP_HREF } from '@/lib/marketplace/guest';
import { getSupabaseClient } from '@/lib/supabase/client';

export function useSignedIn(): { ready: boolean; signedIn: boolean } {
  const [state, setState] = useState({ ready: false, signedIn: hasBrowserAuthHint() });

  useEffect(() => {
    const supabase = getSupabaseClient();
    let alive = true;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (alive) setState({ ready: true, signedIn: !!user });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setState({ ready: true, signedIn: !!session?.user });
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

/** Catalog item / deep-link: guests never see the priced product page. */
export function useGuestSignupRedirect(): { ready: boolean; signedIn: boolean } {
  const router = useRouter();
  const state = useSignedIn();

  useEffect(() => {
    if (state.ready && !state.signedIn) router.replace(GUEST_SIGNUP_HREF);
  }, [state.ready, state.signedIn, router]);

  return state;
}
