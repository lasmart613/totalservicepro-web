'use client';

import { GodTableBrowser } from '@/components/god/GodTableBrowser';

export default function GodUsersPage() {
  return (
    <GodTableBrowser
      tableKey="user_profiles"
      related={['organization_memberships', 'auth_users', 'engineer_invitations']}
      title="Users"
    />
  );
}
