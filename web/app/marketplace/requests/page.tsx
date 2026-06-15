'use client';

import React from 'react';
import { Header } from '../../../components/Header';

export default function ServiceRequestsMarketplace() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <h1 className="text-3xl font-extrabold mb-2">Service Requests / Needs</h1>
        <p className="text-[var(--text3)] mb-6">Post or browse service needs, PM contracts, and emergency repairs.</p>

        <div className="card p-8 text-center">
          <p className="text-lg mb-4">Posting and browsing requests coming soon.</p>
          <p className="text-sm text-[var(--text3)]">
            Laser Owners can post their needs. FSEs and Service Companies can browse and respond.
          </p>
        </div>
      </div>
    </div>
  );
}