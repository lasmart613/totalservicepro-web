'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  CLINIC_LEAD_DESCRIPTION_MAX,
  CLINIC_LEAD_DESCRIPTION_MIN,
  CLINIC_LEAD_EQUIPMENT_OTHER_MAX,
  CLINIC_LEAD_EQUIPMENT_TYPES,
  CLINIC_LEAD_URGENCY,
} from '@/lib/clinic-service-lead';

export function FindRepForm({
  id = 'find-rep-form',
  variant = 'page',
  onCancel,
}: {
  id?: string;
  variant?: 'hero' | 'page';
  onCancel?: () => void;
}) {
  const compact = variant === 'hero';
  const TitleTag = compact ? 'h2' : 'h1';
  const [equipmentType, setEquipmentType] = useState('');
  const [equipmentTypeOther, setEquipmentTypeOther] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [location, setLocation] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function reset() {
    setEquipmentType('');
    setEquipmentTypeOther('');
    setManufacturer('');
    setClinicName('');
    setLocation('');
    setContactName('');
    setEmail('');
    setPhone('');
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
          equipmentType,
          equipmentTypeOther: equipmentType === 'other' ? equipmentTypeOther : undefined,
          manufacturer: manufacturer.trim() || undefined,
          clinicName,
          location,
          contactName,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
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
      setSent(true);
      onCancel?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not send the request');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className={`lp-find-card${compact ? ' is-hero' : ''}`} id={id}>
        <TitleTag className="lp-modal-title">Request sent</TitleTag>
        <p className="lp-modal-lede">
          RepairPlanet has your note. If you left an email, we sent a short confirmation.
          A nearby shop will be matched — you do not need a Total Service Pro account for this.
        </p>
        <button type="button" className="lp-btn lp-btn-primary" onClick={() => setSent(false)}>
          Send another request
        </button>
      </div>
    );
  }

  return (
    <div className={`lp-find-card${compact ? ' is-hero' : ''}`} id={id}>
      <TitleTag className="lp-modal-title">Find a Service/Repair Company Near Me</TitleTag>
      <p className="lp-modal-lede">
        {compact
          ? 'Lasers, lithotriptors, and C-arms first. No Total Service Pro account required — we match you with a nearby biomedical service shop.'
          : 'Tell us the equipment type and what is going on. No Total Service Pro account required — RepairPlanet matches you with a nearby biomedical service shop. Lasers, lithotriptors, and C-arms first.'}
      </p>
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
          <span>Equipment type</span>
          <select
            required
            value={equipmentType}
            onChange={(e) => setEquipmentType(e.target.value)}
          >
            <option value="">Choose one</option>
            {CLINIC_LEAD_EQUIPMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {equipmentType === 'other' ? (
          <label className="lp-field">
            <span>What kind of equipment</span>
            <input
              type="text"
              required
              minLength={2}
              maxLength={CLINIC_LEAD_EQUIPMENT_OTHER_MAX}
              value={equipmentTypeOther}
              onChange={(e) => setEquipmentTypeOther(e.target.value)}
              placeholder="Short description"
            />
          </label>
        ) : null}
        {compact ? null : (
          <label className="lp-field">
            <span>Brand / model</span>
            <input
              type="text"
              maxLength={80}
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="Optional — e.g. Candela Vbeam, Dornier, GE OEC"
            />
          </label>
        )}
        <label className="lp-field">
          <span>Clinic or organization</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={clinicName}
            onChange={(e) => setClinicName(e.target.value)}
            placeholder="Practice, hospital, or spa name"
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
        {compact ? null : (
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
        )}
        <label className={`lp-field${compact ? ' lp-field-span' : ''}`}>
          <span>What is going on</span>
          <textarea
            required
            minLength={CLINIC_LEAD_DESCRIPTION_MIN}
            maxLength={CLINIC_LEAD_DESCRIPTION_MAX}
            rows={compact ? 2 : 4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Error codes, no power, PM due, install — a short note is enough."
          />
        </label>
        <div className="lp-modal-actions">
          {onCancel ? (
            <button type="button" className="lp-btn lp-btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button type="submit" className="lp-btn lp-btn-primary" disabled={sending}>
            {sending ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </div>
  );
}
