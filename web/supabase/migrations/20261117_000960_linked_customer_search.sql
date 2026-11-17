-- 000960: shop customer search that sorts before it limits.
--
-- The ticket name box calls search_linked_customers. PostgREST
-- .order(name) on an embedded organizations row does not order the parent
-- before LIMIT, so the 12 rows were an arbitrary slice. This function
-- dedupes links, drops a null or unknown organization type, builds the same
-- name/city/state/phone/email/contact string the browser used to filter,
-- then orders and limits.
--
-- find_linked_customer_by_name is the submit check. It compares the trimmed
-- name, case-insensitive, against every link for the shop. A match stops
-- the form from inserting a second organization.
--
-- Both are SECURITY INVOKER. Row security on organization_customers,
-- organizations, and contacts still applies to the caller.
--
-- The query text is a function argument. It is not pasted into a PostgREST
-- or() filter, so quotes and colons stay in the term. ILIKE wildcards in
-- the term are escaped.
--
-- Does not change rows. Safe to re-run. The migration runner applies this
-- file as one transaction.
--
-- No new index. The typed prefilter uses the same directory parser as the
-- resolver, so a contact name in any role, a flat map, or a JSON string is
-- not dropped. On scratch Postgres 16 with 4,607 links, EXPLAIN ANALYZE of
-- search_linked_customers is 125 ms for a typed name and 122 ms for another
-- typed name. That is slower than the earlier 17 ms prefilter, which missed
-- those names. A blank query does not call the prefilter. 000959 is not shipped.
-- Repo only. Do not apply this file to production from the pull request.
-- Never use orgs 4, 153, 154, 1005, 2616, 5509, or 5515.
--
-- Rollback: 20261117_000960_linked_customer_search_rollback.sql

SET LOCAL lock_timeout = '5s';

