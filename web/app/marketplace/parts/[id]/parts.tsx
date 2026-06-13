'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../../components/Header';
import { Package, ArrowLeft, Image as ImageIcon } from 'lucide-react';

export default function PartDetail({ params }: { params: { id: string } }) {
  // In real app this would fetch from Supabase by id
  const part = {
    id: params.id,
    partNumber: 'CAN-DEL-001',
    description: 'GentleYAG Handpiece Fiber Optic Cable - Premium Grade',
    make: 'Candela',
    price: 1250,
    condition: 'New',
    compatibleModels: 'GentleYAG, GentleMax Pro, GentleLase',
    stock: 12,
    photos: ['/placeholder-part.jpg'] // replace with real URLs later
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-4xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace?tab=parts" className="inline-flex items-center gap-2 text-[var(--gold)] mb-6 hover:underline">
          <ArrowLeft size={18} /> Back to Parts Marketplace
        </Link>

        <div className="card p-8">
          <div className="grid md:grid-cols-2 gap-10">
            {/* Photos */}
            <div>
              <div className="aspect-square bg-[var(--surface3)] rounded-xl flex items-center justify-center mb-4 border border-[var(--border)]">
                <ImageIcon size={80} className="text-[var(--text3)]" />
              </div>
              <p className="text-xs text-center text-[var(--text3)]">Photo upload & gallery coming soon</p>
            </div>

            {/* Details */}
            <div>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-mono text-sm text-[var(--text3)]">{part.partNumber}</div>
                  <h1 className="text-3xl font-bold mt-1">{part.description}</h1>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-extrabold text-[var(--gold)]">${part.price}</div>
                  <div className="text-sm text-green-400">• {part.stock} in stock</div>
                </div>
              </div>

              <div className="mt-8 space-y-6">
                <div>
                  <div className="font-semibold mb-1">Make / Brand</div>
                  <div>{part.make}</div>
                </div>
                <div>
                  <div className="font-semibold mb-1">Compatible Models</div>
                  <div>{part.compatibleModels}</div>
                </div>
                <div>
                  <div className="font-semibold mb-1">Condition</div>
                  <div className="inline-block px-4 py-1 bg-green-900/30 text-green-400 rounded-full text-sm">{part.condition}</div>
                </div>
              </div>

              <button className="btn btn-primary w-full mt-10 py-4 text-lg">
                Contact Supplier / Request Quote
              </button>
              <p className="text-xs text-center text-[var(--text3)] mt-4">Full messaging + cart system coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}