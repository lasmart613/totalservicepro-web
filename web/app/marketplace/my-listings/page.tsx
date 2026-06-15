'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '../../../components/Header';
import { getSupabaseClient } from '../../../lib/supabase/client';
import { toast } from 'sonner';

export default function MyListings() {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const supabase = getSupabaseClient();

  useEffect(() => {
    fetchMyListings();
  }, []);

  const fetchMyListings = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('marketplace_listing')
        .select('*')
        .eq('created_by', user.id) // Assuming you add created_by column
        .order('created_at', { ascending: false });

      if (error) throw error;
      setListings(data || []);
    } catch (err: any) {
      toast.error('Failed to load listings');
    } finally {
      setLoading(false);
    }
  };

  const deleteListing = async (id: string) => {
    if (!confirm('Are you sure you want to delete this listing?')) return;

    try {
      const { error } = await supabase
        .from('marketplace_listing')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setListings(prev => prev.filter(item => item.id !== id));
      toast.success('Listing deleted');
    } catch (err: any) {
      toast.error('Failed to delete listing');
    }
  };

  const startEditing = (listing: any) => {
    setEditingId(listing.id);
    setEditForm(listing.data || {});
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (!editingId) return;

    try {
      const { error } = await supabase
        .from('marketplace_listing')
        .update({ data: editForm })
        .eq('id', editingId);

      if (error) throw error;

      setListings(prev =>
        prev.map(item =>
          item.id === editingId ? { ...item, data: editForm } : item
        )
      );
      toast.success('Listing updated');
      cancelEditing();
    } catch (err: any) {
      toast.error('Failed to update listing');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading your listings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold">My Marketplace Listings</h1>
          <a href="/marketplace/list" className="btn btn-primary">+ Create New Listing</a>
        </div>

        {listings.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-lg mb-4">You don’t have any listings yet.</p>
            <a href="/marketplace/list" className="btn btn-primary">Create Your First Listing</a>
          </div>
        ) : (
          <div className="space-y-6">
            {listings.map((listing) => (
              <div key={listing.id} className="card p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-xs uppercase tracking-widest text-[var(--text3)]">
                      {listing.type?.toUpperCase()}
                    </span>
                    <h3 className="font-bold text-xl">
                      {listing.data?.title || listing.data?.partNumber || listing.data?.model || 'Untitled Listing'}
                    </h3>
                  </div>
                  <div className="flex gap-2">
                    {editingId === listing.id ? (
                      <>
                        <button onClick={saveEdit} className="btn btn-primary text-sm px-4">Save</button>
                        <button onClick={cancelEditing} className="btn btn-secondary text-sm px-4">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEditing(listing)} className="btn btn-secondary text-sm px-4">Edit</button>
                        <button onClick={() => deleteListing(listing.id)} className="btn btn-secondary text-sm px-4 text-red-400">Delete</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Display or Edit Form */}
                {editingId === listing.id ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.keys(editForm).map((key) => (
                      <div key={key}>
                        <label className="label text-xs">{key}</label>
                        <input
                          className="input"
                          value={editForm[key] || ''}
                          onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-[var(--text3)]">
                    {listing.data?.description || listing.data?.title || 'No description provided.'}
                  </div>
                )}

                {/* Image Preview */}
                {listing.data?.images?.length > 0 && (
                  <div className="flex gap-3 mt-4">
                    {listing.data.images.slice(0, 4).map((url: string, idx: number) => (
                      <img key={idx} src={url} alt="listing" className="w-20 h-20 object-cover rounded border" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}