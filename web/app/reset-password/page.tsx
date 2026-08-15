'use client';

import { useEffect } from 'react';

/**
 * Recovery emails and bookmarks may use /reset-password.
 * Client navigate so hash tokens are not dropped by a server redirect.
 */
export default function ResetPasswordPage() {
  useEffect(() => {
    const { search, hash } = window.location;
    window.location.replace(`/auth/set-password${search}${hash}`);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--text3)]">
      Opening password reset…
    </div>
  );
}
