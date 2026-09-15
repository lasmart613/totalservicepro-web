-- Persist Operators vs Service shelving on public.manuals.
-- Live yljztfajyvjzqikxdddf does not have manuals.doc_kind yet (20260831_*
-- never applied). ADD COLUMN is idempotent if those files are applied first.
--
-- Client shelving is catalogManualKind / inferKindFromDocumentText in
-- web/lib/manual-catalog.ts. This backfill writes doc_kind='operator' for
-- rows that classifier would mark operator (instruction / operating
-- instructions / IFU / gebruiksaanwijzing / operator|user manual / Lyra 767 /
-- bare VBeam), including verified live ids 204, 662, 712, 716, 740, 769.
--
-- Hybrids (Operator & Service / Operator / Service) and service-primary
-- titles (e.g. “Service Instruction Manual”) stay null → Service shelf.
-- Explicit keep-service ids: 131, 504, 545, 546, 547.
--
-- Apply in the Supabase SQL editor if this is not auto-applied on deploy.
-- Do not rewrite titles or PDFs.

ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS doc_kind text;

COMMENT ON COLUMN public.manuals.doc_kind IS
  'Document type: service | operator | user | technical | parts. Null means infer from title/path. Operator/IFU/instruction/operating-instructions go on Operators; hybrid Operator & Service stay service.';

UPDATE public.manuals AS m
SET doc_kind = 'operator'
FROM (
  SELECT
    id,
    doc_kind,
    title,
    regexp_replace(
      concat_ws(' ', title, brand, model, storage_path),
      'not\s+(a(n)?\s+|the\s+|full\s+)*(service\s+manuals?|sm)\y',
      ' ',
      'gi'
    ) AS identity_hay,
    regexp_replace(
      coalesce(title, ''),
      'not\s+(a(n)?\s+|the\s+|full\s+)*(service\s+manuals?|sm)\y',
      ' ',
      'gi'
    ) AS title_hay
  FROM public.manuals
) AS src
WHERE m.id = src.id
  AND (
    m.id IN (204, 662, 712, 716, 740, 769)
    OR src.identity_hay ~* '\ylyra\s*[-_/]?\s*767\y'
    OR (
      coalesce(m.doc_kind, '') NOT IN ('service', 'technical', 'parts')
      AND m.id NOT IN (131, 504, 545, 546, 547)
      AND (
        src.title_hay ~* $$operator'?s?\s+manual$$
        OR src.title_hay ~* '\yuser\s+manual\y'
        OR src.title_hay ~* '\yifu\y'
        OR src.title_hay ~* 'instructions?\s+for\s+use'
        OR src.title_hay ~* '\yoperating\s+instructions?\y'
        OR src.title_hay ~* '\y(user\s+)?instruction\s+manuals?\y'
        OR src.title_hay ~* 'gebruiksaanwijzing'
        OR regexp_replace(
          regexp_replace(trim(coalesce(src.title, '')), '^\s*syneron(\s*candela)?[\s\-:\/]*', '', 'i'),
          '^\s*candela[\s\-:\/]*',
          '',
          'i'
        ) ~* '^v[\s_-]*beam$'
      )
      AND src.title_hay !~* '\y(service|technical|repair)\s+(instruction\s+)?manuals?\y'
      AND src.title_hay !~* '\yrepair\y'
      AND src.title_hay !~* '\yoperator(''s|s)?\y\s*(/|&|and)\s*service\y'
      AND src.title_hay !~* '\yservice\y\s*(/|&|and)\s*operator(''s|s)?\y'
    )
  );
