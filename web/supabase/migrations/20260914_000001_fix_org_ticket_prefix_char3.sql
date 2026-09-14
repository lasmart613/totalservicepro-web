-- P0: live BEFORE INSERT trigger trg_org_ticket_prefix / set_org_ticket_prefix
-- overflowed organizations.ticket_prefix character(3).
--
-- Live function (confirmed on Total Service Pro):
--   base := first 3 letters of name
--   on collision: LEFT(base, 2) || counter   -- SH1 … SH9, then SH10 (4 chars)
-- Assignment of SH10 raises 22001; shop signup dies after Auth email verify.
--
-- KEEP organizations.ticket_prefix character(3). Do not widen.
--
-- New uniqueness scheme (always exactly 3 [0-9A-Z]):
--   1. Mnemonic: first 3 letters of name (pad 1–2 letter names with X; else TSP)
--   2. If taken: stem (2 letters) + 0-9 then A-Z  → SH0–SH9, SHA–SHZ
--   3. If those 36 are taken: MD5-derived 3-char codes until unique
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI). This repo does not auto-apply SQL.
-- Escalate only that SQL apply after merge — do not mutate production org rows.

CREATE OR REPLACE FUNCTION public.set_org_ticket_prefix()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
    alphabet CONSTANT text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    letters text;
    mnemonic text;
    stem text;
    candidate text;
    i int;
    j int;
    hash text;
    idx int;
BEGIN
    letters := UPPER(REGEXP_REPLACE(COALESCE(NEW.name, ''), '[^a-zA-Z]', '', 'g'));
    IF length(letters) >= 3 THEN
        mnemonic := LEFT(letters, 3);
    ELSIF length(letters) = 2 THEN
        mnemonic := letters || 'X';
    ELSIF length(letters) = 1 THEN
        mnemonic := letters || 'XX';
    ELSE
        mnemonic := 'TSP';
    END IF;

    candidate := mnemonic;
    IF NOT EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE rtrim(o.ticket_prefix) = candidate
          AND o.id IS DISTINCT FROM NEW.id
    ) THEN
        NEW.ticket_prefix := candidate;
        RETURN NEW;
    END IF;

    stem := LEFT(mnemonic, 2);
    FOR i IN 1..length(alphabet) LOOP
        candidate := stem || SUBSTR(alphabet, i, 1);
        IF char_length(candidate) <> 3 THEN
            RAISE EXCEPTION 'ticket_prefix candidate % is not 3 characters', candidate;
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM public.organizations o
            WHERE rtrim(o.ticket_prefix) = candidate
              AND o.id IS DISTINCT FROM NEW.id
        ) THEN
            NEW.ticket_prefix := candidate;
            RETURN NEW;
        END IF;
    END LOOP;

    FOR i IN 1..64 LOOP
        hash := md5(COALESCE(NEW.name, '') || '|' || COALESCE(NEW.id::text, '') || '|' || i::text);
        candidate := '';
        FOR j IN 0..2 LOOP
            idx := (get_byte(decode(hash, 'hex'), j) % 36) + 1;
            candidate := candidate || SUBSTR(alphabet, idx, 1);
        END LOOP;
        IF char_length(candidate) <> 3 THEN
            RAISE EXCEPTION 'ticket_prefix candidate % is not 3 characters', candidate;
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM public.organizations o
            WHERE rtrim(o.ticket_prefix) = candidate
              AND o.id IS DISTINCT FROM NEW.id
        ) THEN
            NEW.ticket_prefix := candidate;
            RETURN NEW;
        END IF;
    END LOOP;

    RAISE EXCEPTION 'Could not allocate a unique 3-character ticket_prefix'
        USING ERRCODE = '23505';
END;
$function$;

COMMENT ON FUNCTION public.set_org_ticket_prefix() IS
  'BEFORE INSERT: assign organizations.ticket_prefix as unique char(3). '
  'Mnemonic (3 letters), then stem+0-9A-Z, then MD5 3-char pool. Never emits length > 3.';

-- Recreate the existing insert trigger unchanged (NULL prefix only).
DROP TRIGGER IF EXISTS trg_org_ticket_prefix ON public.organizations;
CREATE TRIGGER trg_org_ticket_prefix
  BEFORE INSERT ON public.organizations
  FOR EACH ROW
  WHEN (NEW.ticket_prefix IS NULL)
  EXECUTE FUNCTION public.set_org_ticket_prefix();

-- Self-check: suffix construction never exceeds char(3). Does not touch org rows.
DO $$
DECLARE
  alphabet CONSTANT text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  stem text := 'SH';
  candidate text;
  i int;
BEGIN
  IF char_length(stem || 10::text) <> 4 THEN
    RAISE EXCEPTION 'sanity: expected leftover SH10 pattern to be 4 characters';
  END IF;
  FOR i IN 1..length(alphabet) LOOP
    candidate := stem || SUBSTR(alphabet, i, 1);
    IF char_length(candidate) <> 3 THEN
      RAISE EXCEPTION 'ticket_prefix suffix % is not 3 characters', candidate;
    END IF;
  END LOOP;
END $$;
