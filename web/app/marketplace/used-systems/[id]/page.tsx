'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { ArrowLeft, DollarSign, Calendar, Tag } from 'lucide-react';

export default function UsedSystemDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const supabase = getSupabaseClient();

  const [system, setSystem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;

    const fetchSystem = async () => {
      const { data, error } = await supabase
        .from('marketplace_used_systems')
        .select('*')
        .eq('id', parseInt(id))
        .maybeSingle();

      if (error) {
        console.error('Error fetching system:', error);
      } else if (data) {
        setSystem(data);
        
        // Handle images from jsonb array
        const imgList = data.images && Array.isArray(data.images) 
          ? data.images 
          : [];
        setImages(imgList);
      }
      setLoading(false);
    };

    fetchSystem();
  }, [id, supabase]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading system details...</div>
      </div>
    );
  }

  if (!system) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>System not found.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f1c]">
      <Header />
      
      <div className="max-w-6xl mx-auto px-4 py-8">
        <button 
          onClick={() => router.back()} 
          className="flex items-center gap-2 text-[var(--gold)] mb-8 hover:underline"
        >
          <ArrowLeft size={20} /> Back to Used Systems
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Image Gallery */}
          <div className="space-y-4">
            <div className="bg-[#1a2233] rounded-3xl overflow-hidden border border-[#2a3749] aspect-video">
              {images.length > 0 ? (
                <img 
                  src={images[0]} 
                  alt={`${system.manufacturer} ${system.model}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-xl">
                  No photos available
                </div>
              )}
            </div>

            {images.length > 1 && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {images.map((url, idx) => (
                  <img 
                    key={idx}
                    src={url}
                    alt={`View ${idx + 1}`}
                    className="w-24 h-24 object-cover rounded-xl border-2 border-transparent hover:border-[var(--gold)] cursor-pointer transition"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="space-y-8">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">
                {system.manufacturer} {system.model}
              </h1>
              {system.serial_number && (
                <p className="text-gray-400">Serial Number: {system.serial_number}</p>
              )}
            </div>

            <div className="text-5xl font-semibold text-[var(--gold)] flex items-center gap-3">
              <DollarSign size={42} className="text-yellow-400" />
              {system.price ? `$${system.price.toLocaleString()}` : 'Contact for Price'}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#1a2233] p-6 rounded-2xl">
                <div className="text-sm text-gray-400">Condition</div>
                <div className="text-2xl font-medium capitalize mt-1">{system.condition || 'Good'}</div>
              </div>
              <div className="bg-[#1a2233] p-6 rounded-2xl">
                <div className="text-sm text-gray-400">Status</div>
                <div className="text-2xl font-medium capitalize text-green-400 mt-1">{system.status}</div>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Tag size={22} /> Description
              </h3>
              <div className="bg-[#1a2233] p-8 rounded-3xl text-gray-200 leading-relaxed whitespace-pre-wrap min-h-[200px]">
                {system.description || 'No additional description provided.'}
              </div>
            </div>

            <button className="w-full bg-[var(--gold)] hover:bg-yellow-300 transition text-black font-semibold py-5 rounded-3xl text-xl mt-6">
              Contact Seller
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}