'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { AddPartModal, AddVendorModal } from '@/components/AddPartModal';
import { chunkIds } from '@/lib/supabase/paginate';

type CatalogPart = {
  id: number | string;
  name?: string | null;
  part_number?: string | null;
  brand?: string | null;
  description?: string | null;
  image_url?: string | null;
  compatible_models?: string[] | null;
  unit_cost?: number | string | null;
  category?: string | null;
};

type PartVendor = {
  id: number | string;
  part_id: number | string;
  vendor_name: string;
  vendor_part_number?: string | null;
  unit_cost?: number | string | null;
  lead_time_days?: number | null;
  url?: string | null;
  is_preferred?: boolean | null;
};

function partImage(part: CatalogPart): string | null {
  return part.image_url || (part as any).photo_url || (part as any).thumbnail_url || null;
}

function money(n: number | string | null | undefined): string | null {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PartsCatalog() {
  const [parts, setParts] = useState<CatalogPart[]>([]);
  const [vendorsByPart, setVendorsByPart] = useState<Record<string, PartVendor[]>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [vendorFor, setVendorFor] = useState<CatalogPart | null>(null);
  const supabase = getSupabaseClient();

  const fetchParts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('parts_catalog').select('*').order('name', { ascending: true });
      if (error) throw error;
      const list = (data || []) as CatalogPart[];
      setParts(list);
      const ids = list.map((p) => p.id).filter(Boolean);
      if (ids.length) {
        const map: Record<string, PartVendor[]> = {};
        for (const chunk of chunkIds(ids)) {
          const { data: vrows } = await supabase.from('part_vendors').select('*').in('part_id', chunk);
          for (const v of vrows || []) {
            const key = String(v.part_id);
            if (!map[key]) map[key] = [];
            map[key].push(v as PartVendor);
          }
        }
        setVendorsByPart(map);
      } else {
        setVendorsByPart({});
      }
    } catch (err) {
      console.error('Error loading parts catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParts();
  }, []);

  const filteredParts = useMemo(() => {
    let result = parts;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (part) =>
          part.name?.toLowerCase().includes(term) ||
          part.part_number?.toLowerCase().includes(term) ||
          part.description?.toLowerCase().includes(term) ||
          part.brand?.toLowerCase().includes(term)
      );
    }
    if (selectedBrand) result = result.filter((part) => part.brand === selectedBrand);
    return result;
  }, [searchTerm, selectedBrand, parts]);

  const brands = [...new Set(parts.map((p) => p.brand).filter(Boolean))].sort() as string[];

  function displayPrice(part: CatalogPart): string | null {
    const vendors = vendorsByPart[String(part.id)] || [];
    const preferred = vendors.find((v) => v.is_preferred && v.unit_cost != null) || vendors.find((v) => v.unit_cost != null);
    return money(preferred?.unit_cost ?? part.unit_cost);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Parts Catalog</h1>
            <p className="text-[var(--text3)]">Master reference list of parts with specs, photos, and vendors</p>
          </div>

          <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
            <input
              type="text"
              placeholder="Search parts..."
              className="input w-full md:w-80"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select
              className="select w-full md:w-64"
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
            >
              <option value="">All Manufacturers</option>
              {brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary whitespace-nowrap" onClick={() => setShowAdd(true)}>
              + Add Part
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card overflow-hidden">
                <div className="w-full h-48 bg-[var(--surface3)] animate-pulse" />
                <div className="p-5 space-y-2">
                  <div className="h-5 bg-[var(--surface3)] rounded animate-pulse" />
                  <div className="h-4 w-2/3 bg-[var(--surface3)] rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredParts.length === 0 ? (
          <div className="card p-8 text-center">
            <p>No parts found matching your search.</p>
            <button type="button" className="btn btn-primary mt-4" onClick={() => setShowAdd(true)}>
              + Add Part
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredParts.map((part) => {
              const vendors = vendorsByPart[String(part.id)] || [];
              const img = partImage(part);
              const price = displayPrice(part);
              return (
                <div key={part.id} className="card overflow-hidden hover:border-[var(--gold)] transition-colors hover:transform-none">
                  {img ? (
                    <img src={img} alt={part.name || ''} className="w-full h-48 object-cover" />
                  ) : (
                    <div className="w-full h-48 bg-[var(--surface3)] flex items-center justify-center">
                      <span className="text-4xl font-extrabold text-[var(--gold)]/40">
                        {(part.brand || part.name || 'P').toString().charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}

                  <div className="p-5">
                    <div className="font-bold text-lg mb-1">{part.name}</div>
                    <div className="text-sm text-[var(--text3)] mb-2">
                      {part.part_number} {part.brand ? `• ${part.brand}` : ''}
                    </div>
                    {part.description && <p className="text-sm line-clamp-3 mb-3">{part.description}</p>}
                    {vendors.length > 0 && (
                      <div className="text-xs text-[var(--text3)] mb-2">
                        {vendors.length} vendor{vendors.length === 1 ? '' : 's'}
                        {vendors[0]?.vendor_name ? ` · ${vendors.find((v) => v.is_preferred)?.vendor_name || vendors[0].vendor_name}` : ''}
                      </div>
                    )}
                    <div className="flex justify-between items-center text-sm gap-2">
                      <button
                        type="button"
                        className="text-xs text-[var(--gold)]"
                        onClick={() => setVendorFor(part)}
                      >
                        + Vendor
                      </button>
                      {price && <span className="font-medium text-[var(--gold)]">{price}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <AddPartModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            fetchParts();
          }}
        />
      )}
      {vendorFor && (
        <AddVendorModal
          partId={vendorFor.id}
          partLabel={`${vendorFor.part_number || ''} — ${vendorFor.name || ''}`.trim()}
          onClose={() => setVendorFor(null)}
          onSaved={() => fetchParts()}
        />
      )}
    </div>
  );
}
