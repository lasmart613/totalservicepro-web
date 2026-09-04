'use client';

import { GodTableBrowser } from '@/components/god/GodTableBrowser';

export default function GodEquipmentPage() {
  return (
    <GodTableBrowser
      tableKey="equipment"
      related={['equipment_serials', 'manufacturers', 'laser_models', 'test_equipment']}
      title="Equipment"
    />
  );
}
