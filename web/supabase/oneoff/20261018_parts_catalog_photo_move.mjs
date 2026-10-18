// One-off ship step (after migration 000927, before deploying grok-assistant/grok-tts).
// Copies the 2 parts_catalog photos from the PRIVATE equipment-photos bucket to the
// PUBLIC part-images bucket at the same path. Source objects are NOT deleted
// (rollback = revert the rows). Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node <this file>
// Then run 20261018_parts_catalog_photo_move.sql.
import { createClient } from '@supabase/supabase-js';
const PATHS = [
  'parts/0d04a116-38a8-4ba0-8738-7981e398f551/1787667473597_0.webp', // parts_catalog.id 1033
  'parts/0d04a116-38a8-4ba0-8738-7981e398f551/1789087434321_0.jpg', // parts_catalog.id 1034
];
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
for (const p of PATHS) {
  const { data, error } = await db.storage.from('equipment-photos').download(p);
  if (error) throw new Error(`download ${p}: ${error.message}`);
  const { error: upErr } = await db.storage.from('part-images').upload(p, data, { contentType: data.type, upsert: false });
  if (upErr && !/exists/i.test(upErr.message)) throw new Error(`upload ${p}: ${upErr.message}`);
  const { data: pub } = db.storage.from('part-images').getPublicUrl(p);
  const res = await fetch(pub.publicUrl, { method: 'HEAD' });
  if (!res.ok) throw new Error(`verify ${p}: HTTP ${res.status}`);
  console.log('copied', p, res.headers.get('content-length'));
}
