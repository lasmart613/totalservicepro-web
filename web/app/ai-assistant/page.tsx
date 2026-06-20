'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';

const EXAMPLE_PROMPTS = [
  'How do I perform a dye kit refresh on a Candela V-Beam?',
  'Safety checklist for GentleLASE alignment',
  'What is the typical pulse count before lamp replacement on a Cynosure Elite?',
  'Troubleshooting handpiece not firing on Syneron Candela',
  'Recommended PM intervals for a Fotona SP Dynamis',
];

export default function AIAssistant() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  function askAI() {
    if (!query.trim()) return;
    setLoading(true);
    setResponse('');

    // Simple operational mock based on Android-style laser service knowledge (no external AI dependency)
    const q = query.toLowerCase();
    let answer = 'Thanks for the question. In a full integration this would query a knowledge base or LLM trained on laser service manuals. ';

    if (q.includes('dye') || q.includes('v-beam')) {
      answer += 'For Candela V-Beam dye kit refresh: Power off, drain old dye, flush lines with distilled water + isopropyl, refill with fresh dye mix per manual (usually 1:10 ratio), prime pump, test fire at low energy. Always wear proper laser safety eyewear.';
    } else if (q.includes('safety') || q.includes('checklist')) {
      answer += 'Standard safety checklist: Verify interlocks, key switch, emergency stop, fiber integrity, eyewear OD rating matches wavelength, room signage, no reflective surfaces, calibrated power meter ready, patient/ tech protection in place.';
    } else if (q.includes('pulse') || q.includes('lamp')) {
      answer += 'Typical lamp life 50k-150k pulses depending on model/energy. Monitor for energy drop >10% or inconsistent output. Replace at manufacturer recommended pulse count or when performance degrades. Log all pulses in the service report.';
    } else if (q.includes('handpiece') || q.includes('not firing')) {
      answer += 'Common causes: fiber damage, handpiece connector dirty, low coolant, trigger switch failure, or software interlock. Inspect fiber for breaks with flashlight test, clean contacts, check chiller, try spare handpiece to isolate.';
    } else {
      answer += 'For best results describe the exact laser model (e.g. Cynosure Elite, Candela GentleLASE) and symptom. Common topics: PM procedures, calibration, safety certification, consumables replacement.';
    }

    setTimeout(() => {
      setResponse(answer);
      setLoading(false);
    }, 400); // simulate "thinking"
  }

  function useExample(prompt: string) {
    setQuery(prompt);
    setTimeout(() => {
      askAIWithPrompt(prompt);
    }, 10);
  }

  function askAIWithPrompt(p: string) {
    setLoading(true);
    setResponse('');
    const q = p.toLowerCase();
    let answer = 'Thanks for the question. ';

    if (q.includes('dye') || q.includes('v-beam')) {
      answer += 'For Candela V-Beam dye kit refresh: Power off, drain old dye, flush lines with distilled water + isopropyl, refill with fresh dye mix per manual (usually 1:10 ratio), prime pump, test fire at low energy. Always wear proper laser safety eyewear.';
    } else if (q.includes('safety') || q.includes('checklist')) {
      answer += 'Standard safety checklist: Verify interlocks, key switch, emergency stop, fiber integrity, eyewear OD rating matches wavelength, room signage, no reflective surfaces, calibrated power meter ready, patient/ tech protection in place.';
    } else if (q.includes('pulse') || q.includes('lamp')) {
      answer += 'Typical lamp life 50k-150k pulses depending on model/energy. Monitor for energy drop >10% or inconsistent output. Replace at manufacturer recommended pulse count or when performance degrades. Log all pulses in the service report.';
    } else if (q.includes('handpiece') || q.includes('not firing')) {
      answer += 'Common causes: fiber damage, handpiece connector dirty, low coolant, trigger switch failure, or software interlock. Inspect fiber for breaks with flashlight test, clean contacts, check chiller, try spare handpiece to isolate.';
    } else {
      answer += 'For best results describe the exact laser model (e.g. Cynosure Elite, Candela GentleLASE) and symptom. Common topics: PM procedures, calibration, safety certification, consumables replacement.';
    }

    setTimeout(() => {
      setResponse(answer);
      setLoading(false);
    }, 300);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-extrabold mb-1">🤖 AI Assistant</h1>
        <p className="text-sm text-[var(--text3)] mb-6">Laser service guidance &amp; troubleshooting (operational stub matching Android ai_assistant.html style)</p>

        <div className="card p-5 mb-6">
          <div className="font-bold mb-2">Ask a question</div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="e.g. How to align a GentleLASE or dye kit refresh steps"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && askAI()}
            />
            <button onClick={askAI} disabled={loading || !query.trim()} className="btn btn-primary">
              {loading ? 'Thinking...' : 'Ask AI'}
            </button>
          </div>

          <div className="mt-3 text-xs text-[var(--text3)]">Example prompts:</div>
          <div className="flex flex-wrap gap-2 mt-1">
            {EXAMPLE_PROMPTS.map((p, i) => (
              <button key={i} onClick={() => useExample(p)} className="text-xs px-2 py-1 rounded bg-[var(--surface3)] hover:bg-[var(--gold-glow)]">
                {p}
              </button>
            ))}
          </div>
        </div>

        {response && (
          <div className="card p-5 mb-6 whitespace-pre-wrap text-sm border border-[var(--gold-border)]">
            <div className="font-semibold mb-2 text-[var(--gold)]">AI Response</div>
            {response}
          </div>
        )}

        <div className="text-xs text-[var(--text3)] mt-4">
          This is a functional operational stub (keyword-based responses for common laser tech questions). Full version in the Android app uses more sophisticated local knowledge base / integration. Expandable with real LLM backend later.
        </div>

        <div className="mt-6">
          <Link href="/hub" className="text-sm text-[var(--gold)] hover:underline">← Back to Tech Hub</Link>
        </div>
      </div>
    </div>
  );
}
