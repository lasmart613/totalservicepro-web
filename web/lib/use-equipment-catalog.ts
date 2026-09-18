'use client';

import { useEffect, useState } from 'react';
import {
  fetchEquipmentCatalog,
  type CatalogManufacturer,
  type CatalogModel,
} from './equipment-dropdown.ts';

type CatalogClient = {
  from: (table: string) => any;
};

export function useEquipmentCatalog(supabase: CatalogClient): {
  manufacturers: CatalogManufacturer[];
  models: CatalogModel[];
  loaded: boolean;
} {
  const [manufacturers, setManufacturers] = useState<CatalogManufacturer[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cat = await fetchEquipmentCatalog(supabase);
      if (cancelled) return;
      setManufacturers(cat.manufacturers);
      setModels(cat.models);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return { manufacturers, models, loaded };
}
