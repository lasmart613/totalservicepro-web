'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { toast } from 'sonner';

// Full lookup table ported from Android wavelength.html (VBeam filter method ~586-600nm)
const lookupTable: { delta: number; wavelength: number }[] = [
  {delta:5.83,wavelength:586.00},{delta:5.97,wavelength:586.10},{delta:6.11,wavelength:586.20},{delta:6.25,wavelength:586.30},{delta:6.39,wavelength:586.40},{delta:6.53,wavelength:586.50},{delta:6.67,wavelength:586.60},{delta:6.81,wavelength:586.70},{delta:6.95,wavelength:586.80},{delta:7.09,wavelength:586.90},
  {delta:7.23,wavelength:587.00},{delta:7.47,wavelength:587.10},{delta:7.71,wavelength:587.20},{delta:7.95,wavelength:587.30},{delta:8.19,wavelength:587.40},{delta:8.44,wavelength:587.50},{delta:8.68,wavelength:587.60},{delta:8.92,wavelength:587.70},{delta:9.16,wavelength:587.80},{delta:9.40,wavelength:587.90},
  {delta:9.64,wavelength:588.00},{delta:9.95,wavelength:588.10},{delta:10.25,wavelength:588.20},{delta:10.55,wavelength:588.30},{delta:10.85,wavelength:588.40},{delta:11.16,wavelength:588.50},{delta:11.46,wavelength:588.60},{delta:11.76,wavelength:588.70},{delta:12.06,wavelength:588.80},{delta:12.36,wavelength:588.90},
  {delta:12.66,wavelength:589.00},{delta:12.93,wavelength:589.10},{delta:13.19,wavelength:589.20},{delta:13.46,wavelength:589.30},{delta:13.73,wavelength:589.40},{delta:14.00,wavelength:589.50},{delta:14.26,wavelength:589.60},{delta:14.53,wavelength:589.70},{delta:14.79,wavelength:589.80},{delta:15.06,wavelength:589.90},
  {delta:15.32,wavelength:590.00},{delta:15.46,wavelength:590.10},{delta:15.60,wavelength:590.20},{delta:15.74,wavelength:590.30},{delta:15.87,wavelength:590.40},{delta:16.01,wavelength:590.50},{delta:16.15,wavelength:590.60},{delta:16.29,wavelength:590.70},{delta:16.43,wavelength:590.80},{delta:16.57,wavelength:590.90},
  {delta:16.71,wavelength:591.00},{delta:16.82,wavelength:591.10},{delta:16.93,wavelength:591.20},{delta:17.05,wavelength:591.30},{delta:17.16,wavelength:591.40},{delta:17.27,wavelength:591.50},{delta:17.38,wavelength:591.60},{delta:17.50,wavelength:591.70},{delta:17.61,wavelength:591.80},{delta:17.72,wavelength:591.90},
  {delta:17.83,wavelength:592.00},{delta:18.04,wavelength:592.10},{delta:18.24,wavelength:592.20},{delta:18.45,wavelength:592.30},{delta:18.65,wavelength:592.40},{delta:18.86,wavelength:592.50},{delta:19.06,wavelength:592.60},{delta:19.27,wavelength:592.70},{delta:19.47,wavelength:592.80},{delta:19.68,wavelength:592.90},
  {delta:19.89,wavelength:593.00},{delta:20.24,wavelength:593.10},{delta:20.59,wavelength:593.20},{delta:20.95,wavelength:593.30},{delta:21.30,wavelength:593.40},{delta:21.66,wavelength:593.50},{delta:22.01,wavelength:593.60},{delta:22.37,wavelength:593.70},{delta:22.72,wavelength:593.80},{delta:23.08,wavelength:593.90},
  {delta:23.43,wavelength:594.00},{delta:23.91,wavelength:594.10},{delta:24.38,wavelength:594.20},{delta:24.86,wavelength:594.30},{delta:25.33,wavelength:594.40},{delta:25.81,wavelength:594.50},{delta:26.28,wavelength:594.60},{delta:26.76,wavelength:594.70},{delta:27.24,wavelength:594.80},{delta:27.72,wavelength:594.90},
  {delta:28.19,wavelength:595.00},{delta:28.78,wavelength:595.10},{delta:29.36,wavelength:595.20},{delta:29.95,wavelength:595.30},{delta:30.53,wavelength:595.40},{delta:31.12,wavelength:595.50},{delta:31.70,wavelength:595.60},{delta:32.29,wavelength:595.70},{delta:32.87,wavelength:595.80},{delta:33.46,wavelength:595.90},
  {delta:34.04,wavelength:596.00},{delta:34.61,wavelength:596.10},{delta:35.18,wavelength:596.20},{delta:35.76,wavelength:596.30},{delta:36.33,wavelength:596.40},{delta:36.91,wavelength:596.50},{delta:37.48,wavelength:596.60},{delta:38.05,wavelength:596.70},{delta:38.62,wavelength:596.80},{delta:39.20,wavelength:596.90},
  {delta:39.77,wavelength:597.00},{delta:40.21,wavelength:597.10},{delta:40.65,wavelength:597.20},{delta:41.10,wavelength:597.30},{delta:41.54,wavelength:597.40},{delta:41.98,wavelength:597.50},{delta:42.42,wavelength:597.60},{delta:42.86,wavelength:597.70},{delta:43.30,wavelength:597.80},{delta:43.75,wavelength:597.90},
  {delta:44.19,wavelength:598.00},{delta:44.53,wavelength:598.10},{delta:44.87,wavelength:598.20},{delta:45.22,wavelength:598.30},{delta:45.56,wavelength:598.40},{delta:45.90,wavelength:598.50},{delta:46.24,wavelength:598.60},{delta:46.58,wavelength:598.70},{delta:46.92,wavelength:598.80},{delta:47.27,wavelength:598.90},
  {delta:47.61,wavelength:599.00},{delta:47.95,wavelength:599.10},{delta:48.28,wavelength:599.20},{delta:48.61,wavelength:599.30},{delta:48.94,wavelength:599.40},{delta:49.28,wavelength:599.50},{delta:49.61,wavelength:599.60},{delta:49.95,wavelength:599.70},{delta:50.28,wavelength:599.80},{delta:50.62,wavelength:599.90},
  {delta:50.95,wavelength:600.00}
];

