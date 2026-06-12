/**
 * Zod schemas for Total Service Pro web forms.
 * Used with react-hook-form for validation on critical fields.
 * Dynamic model forms still rely on runtime MODELS for most perf/param fields.
 */

import { z } from 'zod';

export const reportBaseSchema = z.object({
  reportNum: z.string().optional(),
  custName: z.string().min(1, 'Customer name required'),
  custAddress: z.string().optional(),
  custCity: z.string().optional(),
  custState: z.string().optional(),
  equipName: z.string().min(1, 'Equipment name required'),
  serialNum: z.string().optional(),
  dateOut: z.string().min(1, 'Service date required'),
  nextPm: z.string().optional(),
  engineer: z.string().optional(),
  ticketNum: z.string().optional(),
  comments: z.string().optional(),
  groundRes: z.coerce.number().optional(),
  leakageCur: z.coerce.number().optional(),
});

export type ReportBaseForm = z.infer<typeof reportBaseSchema>;

// For full dynamic report we use partial validation + runtime checks in collect/save.
// Add more granular schemas for performance rows etc if needed in future.
