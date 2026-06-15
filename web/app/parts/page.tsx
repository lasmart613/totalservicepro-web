'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';

export default function PartsCatalog() {
  const [parts, setParts] = useState<any[]>([]);
  const [filteredParts, setFilteredParts] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();

  useEffect(() => {
    fetchParts();
  }, []);

  const fetchParts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('parts_catalog')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;

      setParts(data || []);
      setFilteredParts(data || []);
    } catch (err) {
      console.error('Error loading parts catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter logic
  useEffect(() => {
    let result = parts;

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(part =>
        part.name?.toLowerCase().includes(term) ||
        part.part_number?.toLowerCase().includes(term) ||
        part.description?.toLowerCase().includes(term) ||
        part.manufacturer?.toLowerCase().includes(term)
      );
    }

    // Manufacturer filter
    if (selectedManufacturer) {
      result = result.filter(part => part.manufacturer === selectedManufacturer);
    }

    setFilteredParts(result);
  }, [searchTerm, selectedManufacturer, parts]);

  // Get unique manufacturers for filter dropdown
  const manufacturers = [...new Set(parts.map(p => p.manufacturer).filter(Boolean))].sort();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading Parts Catalog...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Parts Catalog</h1>
            <p className="text-[var(--text3)]">Master reference list of parts with specs and compatibility</p>
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
              value={selectedManufacturer}
              onChange={(e) => setSelectedManufacturer(e.target.value)}
            >
              <option value="">All Manufacturers</option>
              {manufacturers.map((mfr) => (
                <option key={mfr} value={mfr}>{mfr}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredParts.length === 0 ? (
          <div className="card p-8 text-center">
            <p>No parts found matching your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredParts.map((part) => (
              <div key={part.id} className="card overflow-hidden hover:border-[var(--gold)] transition-colors">
                {part.image_url ? (
                  <img 
                    src={part.image_url} 
                    alt={part.name} 
                    className="w-full h-48 object-cover" 
                  />
                ) : (
                  <div className="w-full h-48 bg-[var(--surface3)] flex items-center justify-center">
                    <span className="text-[var(--text3)]">No image</span>
                  </div>
                )}

                <div className="p-5">
                  <div className="font-bold text-lg mb-1">{part.name}</div>
                  <div className="text-sm text-[var(--text3)] mb-2">
                    {part.part_number} • {part.manufacturer}
                  </div>

                  {part.description && (
                    <p className="text-sm line-clamp-3 mb-4">{part.description}</p>
                  )}

                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[var(--text3)]">
                      {part.compatible_models ? 'Compatible with multiple models' : ''}
                    </span>
                    {part.unit_cost && (
                      <span className="font-medium text-[var(--gold)]">
                        ${part.unit_cost}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}