// Shared area calculation (ported exactly)
function getAreaCm2(shape: 'circular' | 'rectangular', rectType: 'square' | 'rectangular', diameter: number, side: number, rectLength: number, rectWidth: number): number {
  if (shape === 'circular') {
    const d = diameter || 0;
    return Math.PI * Math.pow(d / 2, 2) / 100;
  } else if (rectType === 'square') {
    const s = side || 0;
    return (s * s) / 100;
  } else {
    const l = rectLength || 0;
    const w = rectWidth || 0;
    return (l * w) / 100;
  }
}

// ===== DENSITY / FLUENCE / IRRADIANCE (unified from density_calculator.html + fluence/irradiance) =====
function DensityCalculator({ initialMode = 'fluence' }: { initialMode?: 'fluence' | 'irradiance' }) {
  const [currentMode, setCurrentMode] = useState<'fluence' | 'irradiance'>(initialMode);
  const [currentShape, setCurrentShape] = useState<'circular' | 'rectangular'>('circular');
  const [currentRectType, setCurrentRectType] = useState<'square' | 'rectangular'>('square');
  const [currentWaveform, setCurrentWaveform] = useState<'cw' | 'pulsed'>('cw');
  const [pulsedInputMode, setPulsedInputMode] = useState<'energy' | 'fluence'>('energy');

  // Controlled inputs (strings for form friendliness)
  const [diameter, setDiameter] = useState('15');
  const [sideLength, setSideLength] = useState('10');
  const [rectLength, setRectLength] = useState('10');
  const [rectWidth, setRectWidth] = useState('10');

  const [valueInput, setValueInput] = useState(''); // Energy (J) or Power (W)
  const [energyPerPulse, setEnergyPerPulse] = useState('');
  const [fluencePerPulse, setFluencePerPulse] = useState('');
  const [repRate, setRepRate] = useState('');

  // Result state
  const [result, setResult] = useState<{
    value: string;
    label: string;
    unit: string;
    rows: { label: string; val: string }[];
  } | null>(null);

  // Diameter/side options (2-30mm, same as Android)
  const diamOptions = Array.from({ length: 29 }, (_, i) => (i + 2).toString());
  const sideOptions = Array.from({ length: 29 }, (_, i) => (i + 2).toString());

  // Reset result when key params change
  useEffect(() => {
    setResult(null);
  }, [currentMode, currentShape, currentRectType, currentWaveform, pulsedInputMode,
      diameter, sideLength, rectLength, rectWidth, valueInput, energyPerPulse, fluencePerPulse, repRate]);

  function updateMode(mode: 'fluence' | 'irradiance') {
    setCurrentMode(mode);
    if (mode === 'fluence') {
      setCurrentWaveform('cw');
    }
    setResult(null);
  }

  function updateWaveform(w: 'cw' | 'pulsed') {
    setCurrentWaveform(w);
    setResult(null);
  }

  function updatePulsedInputMode(m: 'energy' | 'fluence') {
    setPulsedInputMode(m);
    setResult(null);
  }

  function updateShape(s: 'circular' | 'rectangular') {
    setCurrentShape(s);
    setResult(null);
  }

  function updateRectType(t: 'square' | 'rectangular') {
    setCurrentRectType(t);
    setResult(null);
  }

  function calculate() {
    const isFluence = currentMode === 'fluence';
    const isPulsed = currentMode === 'irradiance' && currentWaveform === 'pulsed';
    const area = getAreaCm2(currentShape, currentRectType, parseFloat(diameter), parseFloat(sideLength), parseFloat(rectLength), parseFloat(rectWidth));

    if (isPulsed) {
      const rep = parseFloat(repRate);
      if (isNaN(rep) || rep <= 0 || area <= 0) {
        toast.error('Enter valid Rep Rate and spot size');
        return;
      }

      let avgIrradiance: number, avgPower: number, perPulseValue: number, perPulseUnit: string;

      if (pulsedInputMode === 'energy') {
        const energy = parseFloat(energyPerPulse);
        if (isNaN(energy) || energy <= 0) {
          toast.error('Enter valid energy per pulse');
          return;
        }
        avgPower = energy * rep;
        avgIrradiance = avgPower / area;
        perPulseValue = energy;
        perPulseUnit = 'J';
      } else {
        const fl = parseFloat(fluencePerPulse);
        if (isNaN(fl) || fl <= 0) {
          toast.error('Enter valid fluence per pulse');
          return;
        }
        avgIrradiance = fl * rep;
        avgPower = avgIrradiance * area;
        perPulseValue = fl;
        perPulseUnit = 'J/cm²';
      }

      setResult({
        value: avgIrradiance.toFixed(2),
        label: 'Avg Irradiance',
        unit: 'W/cm²',
        rows: [
          { label: 'Per-Pulse', val: `${perPulseValue} ${perPulseUnit}` },
          { label: 'Rep Rate', val: `${rep} Hz` },
          { label: 'Avg Power', val: `${avgPower.toFixed(2)} W` },
          { label: 'Spot Area', val: `${area.toFixed(4)} cm²` },
          { label: 'Avg Irradiance', val: `${avgIrradiance.toFixed(2)} W/cm²` },
        ],
      });
      return;
    }

    // Fluence or CW Irradiance
    const val = parseFloat(valueInput);
    if (isNaN(val) || val <= 0 || area <= 0) {
      toast.error('Enter valid positive values');
      return;
    }

    const res = val / area;

    setResult({
      value: res.toFixed(2),
      label: isFluence ? 'Fluence' : 'Irradiance',
      unit: isFluence ? 'J/cm²' : 'W/cm²',
      rows: [
        { label: isFluence ? 'Energy' : 'Power', val: `${val} ${isFluence ? 'J' : 'W'}` },
        { label: 'Spot Area', val: `${area.toFixed(4)} cm²` },
        { label: isFluence ? 'Fluence' : 'Irradiance', val: `${res.toFixed(2)} ${isFluence ? 'J/cm²' : 'W/cm²'}` },
      ],
    });
  }

  const isFluence = currentMode === 'fluence';
  const isPulsed = currentMode === 'irradiance' && currentWaveform === 'pulsed';

  const formula = isFluence
    ? 'Fluence (J/cm²) = Energy (J) ÷ Area (cm²)\nCircular Area = π × (d÷2)² ÷ 100\nSquare Area = s² ÷ 100\nRect Area = L × W ÷ 100'
    : (isPulsed
      ? 'Avg Power (W) = Energy per pulse (J) × Rep Rate (Hz)\nAvg Irradiance = Avg Power ÷ Area\n— OR —\nAvg Irradiance (W/cm²) = Fluence per pulse (J/cm²) × Rep Rate (Hz)'
      : 'Irradiance (W/cm²) = Power (W) ÷ Area (cm²)\nCircular Area = π × (d÷2)² ÷ 100\nSquare Area = s² ÷ 100\nRect Area = L × W ÷ 100');

  return (
    <div className="calc-page">
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Energy &amp; Power Density</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>Fluence (J/cm²) • Irradiance (W/cm²) — unified calculator</div>
      </div>

      {/* Mode Toggle */}
      <div className="button-row">
        <button className={`btn-option ${isFluence ? 'active' : ''}`} onClick={() => updateMode('fluence')}>Fluence (J/cm²)</button>
        <button className={`btn-option ${!isFluence ? 'active' : ''}`} onClick={() => updateMode('irradiance')}>Irradiance (W/cm²)</button>
      </div>

      {/* Waveform (Irradiance only) */}
      {!isFluence && (
        <div className="form-group">
          <label className="label">Waveform</label>
          <div className="button-row">
            <button className={`btn-option ${currentWaveform === 'cw' ? 'active' : ''}`} onClick={() => updateWaveform('cw')}>CW</button>
            <button className={`btn-option ${currentWaveform === 'pulsed' ? 'active' : ''}`} onClick={() => updateWaveform('pulsed')}>Pulsed</button>
          </div>
        </div>
      )}

      {/* Pulsed specific inputs */}
      {isPulsed && (
        <div className="form-group">
          <label className="label">Per-Pulse Input</label>
          <div className="button-row">
            <button className={`btn-option ${pulsedInputMode === 'energy' ? 'active' : ''}`} onClick={() => updatePulsedInputMode('energy')}>Energy per Pulse (J)</button>
            <button className={`btn-option ${pulsedInputMode === 'fluence' ? 'active' : ''}`} onClick={() => updatePulsedInputMode('fluence')}>Fluence per Pulse (J/cm²)</button>
          </div>

          {pulsedInputMode === 'energy' ? (
            <div>
              <label className="label" style={{ fontSize: 12, color: 'var(--text3)' }}>Energy per Pulse</label>
              <input type="number" className="input" step="0.01" placeholder="e.g. 2.5" value={energyPerPulse} onChange={(e) => setEnergyPerPulse(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="label" style={{ fontSize: 12, color: 'var(--text3)' }}>Fluence per Pulse</label>
              <input type="number" className="input" step="0.01" placeholder="e.g. 12.5" value={fluencePerPulse} onChange={(e) => setFluencePerPulse(e.target.value)} />
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <label className="label" style={{ fontSize: 12, color: 'var(--text3)' }}>Repetition Rate (Hz / pps)</label>
            <input type="number" className="input" step="0.1" placeholder="e.g. 10" value={repRate} onChange={(e) => setRepRate(e.target.value)} />
          </div>
        </div>
      )}

      {/* Beam Shape */}
      <div className="form-group">
        <label className="label">Beam Shape</label>
        <div className="button-row">
          <button className={`btn-option ${currentShape === 'circular' ? 'active' : ''}`} onClick={() => updateShape('circular')}>Circular</button>
          <button className={`btn-option ${currentShape === 'rectangular' ? 'active' : ''}`} onClick={() => updateShape('rectangular')}>Rectangular</button>
        </div>

        {currentShape === 'circular' ? (
          <div>
            <label className="label" style={{ fontSize: 12, color: 'var(--text3)' }}>Diameter (mm)</label>
            <select className="select" value={diameter} onChange={(e) => setDiameter(e.target.value)}>
              {diamOptions.map((d) => <option key={d} value={d}>{d} mm</option>)}
            </select>
          </div>
        ) : (
          <div>
            <div className="button-row">
              <button className={`btn-option ${currentRectType === 'square' ? 'active' : ''}`} onClick={() => updateRectType('square')}>Square</button>
              <button className={`btn-option ${currentRectType === 'rectangular' ? 'active' : ''}`} onClick={() => updateRectType('rectangular')}>Rectangle</button>
            </div>

            {currentRectType === 'square' ? (
              <div>
                <label className="label" style={{ fontSize: 12, color: 'var(--text3)' }}>Side Length (mm)</label>
                <select className="select" value={sideLength} onChange={(e) => setSideLength(e.target.value)}>
                  {sideOptions.map((s) => <option key={s} value={s}>{s} mm</option>)}
                </select>
              </div>
            ) : (
              <div className="form-row">
                <div>
                  <label className="label" style={{ fontSize: 12, color: 'var(--text3)' }}>Length (mm)</label>
                  <select className="select" value={rectLength} onChange={(e) => setRectLength(e.target.value)}>
                    {sideOptions.map((s) => <option key={s} value={s}>{s} mm</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" style={{ fontSize: 12, color: 'var(--text3)' }}>Width (mm)</label>
                  <select className="select" value={rectWidth} onChange={(e) => setRectWidth(e.target.value)}>
                    {sideOptions.map((s) => <option key={s} value={s}>{s} mm</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Single value input (not for pulsed) */}
      {!isPulsed && (
        <div className="form-group">
          <label className="label">{isFluence ? 'Energy (Joules)' : 'Peak Power (Watts)'}</label>
          <input
            type="number"
            className="input"
            step="0.01"
            placeholder={isFluence ? 'e.g. 1.5' : 'e.g. 500'}
            value={valueInput}
            onChange={(e) => setValueInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') calculate(); }}
          />
        </div>
      )}

      <button className="btn btn-primary btn-block" style={{ width: '100%', padding: '14px', fontSize: 16 }} onClick={calculate}>
        {isFluence ? 'Calculate Fluence' : (isPulsed ? 'Calculate Average Irradiance' : 'Calculate Irradiance')}
      </button>

      {result && (
        <div className="result-card">
          <div className="result-label">{result.label}</div>
          <div>
            <span className="result-value">{result.value}</span>
            <span className="result-unit">{result.unit}</span>
          </div>
          <div className="result-detail">
            {result.rows.map((r, idx) => (
              <div key={idx} className="result-row">
                <span>{r.label}</span>
                <span className="result-row-val">{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="formula-box">{formula}</div>
    </div>
  );
}

// ===== DUTY CYCLE =====
function DutyCycleCalculator() {
  const [pulseWidth, setPulseWidth] = useState('');
  const [offTime, setOffTime] = useState('');
  const [pps, setPps] = useState('');
  const [result, setResult] = useState<{
    duty: string;
    rows: { label: string; val: string }[];
  } | null>(null);

  useEffect(() => { setResult(null); }, [pulseWidth, offTime, pps]);

  function calculateDutyCycle() {
    const pw = parseFloat(pulseWidth);
    const off = parseFloat(offTime);
    const freq = parseFloat(pps);

    if (!pw || pw <= 0) {
      toast.error('Enter a valid pulse width');
      return;
    }
    const hasOff = off && off > 0;
    const hasPPS = freq && freq > 0;

    if (!hasOff && !hasPPS) {
      toast.error('Enter either Off-Time or PPS');
      return;
    }
    if (hasOff && hasPPS) {
      toast.error('Enter only one: Off-Time OR PPS');
      return;
    }

    let dutyCycle: number, period: number, frequency: number, calcOff: number;

    if (hasOff) {
      period = pw + off;
      frequency = 1000 / period;
      dutyCycle = (pw / period) * 100;
      calcOff = off;
    } else {
      frequency = freq;
      period = 1000 / freq;
      calcOff = period - pw;
      if (calcOff < 0) {
        toast.error('Pulse width exceeds period (1/PPS)');
        return;
      }
      dutyCycle = (pw / period) * 100;
    }

    setResult({
      duty: dutyCycle.toFixed(2) + '%',
      rows: [
        { label: 'Pulse Width', val: `${pw.toFixed(3)} ms` },
        { label: 'Off-Time', val: `${calcOff.toFixed(3)} ms` },
        { label: 'Period', val: `${period.toFixed(3)} ms` },
        { label: 'Frequency', val: `${frequency.toFixed(2)} Hz` },
        { label: 'Duty Cycle', val: `${dutyCycle.toFixed(2)}%` },
      ],
    });
  }

  return (
    <div className="calc-page">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Duty Cycle Calculator</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>Pulse duty cycle for pulsed laser systems</div>
      </div>

      <div className="form-group">
        <label className="label">Pulse Width / On-Time (ms)</label>
        <input type="number" className="input" step="0.001" placeholder="e.g. 10" value={pulseWidth} onChange={(e) => setPulseWidth(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') calculateDutyCycle(); }} />
      </div>

      <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>Enter <strong style={{ color: 'var(--text)' }}>one</strong> of the following:</div>

      <div className="form-group">
        <label className="label">Off-Time (ms)</label>
        <input type="number" className="input" step="0.001" placeholder="e.g. 90" value={offTime} onChange={(e) => setOffTime(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') calculateDutyCycle(); }} />
      </div>

      <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12, fontWeight: 700, margin: '8px 0', letterSpacing: 1 }}>— OR —</div>

      <div className="form-group">
        <label className="label">Pulses Per Second (Hz)</label>
        <input type="number" className="input" step="0.01" placeholder="e.g. 10" value={pps} onChange={(e) => setPps(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') calculateDutyCycle(); }} />
      </div>

      <button className="btn btn-primary btn-block" style={{ width: '100%' }} onClick={calculateDutyCycle}>Calculate Duty Cycle</button>

      {result && (
        <div className="result-card">
          <div className="result-label">Duty Cycle</div>
          <div className="result-value" style={{ fontSize: 48 }}>{result.duty}</div>
          <div className="result-detail">
            {result.rows.map((r, i) => (
              <div key={i} className="result-row"><span>{r.label}</span><span className="result-row-val">{r.val}</span></div>
            ))}
          </div>
        </div>
      )}

      <div className="formula-box">
        Duty Cycle (%) = Pulse Width ÷ Period × 100<br />
        Period = Pulse Width + Off-Time<br />
        Period (ms) = 1000 ÷ PPS
      </div>
    </div>
  );
}

// ===== WAVELENGTH (VBeam filter wizard, 3 screens + lookup) =====
function WavelengthCalculator() {
  const [screen, setScreen] = useState(1);
  const [correctionFactor, setCorrectionFactor] = useState('0.0');
  const [energyOut1, setEnergyOut1] = useState('');
  const [hd1_1, setHd1_1] = useState('');
  const [energyOut2, setEnergyOut2] = useState('');
  const [hd1_2, setHd1_2] = useState('');
  const [result, setResult] = useState<{ wavelength: string; details: string } | null>(null);

  // Load/save CF like Android
  useEffect(() => {
    const saved = localStorage.getItem('correctionFactor');
    if (saved !== null) setCorrectionFactor(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem('correctionFactor', correctionFactor);
  }, [correctionFactor]);

  useEffect(() => { setResult(null); }, [energyOut1, hd1_1, energyOut2, hd1_2, correctionFactor, screen]);

  function lookupWavelength(d: number): number {
    let closest = lookupTable[0];
    let minDiff = Math.abs(d - closest.delta);
    for (let i = 1; i < lookupTable.length; i++) {
      const diff = Math.abs(d - lookupTable[i].delta);
      if (diff < minDiff) { minDiff = diff; closest = lookupTable[i]; }
    }
    for (let i = 0; i < lookupTable.length - 1; i++) {
      if (d >= lookupTable[i].delta && d <= lookupTable[i + 1].delta) {
        const d1 = lookupTable[i].delta, d2 = lookupTable[i + 1].delta;
        const w1 = lookupTable[i].wavelength, w2 = lookupTable[i + 1].wavelength;
        return w1 + (w2 - w1) * (d - d1) / (d2 - d1);
      }
    }
    return closest.wavelength;
  }

  function goToScreen1() { setScreen(1); setResult(null); }
  function goToScreen2() { setScreen(2); setResult(null); }
  function goToScreen3() {
    const e1 = parseFloat(energyOut1), h1 = parseFloat(hd1_1);
    if (isNaN(e1) || isNaN(h1) || e1 <= 0 || h1 <= 0) {
      toast.error('Enter valid readings for both fields');
      return;
    }
    setScreen(3);
  }

  function calculateWavelength() {
    const e1 = parseFloat(energyOut1), h1 = parseFloat(hd1_1);
    const e2 = parseFloat(energyOut2), h2 = parseFloat(hd1_2);
    const cf = parseFloat(correctionFactor);
    if (isNaN(e2) || isNaN(h2) || e2 <= 0 || h2 <= 0) {
      toast.error('Enter valid readings for both fields');
      return;
    }
    const t1 = e1 / h1;
    const t2 = e2 / h2;
    const dp = (t2 / t1) * 100;
    const base = lookupWavelength(dp);
    const final = base + cf;

    setResult({
      wavelength: final.toFixed(2),
      details: `Without filter: ${t1.toFixed(4)} (${e1}/${h1})\nWith filter: ${t2.toFixed(4)} (${e2}/${h2})\nDelta%: ${dp.toFixed(2)}%\nBase wavelength: ${base.toFixed(2)} nm\nCorrection: ${cf >= 0 ? '+' : ''}${cf.toFixed(1)} nm`,
    });
  }

  function resetCalculator() {
    setEnergyOut1(''); setHd1_1(''); setEnergyOut2(''); setHd1_2('');
    setResult(null);
    setScreen(2);
  }

  const cfVal = parseFloat(correctionFactor);
  const cfStatus = cfVal === 0 ? 'No correction factor applied' : cfVal > 0 ? `Correction factor: +${cfVal.toFixed(1)} nm` : `Correction factor: ${cfVal.toFixed(1)} nm`;

  return (
    <div className="calc-page">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>VBeam Wavelength</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>Candela VBeam wavelength determination via interference filter</div>
      </div>

      <div className="step-dots">
        {[1,2,3].map(n => <div key={n} className={`step-dot ${screen === n ? 'active' : ''}`} />)}
      </div>

      {/* Screen 1 */}
      <div className={`screen ${screen === 1 ? 'active' : ''}`}>
        <div className="info-box">Set the correction factor printed on your interference filter. Only needs to be set once.</div>
        <div className="form-group">
          <label className="label">Correction Factor (nm)</label>
          <select className="select" value={correctionFactor} onChange={(e) => setCorrectionFactor(e.target.value)}>
            {[-0.5,-0.4,-0.3,-0.2,-0.1,0.0,0.1,0.2,0.3,0.4,0.5].map(v => (
              <option key={v} value={v.toFixed(1)}>{v > 0 ? '+' : ''}{v.toFixed(1)} nm</option>
            ))}
          </select>
          <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 8, minHeight: 18 }}>{cfStatus}</div>
        </div>
        <button className="btn btn-primary btn-block" style={{ width: '100%' }} onClick={() => { goToScreen2(); }}>Next: Readings Without Filter →</button>
      </div>

      {/* Screen 2 */}
      <div className={`screen ${screen === 2 ? 'active' : ''}`}>
        <div className="info-box">Take readings <strong>WITHOUT</strong> the filter installed.</div>
        <div className="form-group">
          <label className="label">Energy out of fiber (mJ)</label>
          <input type="number" className="input" step="0.01" placeholder="Enter energy" value={energyOut1} onChange={(e) => setEnergyOut1(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label">Head Detector 1 — HD1 (mJ)</label>
          <input type="number" className="input" step="0.01" placeholder="Enter HD1 reading" value={hd1_1} onChange={(e) => setHd1_1(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={goToScreen1}>← Back</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={goToScreen3}>Next: With Filter →</button>
        </div>
      </div>

      {/* Screen 3 */}
      <div className={`screen ${screen === 3 ? 'active' : ''}`}>
        <div className="info-box">Take readings <strong>WITH</strong> the filter installed.</div>
        <div className="form-group">
          <label className="label">Energy out of fiber (mJ)</label>
          <input type="number" className="input" step="0.01" placeholder="Enter energy" value={energyOut2} onChange={(e) => setEnergyOut2(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label">Head Detector 1 — HD1 (mJ)</label>
          <input type="number" className="input" step="0.01" placeholder="Enter HD1 reading" value={hd1_2} onChange={(e) => setHd1_2(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setScreen(2)}>← Back</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={calculateWavelength}>Calculate Wavelength</button>
        </div>

        {result && (
          <div className="result-card" style={{ display: 'block' }}>
            <div className="result-label">Calculated Wavelength</div>
            <div>
              <span className="result-value">{result.wavelength}</span> <span className="result-unit">nm</span>
            </div>
            <div className="formula-box" style={{ marginTop: 14, whiteSpace: 'pre-line', fontSize: 12 }}>{result.details}</div>
          </div>
        )}

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={resetCalculator}>↺ New Calculation</button>
      </div>
    </div>
  );
}

// ===== AVG POWER =====
function AvgPowerCalculator() {
  const [calcMode, setCalcMode] = useState<'forward' | 'reverse'>('forward');
  const [energy, setEnergy] = useState('');
  const [energyUnit, setEnergyUnit] = useState<'mJ' | 'J'>('mJ');
  const [avgPowerIn, setAvgPowerIn] = useState('');
  const [frequency, setFrequency] = useState('');
  const [result, setResult] = useState<{
    label: string;
    value: string;
    rows: { label: string; val: string }[];
  } | null>(null);

  useEffect(() => { setResult(null); }, [calcMode, energy, energyUnit, avgPowerIn, frequency]);

  function setMode(m: 'forward' | 'reverse') {
    setCalcMode(m);
    setResult(null);
  }

  function calculate() {
    const freq = parseFloat(frequency);
    if (!freq || freq <= 0) {
      toast.error('Enter a valid frequency');
      return;
    }

    if (calcMode === 'forward') {
      let e = parseFloat(energy);
      if (isNaN(e) || e <= 0) {
        toast.error('Enter a valid energy value');
        return;
      }
      if (energyUnit === 'mJ') e /= 1000;

      const p = e * freq;

      setResult({
        label: 'Average Power',
        value: `${p.toFixed(3)} W`,
        rows: [
          { label: 'Energy', val: `${energy} ${energyUnit}` },
          { label: 'Frequency', val: `${freq} Hz` },
          { label: 'Avg Power', val: `${p.toFixed(3)} W` },
        ],
      });
    } else {
      const p = parseFloat(avgPowerIn);
      if (isNaN(p) || p <= 0) {
        toast.error('Enter a valid power value');
        return;
      }
      let e = p / freq;
      const eDisplay = energyUnit === 'mJ' ? `${(e * 1000).toFixed(3)} mJ` : `${e.toFixed(4)} J`;

      setResult({
        label: 'Pulse Energy',
        value: eDisplay,
        rows: [
          { label: 'Avg Power', val: `${p} W` },
          { label: 'Frequency', val: `${freq} Hz` },
          { label: 'Pulse Energy', val: eDisplay },
        ],
      });
    }
  }

  return (
    <div className="calc-page">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Average Power Calculator</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>Energy × frequency or power ÷ frequency</div>
      </div>

      <div className="form-group">
        <label className="label">Mode</label>
        <div className="button-row">
          <button className={`btn-option ${calcMode === 'forward' ? 'active' : ''}`} onClick={() => setMode('forward')}>Energy → Power</button>
          <button className={`btn-option ${calcMode === 'reverse' ? 'active' : ''}`} onClick={() => setMode('reverse')}>Power → Energy</button>
        </div>
      </div>

      {calcMode === 'forward' ? (
        <div className="form-group">
          <label className="label">Pulse Energy</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" className="input" step="0.001" placeholder="e.g. 50" style={{ flex: 1 }} value={energy} onChange={(e) => setEnergy(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') calculate(); }} />
            <select className="select" style={{ width: 80 }} value={energyUnit} onChange={(e) => setEnergyUnit(e.target.value as 'mJ' | 'J')}>
              <option value="mJ">mJ</option>
              <option value="J">J</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="form-group">
          <label className="label">Average Power (W)</label>
          <input type="number" className="input" step="0.01" placeholder="e.g. 5" value={avgPowerIn} onChange={(e) => setAvgPowerIn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') calculate(); }} />
        </div>
      )}

      <div className="form-group">
        <label className="label">Repetition Rate (Hz)</label>
        <input type="number" className="input" step="0.1" placeholder="e.g. 10" value={frequency} onChange={(e) => setFrequency(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') calculate(); }} />
      </div>

      <button className="btn btn-primary btn-block" style={{ width: '100%' }} onClick={calculate}>Calculate</button>

      {result && (
        <div className="result-card">
          <div className="result-label">{result.label}</div>
          <div className="result-value" style={{ fontSize: 48 }}>{result.value}</div>
          <div className="result-detail">
            {result.rows.map((r, i) => (
              <div key={i} className="result-row"><span>{r.label}</span><span className="result-row-val">{r.val}</span></div>
            ))}
          </div>
        </div>
      )}

      <div className="formula-box">
        Avg Power (W) = Energy (J) × Frequency (Hz)<br />
        Pulse Energy (J) = Avg Power (W) ÷ Frequency (Hz)<br />
        1 J = 1000 mJ
      </div>
    </div>
  );
}

// ===== MAIN PAGE =====
export default function CalculatorsPage() {
  const [selected, setSelected] = useState<null | 'density-fluence' | 'density-irradiance' | 'duty' | 'wavelength' | 'avgpower'>(null);

  function handleSelect(tool: typeof selected) {
    setSelected(tool);
  }

  function backToMenu() {
    setSelected(null);
  }

  const renderCalculator = () => {
    if (selected === 'density-fluence') return <DensityCalculator initialMode="fluence" />;
    if (selected === 'density-irradiance') return <DensityCalculator initialMode="irradiance" />;
    if (selected === 'duty') return <DutyCycleCalculator />;
    if (selected === 'wavelength') return <WavelengthCalculator />;
    if (selected === 'avgpower') return <AvgPowerCalculator />;
    return null;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-xl mx-auto w-full px-4 py-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Calculators</h1>
            <p className="text-sm text-[var(--text3)]">Photometry tools — ported from Android</p>
          </div>
          <Link href="/hub" className="text-sm font-medium text-[var(--gold)] hover:underline">← Back to Hub</Link>
        </div>

        {!selected && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--text3)' }}>Select a calculator</div>
            </div>

            <div className="calc-grid">
              <button onClick={() => handleSelect('density-fluence')} className="card p-5 text-center hover:border-[var(--gold)] active:scale-[0.985] transition">
                <div className="text-4xl mb-2">⚡</div>
                <div className="font-bold">Fluence</div>
                <div className="text-xs text-[var(--text3)] mt-1">Energy Density<br /><span style={{ fontWeight: 500 }}>J/cm²</span></div>
              </button>

              <button onClick={() => handleSelect('density-irradiance')} className="card p-5 text-center hover:border-[var(--gold)] active:scale-[0.985] transition">
                <div className="text-4xl mb-2">💡</div>
                <div className="font-bold">Irradiance</div>
                <div className="text-xs text-[var(--text3)] mt-1">Power Density<br /><span style={{ fontWeight: 500 }}>W/cm²</span></div>
              </button>

              <button onClick={() => handleSelect('duty')} className="card p-5 text-center hover:border-[var(--gold)] active:scale-[0.985] transition">
                <div className="text-4xl mb-2">🔄</div>
                <div className="font-bold">Duty Cycle</div>
                <div className="text-xs text-[var(--text3)] mt-1">Pulse Cycle<br /><span style={{ fontWeight: 500 }}>Pulse Width × Freq</span></div>
              </button>

              <button onClick={() => handleSelect('wavelength')} className="card p-5 text-center hover:border-[var(--gold)] active:scale-[0.985] transition">
                <div className="text-4xl mb-2">📏</div>
                <div className="font-bold">Wavelength</div>
                <div className="text-xs text-[var(--text3)] mt-1">VBeam WL<br /><span style={{ fontWeight: 500 }}>Filter method</span></div>
              </button>

              <button onClick={() => handleSelect('avgpower')} className="card p-5 text-center hover:border-[var(--gold)] active:scale-[0.985] transition">
                <div className="text-4xl mb-2">📊</div>
                <div className="font-bold">Avg Power</div>
                <div className="text-xs text-[var(--text3)] mt-1">Energy × Freq<br /><span style={{ fontWeight: 500 }}>Bidirectional</span></div>
              </button>
            </div>

            <div className="mt-8 text-xs text-center text-[var(--text3)]">
              All formulas, beam area calculations (circular/rect/square), CW/Pulsed modes and result details match the Android photometry tools 1:1.
            </div>
          </>
        )}

        {selected && (
          <>
            <button onClick={backToMenu} className="btn btn-ghost mb-4 text-sm px-0">← Back to Calculators menu</button>
            {renderCalculator()}
            <div className="mt-4 text-center">
              <Link href="/hub" className="text-xs text-[var(--text3)] hover:text-[var(--gold)]">Return to Tech Hub</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
