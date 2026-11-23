'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchGodMe, godAuthHeader } from '@/lib/god-client';
import { DESTINATION_REFUND_NOTE, STUCK_ORDER_LIST_LIMIT } from '@/lib/marketplace/stuck-orders';

type Row = {
  id: string;
  listingId: string;
  listingTitle: string;
  sellerOrganizationId: string;
  sellerOrganizationName: string;
  buyerEmail: string;
  amount: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string;
  status: string;
  payoutStatus: string;
  createdAt: string;
  updatedAt: string;
  age: string;
};

const COLUMNS: { key: keyof Row; label: string }[] = [
  { key: 'id', label: 'Order' },
  { key: 'listingTitle', label: 'Listing' },
  { key: 'listingId', label: 'Listing id' },
  { key: 'sellerOrganizationName', label: 'Seller org' },
  { key: 'sellerOrganizationId', label: 'Seller org id' },
  { key: 'buyerEmail', label: 'Buyer email' },
  { key: 'amount', label: 'Amount' },
  { key: 'stripeCheckoutSessionId', label: 'Checkout session' },
  { key: 'stripePaymentIntentId', label: 'Payment intent' },
  { key: 'status', label: 'Status' },
  { key: 'payoutStatus', label: 'Payout' },
  { key: 'createdAt', label: 'Created' },
  { key: 'updatedAt', label: 'Updated' },
  { key: 'age', label: 'Age' },
];

export default function GodMarketplaceOrdersPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const god = await fetchGodMe();
      if (cancelled) return;
      setAllowed(god);
      if (!god) return;
      const headers = await godAuthHeader();
      const res = await fetch('/api/god/marketplace-orders', { headers, cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setMessage(json.error || 'Marketplace orders unavailable');
        return;
      }
      setRows(Array.isArray(json.orders) ? json.orders : []);
      setTruncated(json.truncated === true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (allowed == null) return <p className="text-[var(--text3)]">Loading marketplace orders…</p>;
  if (!allowed) {
    return (
      <div className="max-w-lg mx-auto w-full py-16 text-center">
        <h1 className="text-3xl font-extrabold">404</h1>
        <Link href="/" className="btn btn-primary mt-6">
          Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">Marketplace orders needing review</h1>
      <p className="text-sm text-[var(--text3)] mb-3 max-w-3xl">
        Orders left in stock pending or refund review. Read only. Turn marketplace checkout on only after someone is watching this list.
      </p>
      <p className="text-sm mb-6 max-w-3xl" data-testid="destination-refund-note">
        {DESTINATION_REFUND_NOTE}
      </p>
      {truncated ? (
        <p className="text-sm mb-4" data-testid="stuck-orders-truncated">
          Showing the first {STUCK_ORDER_LIST_LIMIT}. More orders are waiting than this list holds.
        </p>
      ) : null}
      {message ? <p className="text-sm mb-4 text-red-300">{message}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text3)]">No marketplace orders are waiting.</p>
      ) : (
        <div className="overflow-x-auto card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
                {COLUMNS.map((col) => (
                  <th key={col.key} className="p-3 whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]">
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="p-3 whitespace-nowrap">
                      {row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
