'use client';

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

const ROLES = [
  'fse',
  'dispatcher',
  'admin',
  'scheduler',
  'technician',
  'viewer',
];

export default function TeamManagement() {
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMember, setNewMember] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'fse',
    jobTitle: '',
  });
  const [adding, setAdding] = useState(false);
  const supabase = getSupabaseClient();

  // Fetch current team members
  const fetchTeam = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      setLoading(false);
      return;
    }

    const { data: members } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, email, role, job_title, created_at')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false });

    setTeamMembers(members || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  // Add new team member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember.email) {
      toast.error('Email is required');
      return;
    }

    setAdding(true);

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not logged in');

      // Get current user's organization
      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', currentUser.id)
        .single();

      if (!currentProfile?.organization_id) {
        throw new Error('You are not part of an organization');
      }

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('email', newMember.email.toLowerCase())
        .single();

      if (existingUser) {
        // Link existing user to organization
        const { error } = await supabase
          .from('user_profiles')
          .update({
            organization_id: currentProfile.organization_id,
            role: newMember.role,
            job_title: newMember.jobTitle || null,
          })
          .eq('id', existingUser.id);

        if (error) throw error;
        toast.success('Existing user linked to your organization');
      } else {
        // Create new profile (user will need to sign up)
        const { error } = await supabase.from('user_profiles').insert({
          email: newMember.email.toLowerCase(),
          first_name: newMember.firstName || null,
          last_name: newMember.lastName || null,
          role: newMember.role,
          job_title: newMember.jobTitle || null,
          organization_id: currentProfile.organization_id,
          onboarding_completed: false,
        });

        if (error) throw error;
        toast.success('Team member added. They will need to sign up with this email.');
      }

      // Reset form and refresh list
      setNewMember({
        email: '',
        firstName: '',
        lastName: '',
        role: 'fse',
        jobTitle: '',
      });
      await fetchTeam();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add team member');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">Team Management</h1>
      <p className="text-[var(--text3)] mb-8">
        Manage your team members and their roles at Luxor Photonix.
      </p>

      {/* Add New Team Member */}
      <div className="card p-6 mb-10">
        <h2 className="font-bold text-xl mb-4">Add New Team Member</h2>
        <form onSubmit={handleAddMember} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Email Address *</label>
            <input
              type="email"
              className="input"
              value={newMember.email}
              onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">Role</label>
            <select
              className="select"
              value={newMember.role}
              onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">First Name</label>
            <input
              className="input"
              value={newMember.firstName}
              onChange={(e) => setNewMember({ ...newMember, firstName: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Last Name</label>
            <input
              className="input"
              value={newMember.lastName}
              onChange={(e) => setNewMember({ ...newMember, lastName: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <label className="label">Job Title</label>
            <input
              className="input"
              value={newMember.jobTitle}
              onChange={(e) => setNewMember({ ...newMember, jobTitle: e.target.value })}
              placeholder="e.g. Senior Field Service Engineer"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={adding}
              className="btn btn-primary w-full md:w-auto px-8"
            >
              {adding ? 'Adding...' : 'Add Team Member'}
            </button>
          </div>
        </form>
      </div>

      {/* Current Team Members */}
      <div className="card p-6">
        <h2 className="font-bold text-xl mb-4">Current Team ({teamMembers.length})</h2>

        {loading ? (
          <div className="text-center py-8 text-[var(--text3)]">Loading team...</div>
        ) : teamMembers.length === 0 ? (
          <div className="text-center py-8 text-[var(--text3)]">No team members yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-sm text-[var(--text3)]">
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th class