-- Same directory parse the resolver uses: a JSON string, a {roles, primaryRole}
-- object, or a flat role map. The search prefilter calls this so it cannot
-- miss a layout the resolver accepts.
CREATE OR REPLACE FUNCTION public.normalize_linked_directory(p_directory jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_dir jsonb := p_directory;
BEGIN
  IF jsonb_typeof(v_dir) = 'string' THEN
    BEGIN
      v_dir := (v_dir #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      v_dir := NULL;
    END;
  END IF;
  IF jsonb_typeof(v_dir) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_dir -> 'roles') = 'object' THEN
    RETURN jsonb_build_object(
      'roles', v_dir -> 'roles',
      'primaryRole', v_dir ->> 'primaryRole'
    );
  END IF;
  RETURN jsonb_build_object(
    'roles', v_dir,
    'primaryRole', coalesce(v_dir ->> 'primaryRole', v_dir ->> 'primary_role')
  );
END;
$fn$;

COMMENT ON FUNCTION public.normalize_linked_directory(jsonb) IS
  '000960: directory_contacts as {roles, primaryRole}. Accepts a JSON string, a nested roles object, or a flat role map.';

REVOKE ALL ON FUNCTION public.normalize_linked_directory(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_linked_directory(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_linked_customer_contact(
  p_contact_name text,
  p_office_email text,
  p_office_phone text,
  p_directory jsonb,
  p_contacts jsonb
)
RETURNS TABLE (
  contact text,
  phone text,
  email text,
  contact_role text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_roles jsonb;
  v_keys text[] := ARRAY['owner', 'medical_director', 'physician', 'laser_technician', 'office_manager'];
  v_labels text[] := ARRAY['Owner', 'Medical Director', 'Physician', 'Laser Technician', 'Office Manager'];
  v_key text;
  v_label text;
  v_i int;
  v_role jsonb;
  v_first text;
  v_last text;
  v_name text;
  v_email text;
  v_phone text;
  v_filled boolean;
  v_any_filled boolean := false;
  v_primary text;
  v_chosen text;
  v_row jsonb;
  v_title text;
  v_title_key text;
  v_norm jsonb;
  v_office_email text := btrim(coalesce(p_office_email, ''));
  v_office_phone text := btrim(coalesce(p_office_phone, ''));
  v_legacy text := btrim(coalesce(p_contact_name, ''));
BEGIN
  v_norm := public.normalize_linked_directory(p_directory);
  IF v_norm IS NULL THEN
    v_roles := NULL;
    v_primary := NULL;
  ELSE
    v_roles := v_norm -> 'roles';
    v_primary := v_norm ->> 'primaryRole';
  END IF;

  -- Prefer a filled directory_contacts role. Otherwise take the same role
  -- off a contacts row (title = role label), which is what the browser does
  -- when the JSON is empty.
  IF v_roles IS NOT NULL THEN
    FOR v_i IN 1..array_length(v_keys, 1) LOOP
      v_role := v_roles -> v_keys[v_i];
      IF jsonb_typeof(v_role) = 'object' AND (
        btrim(coalesce(v_role ->> 'first_name', '')) <> ''
        OR btrim(coalesce(v_role ->> 'last_name', '')) <> ''
        OR btrim(coalesce(v_role ->> 'name', '')) <> ''
        OR btrim(coalesce(v_role ->> 'email', '')) <> ''
        OR btrim(coalesce(v_role ->> 'phone', '')) <> ''
      ) THEN
        v_any_filled := true;
      END IF;
    END LOOP;
  END IF;

  IF NOT v_any_filled AND jsonb_typeof(p_contacts) = 'array' THEN
    v_roles := '{}'::jsonb;
    v_primary := NULL;
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
      v_title := btrim(coalesce(v_row ->> 'title', ''));
      v_title_key := lower(regexp_replace(v_title, '[\s-]+', '_', 'g'));
      v_i := array_position(v_keys, v_title_key);
      IF v_i IS NULL THEN
        v_i := array_position(v_labels, v_title);
      END IF;
      IF v_i IS NULL THEN
        CONTINUE;
      END IF;
      v_key := v_keys[v_i];
      IF v_roles ? v_key THEN
        CONTINUE;
      END IF;
      v_first := btrim(coalesce(v_row ->> 'first_name', ''));
      v_last := btrim(coalesce(v_row ->> 'last_name', ''));
      IF lower(v_first) = lower(v_labels[v_i]) AND v_last = '' THEN
        v_first := '';
      ELSIF v_last = '' AND v_first ~ '\s' THEN
        v_last := btrim(regexp_replace(v_first, '^\S+\s*', ''));
        v_first := split_part(v_first, ' ', 1);
      END IF;
      IF v_first = '' AND v_last = '' AND btrim(coalesce(v_row ->> 'email', '')) = ''
         AND btrim(coalesce(v_row ->> 'phone', '')) = '' THEN
        CONTINUE;
      END IF;
      v_roles := v_roles || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'first_name', v_first,
          'last_name', v_last,
          'email', btrim(coalesce(v_row ->> 'email', '')),
          'phone', btrim(coalesce(v_row ->> 'phone', ''))
        )
      );
      IF coalesce((v_row ->> 'is_primary')::boolean, false) AND v_primary IS NULL THEN
        v_primary := v_key;
      END IF;
      v_any_filled := true;
    END LOOP;
  END IF;

  v_chosen := NULL;
  IF v_any_filled AND v_primary IS NOT NULL AND v_primary = ANY (v_keys) THEN
    v_role := v_roles -> v_primary;
    IF jsonb_typeof(v_role) = 'object' AND (
      btrim(coalesce(v_role ->> 'first_name', '')) <> ''
      OR btrim(coalesce(v_role ->> 'last_name', '')) <> ''
      OR btrim(coalesce(v_role ->> 'name', '')) <> ''
      OR btrim(coalesce(v_role ->> 'email', '')) <> ''
      OR btrim(coalesce(v_role ->> 'phone', '')) <> ''
    ) THEN
      v_chosen := v_primary;
    END IF;
  END IF;
  IF v_chosen IS NULL AND v_any_filled THEN
    FOR v_i IN 1..array_length(v_keys, 1) LOOP
      v_role := v_roles -> v_keys[v_i];
      IF jsonb_typeof(v_role) = 'object' AND (
        btrim(coalesce(v_role ->> 'first_name', '')) <> ''
        OR btrim(coalesce(v_role ->> 'last_name', '')) <> ''
        OR btrim(coalesce(v_role ->> 'name', '')) <> ''
        OR btrim(coalesce(v_role ->> 'email', '')) <> ''
        OR btrim(coalesce(v_role ->> 'phone', '')) <> ''
      ) THEN
        v_chosen := v_keys[v_i];
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_chosen IS NOT NULL THEN
    v_role := v_roles -> v_chosen;
    v_i := array_position(v_keys, v_chosen);
    v_label := v_labels[v_i];
    v_first := btrim(coalesce(v_role ->> 'first_name', ''));
    v_last := btrim(coalesce(v_role ->> 'last_name', ''));
    IF v_first = '' AND v_last = '' THEN
      v_name := btrim(coalesce(v_role ->> 'name', ''));
    ELSE
      v_name := btrim(concat_ws(' ', nullif(v_first, ''), nullif(v_last, '')));
    END IF;
    v_email := btrim(coalesce(v_role ->> 'email', ''));
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      v_email := CASE
        WHEN v_office_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN v_office_email
        ELSE ''
      END;
    END IF;
    v_phone := btrim(coalesce(v_role ->> 'phone', ''));
    IF v_phone = '' THEN
      v_phone := v_office_phone;
    END IF;
    contact := v_name;
    phone := nullif(v_phone, '');
    email := nullif(v_email, '');
    contact_role := v_label;
    RETURN NEXT;
    RETURN;
  END IF;

  IF jsonb_typeof(p_contacts) = 'array' THEN
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
      IF NOT coalesce((v_row ->> 'is_primary')::boolean, false) THEN
        CONTINUE;
      END IF;
      IF btrim(coalesce(v_row ->> 'email', '')) = ''
         AND btrim(coalesce(v_row ->> 'phone', '')) = ''
         AND btrim(coalesce(v_row ->> 'first_name', '')) = ''
         AND btrim(coalesce(v_row ->> 'last_name', '')) = ''
         AND btrim(coalesce(v_row ->> 'name', '')) = '' THEN
        CONTINUE;
      END IF;
      v_title := btrim(coalesce(v_row ->> 'title', ''));
      v_title_key := lower(regexp_replace(v_title, '[\s-]+', '_', 'g'));
      IF v_title_key = ANY (v_keys) OR v_title = ANY (v_labels) THEN
        CONTINUE;
      END IF;
      v_first := btrim(coalesce(v_row ->> 'first_name', ''));
      v_last := btrim(coalesce(v_row ->> 'last_name', ''));
      v_name := btrim(concat_ws(' ', nullif(v_first, ''), nullif(v_last, '')));
      IF v_name = '' THEN
        v_name := btrim(coalesce(v_row ->> 'name', ''));
      END IF;
      v_email := btrim(coalesce(v_row ->> 'email', ''));
      IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        v_email := CASE
          WHEN v_office_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN v_office_email
          ELSE ''
        END;
      END IF;
      v_phone := btrim(coalesce(v_row ->> 'phone', ''));
      IF v_phone = '' THEN
        v_phone := v_office_phone;
      END IF;
      contact := v_name;
      phone := nullif(v_phone, '');
      email := nullif(v_email, '');
      contact_role := nullif(v_title, '');
      RETURN NEXT;
      RETURN;
    END LOOP;
  END IF;

  IF v_legacy <> '' THEN
    contact := v_legacy;
    phone := nullif(v_office_phone, '');
    email := CASE
      WHEN v_office_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN v_office_email
      ELSE NULL
    END;
    contact_role := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_office_email <> '' OR v_office_phone <> '' THEN
    contact := '';
    phone := nullif(v_office_phone, '');
    email := CASE
      WHEN v_office_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN v_office_email
      ELSE NULL
    END;
    contact_role := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  contact := '';
  phone := NULL;
  email := NULL;
  contact_role := NULL;
  RETURN NEXT;
END;
$fn$;

COMMENT ON FUNCTION public.resolve_linked_customer_contact(text, text, text, jsonb, jsonb) IS
  '000960: the contact, phone, and email the customer dropdown shows. Same order as the browser: directory role, then a primary contacts row, then contact_name, then the office phone and email.';

REVOKE ALL ON FUNCTION public.resolve_linked_customer_contact(text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_linked_customer_contact(text, text, text, jsonb, jsonb) TO authenticated, service_role;

-- Superset of the final haystack. It starts with the same name / city /
-- state / resolved phone / resolved email / resolved contact the match uses,
-- then every role field (including name on every role) from the shared
-- directory parser, then every contacts row. A row the final match keeps
-- cannot fail this filter.
CREATE OR REPLACE FUNCTION public.linked_customer_prefilter_text(
  p_name text,
  p_city text,
  p_state text,
  p_contact_name text,
  p_office_email text,
  p_office_phone text,
  p_directory jsonb,
  p_contacts jsonb
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT concat_ws(
    ' ',
    nullif(btrim(coalesce(p_name, '')), ''),
    CASE WHEN p_city IS NOT NULL AND p_city <> '' THEN p_city END,
    CASE WHEN p_state IS NOT NULL AND p_state <> '' THEN p_state END,
    nullif(btrim(coalesce(r.phone, '')), ''),
    nullif(btrim(coalesce(COALESCE(NULLIF(btrim(r.email), ''), p_office_email), '')), ''),
    nullif(btrim(coalesce(r.contact, '')), ''),
    (
      SELECT string_agg(
        concat_ws(
          ' ',
          nullif(btrim(coalesce(role.value ->> 'first_name', '')), ''),
          nullif(btrim(coalesce(role.value ->> 'last_name', '')), ''),
          nullif(btrim(coalesce(role.value ->> 'name', '')), ''),
          nullif(btrim(coalesce(role.value ->> 'email', '')), ''),
          nullif(btrim(coalesce(role.value ->> 'phone', '')), '')
        ),
        ' '
      )
      FROM jsonb_each(coalesce(public.normalize_linked_directory(p_directory) -> 'roles', '{}'::jsonb)) AS role(key, value)
      WHERE role.key IN ('owner', 'medical_director', 'physician', 'laser_technician', 'office_manager')
        AND jsonb_typeof(role.value) = 'object'
    ),
    (
      SELECT string_agg(
        concat_ws(
          ' ',
          nullif(btrim(coalesce(c.value ->> 'first_name', '')), ''),
          nullif(btrim(coalesce(c.value ->> 'last_name', '')), ''),
          nullif(btrim(coalesce(c.value ->> 'phone', '')), ''),
          nullif(btrim(coalesce(c.value ->> 'email', '')), ''),
          nullif(btrim(coalesce(c.value ->> 'title', '')), '')
        ),
        ' '
      )
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_contacts) = 'array' THEN p_contacts ELSE '[]'::jsonb END) AS c(value)
    )
  )
  FROM public.resolve_linked_customer_contact(
    p_contact_name,
    p_office_email,
    p_office_phone,
    p_directory,
    p_contacts
  ) r;
$fn$;

COMMENT ON FUNCTION public.linked_customer_prefilter_text(text, text, text, text, text, text, jsonb, jsonb) IS
  '000960: search prefilter. Starts with the resolved haystack, then every directory role field and contact row, so it is a superset of the final match.';

REVOKE ALL ON FUNCTION public.linked_customer_prefilter_text(text, text, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.linked_customer_prefilter_text(text, text, text, text, text, text, jsonb, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_linked_customers(
  p_service_org_id bigint,
  p_query text,
  p_sort text DEFAULT 'name',
  p_limit integer DEFAULT 12
)
RETURNS TABLE (
  id bigint,
  name text,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  email text,
  contact text,
  contact_role text,
  office_phone text,
  linked_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_query text := left(btrim(coalesce(p_query, '')), 80);
  v_pattern text;
BEGIN
  IF v_query = '' THEN
    -- Newest links first. Resolve the contact only for the rows we return.
    RETURN QUERY
    WITH ranked AS (
      SELECT oc.customer_organization_id, max(oc.created_at) AS created_at
      FROM public.organization_customers oc
      WHERE oc.service_organization_id = p_service_org_id
      GROUP BY oc.customer_organization_id
    ),
    picked AS (
      SELECT r.customer_organization_id, r.created_at
      FROM ranked r
      JOIN public.organizations o ON o.id = r.customer_organization_id
      WHERE o.type IS NOT NULL
        AND lower(btrim(o.type)) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
        AND btrim(coalesce(o.name, '')) <> ''
      ORDER BY r.created_at DESC NULLS LAST, lower(btrim(o.name)) ASC, o.id ASC
      LIMIT v_limit
    )
    SELECT
      o.id,
      btrim(o.name),
      o.address,
      o.city,
      o.state,
      o.zip,
      c.phone,
      COALESCE(NULLIF(btrim(c.email), ''), o.email),
      c.contact,
      c.contact_role,
      o.phone,
      p.created_at
    FROM picked p
    JOIN public.organizations o ON o.id = p.customer_organization_id
    CROSS JOIN LATERAL public.resolve_linked_customer_contact(
      o.contact_name,
      o.email,
      o.phone,
      o.directory_contacts,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', ct.first_name,
          'last_name', ct.last_name,
          'title', ct.title,
          'phone', ct.phone,
          'email', ct.email,
          'is_primary', ct.is_primary
        ))
        FROM public.contacts ct
        WHERE ct.organization_id = o.id
      )
    ) c
    ORDER BY p.created_at DESC NULLS LAST, lower(btrim(o.name)) ASC, o.id ASC;
    RETURN;
  END IF;

  v_pattern := '%' || replace(replace(replace(lower(v_query), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%';

  -- Prefilter text starts with the resolved haystack, then every role field
  -- from the shared directory parser. The precise haystack match, A-to-Z,
  -- and the limit run after that.
  RETURN QUERY
  WITH deduped AS (
    SELECT DISTINCT ON (oc.customer_organization_id)
      oc.customer_organization_id,
      oc.created_at
    FROM public.organization_customers oc
    WHERE oc.service_organization_id = p_service_org_id
    ORDER BY oc.customer_organization_id, oc.created_at DESC NULLS LAST
  ),
  linked AS (
    SELECT
      d.customer_organization_id,
      d.created_at,
      o.name AS org_name,
      o.address,
      o.city,
      o.state,
      o.zip,
      o.phone AS office_phone,
      o.email AS office_email,
      o.contact_name,
      o.directory_contacts,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', c.first_name,
          'last_name', c.last_name,
          'title', c.title,
          'phone', c.phone,
          'email', c.email,
          'is_primary', c.is_primary
        ))
        FROM public.contacts c
        WHERE c.organization_id = o.id
      ) AS contact_rows
    FROM deduped d
    JOIN public.organizations o ON o.id = d.customer_organization_id
    WHERE o.type IS NOT NULL
      AND lower(btrim(o.type)) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
      AND btrim(coalesce(o.name, '')) <> ''
  ),
  candidates AS (
    SELECT *
    FROM linked t
    WHERE lower(public.linked_customer_prefilter_text(
      t.org_name,
      t.city,
      t.state,
      t.contact_name,
      t.office_email,
      t.office_phone,
      t.directory_contacts,
      t.contact_rows
    )) LIKE v_pattern ESCAPE chr(92)
  ),
  resolved AS (
    SELECT
      t.customer_organization_id,
      t.created_at,
      btrim(t.org_name) AS org_name,
      t.address,
      t.city,
      t.state,
      t.zip,
      t.office_phone,
      COALESCE(NULLIF(btrim(r.email), ''), t.office_email) AS shown_email,
      r.contact,
      r.phone,
      r.contact_role,
      array_to_string(ARRAY[
        nullif(btrim(t.org_name), ''),
        CASE WHEN t.city IS NOT NULL AND t.city <> '' THEN t.city END,
        CASE WHEN t.state IS NOT NULL AND t.state <> '' THEN t.state END,
        nullif(btrim(coalesce(r.phone, '')), ''),
        nullif(btrim(coalesce(COALESCE(NULLIF(btrim(r.email), ''), t.office_email), '')), ''),
        nullif(btrim(coalesce(r.contact, '')), '')
      ], ' ') AS haystack
    FROM candidates t
    CROSS JOIN LATERAL public.resolve_linked_customer_contact(
      t.contact_name,
      t.office_email,
      t.office_phone,
      t.directory_contacts,
      t.contact_rows
    ) r
  )
  SELECT
    m.customer_organization_id,
    m.org_name,
    m.address,
    m.city,
    m.state,
    m.zip,
    m.phone,
    m.shown_email,
    m.contact,
    m.contact_role,
    m.office_phone,
    m.created_at
  FROM resolved m
  WHERE lower(m.haystack) LIKE v_pattern ESCAPE chr(92)
  ORDER BY lower(m.org_name) ASC, m.org_name ASC, m.customer_organization_id ASC
  LIMIT v_limit;
END;
$fn$;

COMMENT ON FUNCTION public.search_linked_customers(bigint, text, text, integer) IS
  '000960: up to p_limit linked customers for one shop. Blank query is newest link first. A typed query keeps punctuation, escapes ILIKE wildcards, matches the combined name/city/state/phone/email/contact string, and sorts A to Z before the limit. Null organization types are excluded. Duplicate links collapse to the newest.';

REVOKE ALL ON FUNCTION public.search_linked_customers(bigint, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_linked_customers(bigint, text, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.find_linked_customer_by_name(
  p_service_org_id bigint,
  p_name text
)
RETURNS TABLE (
  id bigint,
  name text,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  email text,
  contact text,
  contact_role text,
  office_phone text,
  linked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH deduped AS (
    SELECT DISTINCT ON (oc.customer_organization_id)
      oc.customer_organization_id,
      oc.created_at
    FROM public.organization_customers oc
    WHERE oc.service_organization_id = p_service_org_id
    ORDER BY oc.customer_organization_id, oc.created_at DESC NULLS LAST
  ),
  hit AS (
    SELECT
      d.customer_organization_id,
      d.created_at,
      o.name AS org_name,
      o.address,
      o.city,
      o.state,
      o.zip,
      o.phone AS office_phone,
      o.email AS office_email,
      o.contact_name,
      o.directory_contacts,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'first_name', c.first_name,
          'last_name', c.last_name,
          'title', c.title,
          'phone', c.phone,
          'email', c.email,
          'is_primary', c.is_primary
        ))
        FROM public.contacts c
        WHERE c.organization_id = o.id
      ) AS contact_rows
    FROM deduped d
    JOIN public.organizations o ON o.id = d.customer_organization_id
    WHERE btrim(coalesce(p_name, '')) <> ''
      AND o.type IS NOT NULL
      AND lower(btrim(o.type)) IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
      AND lower(btrim(o.name)) = lower(btrim(p_name))
    ORDER BY d.created_at DESC NULLS LAST, o.id ASC
    LIMIT 1
  )
  SELECT
    h.customer_organization_id,
    btrim(h.org_name),
    h.address,
    h.city,
    h.state,
    h.zip,
    r.phone,
    COALESCE(NULLIF(btrim(r.email), ''), h.office_email),
    r.contact,
    r.contact_role,
    h.office_phone,
    h.created_at
  FROM hit h
  CROSS JOIN LATERAL public.resolve_linked_customer_contact(
    h.contact_name,
    h.office_email,
    h.office_phone,
    h.directory_contacts,
    h.contact_rows
  ) r;
$fn$;

COMMENT ON FUNCTION public.find_linked_customer_by_name(bigint, text) IS
  '000960: one linked customer whose trimmed name equals p_name, ignoring case. Looks at every link for the shop, not the 12 suggestions. No row means the name is not already linked.';

REVOKE ALL ON FUNCTION public.find_linked_customer_by_name(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_linked_customer_by_name(bigint, text) TO authenticated, service_role;
