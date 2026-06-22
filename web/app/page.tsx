{/* Quick Access */}
<div className="mt-12">
  <h3 className="font-bold text-lg mb-4">Quick Access</h3>
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    <Link href="/hub" className="card p-6 text-center hover:border-[var(--gold)]">
      <Wrench size={32} className="mx-auto mb-3 text-[var(--gold)]" />
      <div className="font-bold">Tech Hub</div>
    </Link>

    <Link href="/service-schedule" className="card p-6 text-center hover:border-[var(--gold)]">
      <Calendar size={32} className="mx-auto mb-3 text-[var(--gold)]" />
      <div className="font-bold">Service Schedule</div>
    </Link>

    <Link href="/marketplace" className="card p-6 text-center hover:border-[var(--gold)]">
      <Package size={32} className="mx-auto mb-3 text-[var(--gold)]" />
      <div className="font-bold">Marketplace</div>
    </Link>

    <Link href="/reports" className="card p-6 text-center hover:border-[var(--gold)]">
      <FileText size={32} className="mx-auto mb-3 text-[var(--gold)]" />
      <div className="font-bold">Reports</div>
    </Link>

    {/* Admin Portal Card - Only for admins */}
    {profile?.role?.toLowerCase() === 'admin' && (
      <Link 
        href="/admin" 
        className="card p-6 text-center hover:border-[var(--gold)] border-2 border-[var(--gold)]/50"
      >
        <div className="text-3xl mb-2">🛡️</div>
        <div className="font-bold">Admin Portal</div>
        <div className="text-xs text-[var(--text3)] mt-1">Team, Customers & Settings</div>
      </Link>
    )}
  </div>
</div>