'use client';

import React, { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import {
  CLINIC_LEAD_BRANDS,
  CLINIC_LEAD_DESCRIPTION_MAX,
  CLINIC_LEAD_DESCRIPTION_MIN,
  CLINIC_LEAD_URGENCY,
  shouldAutoOpenFindRep,
} from '@/lib/clinic-service-lead';

type Variant = 'hero' | 'nav' | 'column';

export function FindRepControl({
  variant = 'hero',
  label,
}: {
  variant?: Variant;
  label?: string;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [clinicName, setClinicName] = useState('');
  const [location, setLocation] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);

  const buttonLabel =
    label ||
    (variant === 'nav' ? 'Find a rep' : 'Find a service rep near me');

  useEffect(() => {
    if (variant !== 'hero') return;
    if (typeof window === 'undefined') return;
    if (shouldAutoOpenFindRep(window.location.search, window.location.hash)) {
      setOpen(true);
    }
  }, [variant]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function reset() {
    setClinicName('');
    setLocation('');
    setContactName('');
    setEmail('');
    setPhone('');
    setManufacturer('');
    setDescription('');
    setUrgency('');
    setWebsite('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/clinic-service-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicName,
          location,
          contactName,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          manufacturer: manufacturer || undefined,
          description,
          urgency: urgency || undefined,
          website,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        toast.error(json.error || 'Could not send the request');
        return;
      }
      toast.success(json.message || 'Thanks — RepairPlanet has your request.');
      reset();
      setOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not send the request');
    } finally {
      setSending(false);
    }
  }

  const triggerClass =
    variant === 'nav'
      ? 'lp-btn lp-btn-primary lp-find-nav'
      : variant === 'column'
        ? 'lp-btn lp-btn-primary'
        : 'lp-btn lp-btn-primary';

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {buttonLabel}
      </button>

      {open && (
        <div className="lp-modal-root">
          <button
            type="button"
            className="lp-modal-backdrop"
            aria-label="Close find-a-rep form"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="lp-modal"
          >
            <div className="lp-modal-head">
              <div>
                <h2 id={titleId} className="lp-modal-title">
                  Find a service rep near you
                </h2>
                <p className="lp-modal-lede">
                  Tell us where the laser is and what is going on. No Total Service Pro
                  account required — RepairPlanet matches you with a nearby shop.
                </p>
              </div>
              <button
                type="button"
                className="lp-modal-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submit} className="lp-lead-form">
              <label className="lp-field lp-hp" aria-hidden="true">
                <span>Company website</span>
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
              <label className="lp-field">
                <span>Clinic or organization</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder="Practice or spa name"
                  autoComplete="organization"
                />
              </label>
              <label className="lp-field">
                <span>City or ZIP</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City, ST or ZIP"
                  autoComplete="postal-code"
                />
              </label>
              <label className="lp-field">
                <span>Your name</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Who should we call"
                  autoComplete="name"
                />
              </label>
              <div className="lp-field-row">
                <label className="lp-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@clinic.com"
                    autoComplete="email"
                  />
                </label>
                <label className="lp-field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 555-0100"
                    autoComplete="tel"
                  />
                </label>
              </div>
              <p className="lp-field-hint">Email or phone — whichever is easier.</p>
              <div className="lp-field-row">
                <label className="lp-field">
                  <span>Equipment / brand</span>
                  <select
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                  >
                    <option value="">Optional</option>
                    {CLINIC_LEAD_BRANDS.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lp-field">
                  <span>Urgency</span>
                  <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                    <option value="">Optional</option>
                    {CLINIC_LEAD_URGENCY.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="lp-field">
                <span>What is going on</span>
                <textarea
                  required
                  minLength={CLINIC_LEAD_DESCRIPTION_MIN}
                  maxLength={CLINIC_LEAD_DESCRIPTION_MAX}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Error codes, no power, PM due, install — a short note is enough."
                />
              </label>
              <div className="lp-modal-actions">
                <button
                  type="button"
                  className="lp-btn lp-btn-ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="lp-btn lp-btn-primary" disabled={sending}>
                  {sending ? 'Sending…' : 'Send request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
