'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveCatalog } from './equipment-dropdown.ts';
import {
  changeEquipmentType,
  changeManufacturer,
  changeModel,
  emptyCascade,
  hydrateCascade,
  manufacturerChoicesForType,
  modelChoicesFor,
  resolveCascade,
  type CascadeState,
} from './equipment-cascade.ts';
import { DEFAULT_EQUIPMENT_TYPE, type EquipmentType } from './equipment-types.ts';

type HydrateInput = { equipmentType?: unknown; manufacturer?: string | null; model?: string | null };

export type EquipmentCascade = ReturnType<typeof useEquipmentCascade>;

/** One hook for every Equipment type → Manufacturer → Model form. */
export function useEquipmentCascade(catalog: LiveCatalog, initialType: EquipmentType = DEFAULT_EQUIPMENT_TYPE) {
  const [state, setState] = useState<CascadeState>(() => emptyCascade(initialType));
  const manufacturerChoices = useMemo(
    () => manufacturerChoicesForType(catalog, state.equipmentType),
    [catalog.manufacturers, catalog.models, state.equipmentType]
  );
  const modelChoices = useMemo(
    () => modelChoicesFor(catalog, state.equipmentType, state.manufacturer),
    [catalog.manufacturers, catalog.models, state.equipmentType, state.manufacturer]
  );
  // Saved values loaded before the live catalog arrives are re-matched once it
  // does, unless the user has already edited the pickers.
  const pendingSaved = useRef<HydrateInput | null>(null);
  const touch = () => {
    pendingSaved.current = null;
  };
  const setEquipmentType = useCallback((next: unknown) => {
    touch();
    setState((s) => changeEquipmentType(s, next));
  }, []);
  const setManufacturer = useCallback((next: string) => {
    touch();
    setState((s) => changeManufacturer(s, next));
  }, []);
  const setModel = useCallback((next: string) => {
    touch();
    setState((s) => changeModel(s, next));
  }, []);
  const setCustomManufacturer = useCallback(
    (v: string) => {
      touch();
      setState((s) => ({ ...s, customManufacturer: v }));
    },
    []
  );
  const setCustomModel = useCallback((v: string) => {
    touch();
    setState((s) => ({ ...s, customModel: v }));
  }, []);
  const hydrate = useCallback(
    (saved: HydrateInput) => {
      pendingSaved.current = saved;
      setState(hydrateCascade(catalog, saved));
    },
    [catalog.manufacturers, catalog.models]
  );
  useEffect(() => {
    if (pendingSaved.current) setState(hydrateCascade(catalog, pendingSaved.current));
  }, [catalog.manufacturers, catalog.models]);
  const reset = useCallback((type?: EquipmentType) => {
    touch();
    setState(emptyCascade(type));
  }, []);
  return {
    state,
    manufacturerChoices,
    modelChoices,
    setEquipmentType,
    setManufacturer,
    setModel,
    setCustomManufacturer,
    setCustomModel,
    hydrate,
    reset,
    resolved: resolveCascade(state),
  };
}
