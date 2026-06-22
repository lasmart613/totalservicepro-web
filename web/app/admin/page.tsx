'use client';

import React from 'react';
import Link from 'next/link';

export default function AdminDashboard() {
  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">Admin Dashboard</h1>
      <p className="text-[var(--text3)] mb-8">
        Overview of Luxor Photonix operations.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link href="/admin/team" className="card p-6 hover:border-[var(--gold)] group">
          <div className="text-4xl mb-4">👥</div>
          <div className="font-bold text-2xl mb-1 group-hover:text-[var(--gold)]">Team Management</div>
          <p className="text-[var(--text3)]">Add and manage FSEs, dispatchers, and admins.</p>
        </Link>

        <Link href="/admin/customers" className="card p-6 hover:border-[var(--gold)] group">
          <div className="text-4xl mb-4">🏥</div>
          <div className="font-bold text-2xl mb-1 group-hover:text-[var(--gold)]">Customers</div>
          <p className="text-[var(--text3)]">View all customers linked to your organization.</p>
        </Link>

        <Link href="/admin/reports" className="card p-6 hover:border-[var(--gold)] group">
          <div className="text-4xl mb-4">📊</div>
          <div className="font-bold text-2xl mb-1 group-hover:text-[var(--gold)]">Reports & Analytics</div>
          <p className="text-[var(--text3)]">Organization performance and insights.</p>
        </Link>
      </div>
    </div>
  );
}