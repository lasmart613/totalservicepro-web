'use client';

import { GodTableBrowser } from '@/components/god/GodTableBrowser';

export default function GodAuthPage() {
  return (
    <GodTableBrowser
      tableKey="auth_users"
      related={['user_profiles', 'organization_memberships']}
      title="Auth / Users"
    />
  );
}
