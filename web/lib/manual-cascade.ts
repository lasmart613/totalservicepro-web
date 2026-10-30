/**
 * Cascading manual-library filters: room → subtype → brand → model search,
 * with doc type available at every level. Each option carries a count and
 * zero-count options are hidden, so a user can never pick into an empty list.
 * Multi-select within a level is an OR; levels AND together.
 *
 * State lives in the URL (repeated params) so a filtered view is shareable:
 *   ?room=imaging&room=lasers&sub=ct&make=GE&doc=service&model=lightspeed
 * Legacy ?room=<equipment type> and single ?make= links keep working.
 */

import {
  MANUAL_DOC_TYPES,
  MANUAL_ROOMS,
  classifyManualRoom,
  isManualDocTypeId,
  isManualRoomId,
  isManualSubtypeId,
  manualDocType,
  manualSubtypeRoom,
  roomForEquipmentType,
  type ManualDocTypeId,
  type ManualRoomFields,
  type ManualRoomId,
} from './manual-rooms.ts';
import { normalizeManualSearchText } from './manual-search-text.ts';

export type CascadeRow = ManualRoomFields & { doc_kind?: string | null; id?: string | number | null };

export type ManualCascadeState = {
  rooms: ManualRoomId[];
  subtypes: string[];
  brands: string[];
  docs: ManualDocTypeId[];
  model: string;
};

export const EMPTY_CASCADE: ManualCascadeState = { rooms: [], subtypes: [], brands: [], docs: [], model: '' };

export type CascadeOption<T extends string = string> = { id: T; label: string; count: number; room?: ManualRoomId };

export type ManualCascadeView<R> = {
  state: ManualCascadeState;
  rooms: CascadeOption<ManualRoomId>[];
  subtypes: CascadeOption[];
  brands: CascadeOption[];
  docs: CascadeOption<ManualDocTypeId>[];
  results: R[];
  /** Total before any cascade level (after upstream search/language/shelf filters). */
  total: number;
};

type Annotated<R> = { row: R; room: ManualRoomId; subtype: string; brandKey: string; brand: string; doc: ManualDocTypeId };

const cache = new WeakMap<object, { room: ManualRoomId; subtype: string; doc: ManualDocTypeId }>();

export function annotateRow<R extends CascadeRow>(row: R): Annotated<R> {
  let hit = cache.get(row as object);
  if (!hit) {
    const p = classifyManualRoom(row);
    hit = { room: p.room, subtype: p.subtype, doc: manualDocType(row) };
    cache.set(row as object, hit);
  }
  const brand = String(row.brand || '').trim() || 'Other';
  return { row, room: hit.room, subtype: hit.subtype, doc: hit.doc, brand, brandKey: brand.toLowerCase() };
}

function modelTokens(model: string): string[] {
  return normalizeManualSearchText(String(model || ''))
    .split(/\s+/)
    .filter(Boolean);
}

function matchesModel<R extends CascadeRow>(a: Annotated<R>, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const hay = normalizeManualSearchText([a.row.model, a.row.title].map((s) => String(s || '')).join(' '));
  const squashed = hay.replace(/\s+/g, '');
  return tokens.every((t) => hay.includes(t) || squashed.includes(t.replace(/\s+/g, '')));
}

function tally<K extends string>(items: Iterable<K>): Map<K, number> {
  const m = new Map<K, number>();
  for (const k of items) m.set(k, (m.get(k) || 0) + 1);
  return m;
}

/**
 * Compute every level's options and the result list. Selections that no
 * longer have matches (e.g. a brand after the room changed) are pruned
 * from the returned state so the caller can write the clean state back.
 */
