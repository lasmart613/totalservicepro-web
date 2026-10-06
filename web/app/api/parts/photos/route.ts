import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  PART_IMAGE_BUCKET,
  PART_PHOTO_MAX_BYTES,
  PART_PHOTO_MAX_FILES,
  PART_PHOTO_USER_STORED_MAX,
  livePartPhotoQuotaState,
  partPhotoContentType,
  partPhotoPath,
  partPhotoQuotaAllows,
  partPhotoStoredAllows,
  partPhotoUserPrefix,
  recordPartPhotoQuota,
} from '@/lib/part-photo-upload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UPLOAD_ERROR = "Couldn't upload this photo.";

async function callerId(req: NextRequest): Promise<string | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  return user?.id || null;
}

export async function POST(req: NextRequest) {
  const userId = await callerId(req);
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!hasServiceRole()) {
    console.error('[part-photos] service role unavailable');
    return NextResponse.json({ error: UPLOAD_ERROR }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const files = (form ? form.getAll('file') : []).filter((item): item is File => item instanceof File);
  if (!files.length) return NextResponse.json({ error: 'Choose a photo.' }, { status: 400 });
  if (files.length > PART_PHOTO_MAX_FILES) {
    return NextResponse.json(
      { error: `Upload up to ${PART_PHOTO_MAX_FILES} photos at a time.` },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();
  const organizationId = profile?.organization_id ?? null;
  const quota = partPhotoQuotaAllows(livePartPhotoQuotaState, {
    userId,
    organizationId,
    files: files.length,
  });
  if (!quota.ok) return NextResponse.json({ error: quota.error }, { status: 429 });

  const { data: stored, error: listError } = await admin.storage
    .from(PART_IMAGE_BUCKET)
    .list(partPhotoUserPrefix(userId), { limit: PART_PHOTO_USER_STORED_MAX });
  if (listError) {
    console.error('[part-photos] list', listError.message);
    return NextResponse.json({ error: UPLOAD_ERROR }, { status: 503 });
  }
  const storedQuota = partPhotoStoredAllows(stored?.length || 0, files.length);
  if (!storedQuota.ok) return NextResponse.json({ error: storedQuota.error }, { status: 429 });
  const urls: string[] = [];
  const now = Date.now();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > PART_PHOTO_MAX_BYTES) {
      return NextResponse.json({ error: `${file.name} is over 5 MB` }, { status: 400 });
    }
    const contentType = partPhotoContentType(file.name, file.type || '');
    if (!contentType) {
      return NextResponse.json({ error: `${file.name} is not an image` }, { status: 400 });
    }
    const path = partPhotoPath(userId, i, file.name, now);
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await admin.storage.from(PART_IMAGE_BUCKET).upload(path, buffer, {
      contentType,
      upsert: false,
    });
    if (error) {
      console.error('[part-photos]', path, contentType, error.message);
      return NextResponse.json({ error: UPLOAD_ERROR }, { status: 502 });
    }
    const { data } = admin.storage.from(PART_IMAGE_BUCKET).getPublicUrl(path);
    if (data?.publicUrl) urls.push(data.publicUrl);
  }

  if (urls.length) {
    recordPartPhotoQuota(livePartPhotoQuotaState, {
      userId,
      organizationId,
      files: urls.length,
    });
  }

  return NextResponse.json({ urls });
}
