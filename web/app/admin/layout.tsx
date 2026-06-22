import { redirect } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = getSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const allowedRoles = ['admin', 'company_admin'];
  if (!profile || !allowedRoles.includes(profile.role)) {
    redirect('/'); // Non-admins are sent back to the main dashboard
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1">
        {/* Admin Sidebar */}
        <aside className="w-64 bg-[var(--surface)] border-r border-[var(--border)] p-6 hidden lg:block">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[var(--gold)]">Admin Portal</h2>
            <p className="text-sm text-[var(--text3)]">Luxor Photonix</p>
          </div>

          <nav className="space-y-1 text-sm">
            <a href="/admin" className="block px-4 py-2.5 rounded-lg hover:bg-[var(--surface3)]">Dashboard</a>
            <a href="/admin/team" className="block px-4 py-2.5 rounded-lg hover:bg-[var(--surface3)]">Team Management</a>
            <a href="/admin/customers" className="block px-4 py-2.5 rounded-lg hover:bg-[var(--surface3)]">Customers</a>
            <a href="/admin/reports" className="block px-4 py-2.5 rounded-lg hover:bg-[var(--surface3)]">Reports</a>
            <a href="/admin/settings" className="block px-4 py-2.5 rounded-lg hover:bg-[var(--surface3)]">Settings</a>
          </nav>
        </aside>

        <main className="flex-1 p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}