export function computeManualCascade<R extends CascadeRow>(rows: R[], input: ManualCascadeState): ManualCascadeView<R> {
  const all = rows.map((r) => annotateRow(r));
  const docSet = new Set(input.docs);

  // Doc type applies at every level, but its own counts ignore itself.
  const docOk = (a: Annotated<R>) => !docSet.size || docSet.has(a.doc);

  // Level 1: rooms (counts after doc).
  const lvl1 = all.filter(docOk);
  const roomCounts = tally(lvl1.map((a) => a.room));
  const rooms = input.rooms.filter((r) => (roomCounts.get(r) || 0) > 0);
  const roomSet = new Set(rooms);
  const afterRoom = roomSet.size ? lvl1.filter((a) => roomSet.has(a.room)) : lvl1;

  // Level 2: subtypes — only under selected rooms.
  const subCounts = tally(afterRoom.map((a) => a.subtype));
  const subtypes = roomSet.size
    ? input.subtypes.filter((s) => roomSet.has(manualSubtypeRoom(s) as ManualRoomId) && (subCounts.get(s) || 0) > 0)
    : [];
  // A subtype narrows only its own room; other selected rooms stay whole.
  const subRooms = new Set(subtypes.map((s) => manualSubtypeRoom(s)));
  const subSet = new Set(subtypes);
  const afterSub = afterRoom.filter((a) => !subRooms.has(a.room) || subSet.has(a.subtype));

  // Level 3: brands present in the current selection.
  const brandCounts = new Map<string, { label: string; count: number }>();
  for (const a of afterSub) {
    const cur = brandCounts.get(a.brandKey);
    if (cur) cur.count += 1;
    else brandCounts.set(a.brandKey, { label: a.brand, count: 1 });
  }
  const brands = dedupe(input.brands.map((b) => b.trim()).filter((b) => brandCounts.has(b.toLowerCase())));
  const brandSet = new Set(brands.map((b) => b.toLowerCase()));
  const afterBrand = brandSet.size ? afterSub.filter((a) => brandSet.has(a.brandKey)) : afterSub;

  // Level 4: model search.
  const tokens = modelTokens(input.model);
  const results = afterBrand.filter((a) => matchesModel(a, tokens));

  // Doc counts: everything except the doc filter itself.
  const docBase = all.filter(
    (a) =>
      (!roomSet.size || roomSet.has(a.room)) &&
      (!subRooms.has(a.room) || subSet.has(a.subtype)) &&
      (!brandSet.size || brandSet.has(a.brandKey)) &&
      matchesModel(a, tokens)
  );
  const docCounts = tally(docBase.map((a) => a.doc));
  const docs = input.docs.filter((d) => (docCounts.get(d) || 0) > 0);

  const roomOpts: CascadeOption<ManualRoomId>[] = MANUAL_ROOMS.filter((r) => (roomCounts.get(r.id) || 0) > 0).map(
    (r) => ({ id: r.id, label: r.label, count: roomCounts.get(r.id) || 0 })
  );
  const subOpts: CascadeOption[] = [];
  if (roomSet.size) {
    for (const r of MANUAL_ROOMS) {
      if (!roomSet.has(r.id)) continue;
      for (const s of r.subtypes) {
        const n = subCounts.get(s.id) || 0;
        if (n > 0) subOpts.push({ id: s.id, label: s.label, count: n, room: r.id });
      }
    }
  }
  const brandOpts: CascadeOption[] = [...brandCounts.values()]
    .map((b) => ({ id: b.label, label: b.label, count: b.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const docOpts: CascadeOption<ManualDocTypeId>[] = MANUAL_DOC_TYPES.filter((d) => (docCounts.get(d.id) || 0) > 0).map(
    (d) => ({ id: d.id, label: d.label, count: docCounts.get(d.id) || 0 })
  );

  return {
    state: { rooms, subtypes, brands, docs, model: input.model },
    rooms: roomOpts,
    subtypes: subOpts,
    brands: brandOpts,
    docs: docOpts,
    results: results.map((a) => a.row),
    total: all.length,
  };
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Toggle one id in a multi-select level. Clearing a room also drops its subtypes. */
export function toggleCascade(state: ManualCascadeState, level: 'room' | 'subtype' | 'brand' | 'doc', id: string): ManualCascadeState {
  const flip = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  if (level === 'room') {
    if (!isManualRoomId(id)) return state;
    const rooms = flip(state.rooms, id);
    return { ...state, rooms, subtypes: state.subtypes.filter((s) => rooms.includes(manualSubtypeRoom(s) as ManualRoomId)) };
  }
  if (level === 'subtype') return isManualSubtypeId(id) ? { ...state, subtypes: flip(state.subtypes, id) } : state;
  if (level === 'brand') {
    const has = state.brands.some((b) => b.toLowerCase() === id.toLowerCase());
    return { ...state, brands: has ? state.brands.filter((b) => b.toLowerCase() !== id.toLowerCase()) : [...state.brands, id] };
  }
  return isManualDocTypeId(id) ? { ...state, docs: flip(state.docs, id) } : state;
}

export function cascadeActive(state: ManualCascadeState): boolean {
  return Boolean(state.rooms.length || state.subtypes.length || state.brands.length || state.docs.length || state.model.trim());
}

function splitAll(qs: URLSearchParams, key: string): string[] {
  return qs
    .getAll(key)
    .flatMap((v) => (key === 'make' ? [v] : v.split(',')))
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Parse cascade state from a query string. Legacy equipment-type rooms map to the new rooms. */
export function parseManualCascadeParams(search: string): ManualCascadeState {
  const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rooms: ManualRoomId[] = [];
  const subtypes: string[] = [];
  for (const raw of splitAll(qs, 'room')) {
    const v = raw.toLowerCase();
    if (v === 'all') continue;
    if (isManualRoomId(v)) {
      if (!rooms.includes(v)) rooms.push(v);
      continue;
    }
    const legacy = roomForEquipmentType(v);
    if (legacy) {
      if (!rooms.includes(legacy.room)) rooms.push(legacy.room);
      // Old single-type rooms that are now a subtype (c_arm → Imaging / Fluoro).
      if (legacy.subtype && legacy.room !== 'lasers' && !subtypes.includes(legacy.subtype)) subtypes.push(legacy.subtype);
    }
  }
  for (const raw of splitAll(qs, 'sub')) {
    const v = raw.toLowerCase();
    const room = manualSubtypeRoom(v);
    if (!room || subtypes.includes(v)) continue;
    subtypes.push(v);
    if (!rooms.includes(room)) rooms.push(room);
  }
  const brands = dedupe(splitAll(qs, 'make'));
  const docs = splitAll(qs, 'doc')
    .map((d) => d.toLowerCase())
    .filter(isManualDocTypeId)
    .filter((d, i, a) => a.indexOf(d) === i);
  const model = String(qs.get('model') || '')
    .replace(/[^\p{L}\p{N}\s._/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return { rooms, subtypes, brands, docs, model };
}

/** Write cascade state into an existing URLSearchParams (replacing room/sub/make/doc/model). */
export function writeManualCascadeParams(qs: URLSearchParams, state: ManualCascadeState): URLSearchParams {
  for (const k of ['room', 'sub', 'make', 'doc', 'model']) qs.delete(k);
  for (const r of state.rooms) qs.append('room', r);
  for (const s of state.subtypes) qs.append('sub', s);
  for (const b of state.brands) qs.append('make', b);
  for (const d of state.docs) qs.append('doc', d);
  if (state.model.trim()) qs.set('model', state.model.trim());
  return qs;
}
