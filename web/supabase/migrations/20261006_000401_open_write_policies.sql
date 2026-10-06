-- Close live permissive write policies found on pg_policies.
-- Apply after 20261006_000400_user_profiles_tenant_lockdown.sql.
-- Idempotent. Does not rewrite customer rows.
--
-- organization_manuals, service_reports, and test_equipment stay on
-- user_profiles.organization_id. 000400 revokes client UPDATE of that column.
-- organization_customers INSERT/UPDATE must also prove the customer org was
-- created by a member of the service org, or accepted from that org's invite.
-- parts_catalog_update and part_vendors DELETE are left for 20261006_000700 (#217).
-- "public insert waitlist" stays: the waitlist is a public signup.

-- ---------------------------------------------------------------------------
-- Org helpers. SECURITY INVOKER so membership RLS still applies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caller_in_org(target bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT target IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      target = public.get_my_org_id()
      OR EXISTS (
        SELECT 1
        FROM public.organization_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = target
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.caller_ticket_in_org(ticket bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.service_tickets t
    WHERE t.id = ticket
      AND public.caller_in_org(t.organization_id)
  );
$$;

REVOKE ALL ON FUNCTION public.caller_in_org(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.caller_ticket_in_org(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_in_org(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.caller_ticket_in_org(bigint) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.caller_in_org(bigint) TO service_role;
    GRANT EXECUTE ON FUNCTION public.caller_ticket_in_org(bigint) TO service_role;
  END IF;
END $$;

-- Forum counters update another author's row. They must bypass RLS, and
-- they only change counts / last-post fields.
CREATE OR REPLACE FUNCTION public.update_thread_reply_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.forum_threads
    SET reply_count = reply_count + 1,
        last_post_at = NEW.created_at,
        last_post_by = NEW.author_id
    WHERE id = NEW.thread_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.forum_threads
    SET reply_count = GREATEST(reply_count - 1, 0)
    WHERE id = OLD.thread_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reaction_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.thread_id IS NOT NULL THEN
      UPDATE public.forum_threads
      SET reaction_count = reaction_count + 1
      WHERE id = NEW.thread_id;
    ELSE
      UPDATE public.forum_posts
      SET reaction_count = reaction_count + 1
      WHERE id = NEW.post_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.thread_id IS NOT NULL THEN
      UPDATE public.forum_threads
      SET reaction_count = GREATEST(reaction_count - 1, 0)
      WHERE id = OLD.thread_id;
    ELSE
      UPDATE public.forum_posts
      SET reaction_count = GREATEST(reaction_count - 1, 0)
      WHERE id = OLD.post_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.update_thread_reply_count() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_reaction_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_thread_reply_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_reaction_count() TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.update_thread_reply_count() TO service_role;
    GRANT EXECUTE ON FUNCTION public.update_reaction_count() TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Drop the live "Allow all - <table>" policies (FOR ALL, USING true).
-- engineer_invitations must lose this or 000400's policies never apply.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'contacts',
    'engineer_invitations',
    'forum_attachments',
    'forum_bookmarks',
    'forum_categories',
    'forum_posts',
    'forum_reactions',
    'forum_threads',
    'labor_log',
    'notifications',
    'parts',
    'parts_used',
    'sites'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow all - ' || tbl, tbl);
    END IF;
  END LOOP;
END $$;

-- contacts: keep contacts_service_company_linked_manage. Stop retargeting the org.
DO $$
BEGIN
  IF to_regclass('public.contacts') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'REVOKE UPDATE (organization_id) ON TABLE public.contacts FROM PUBLIC, anon, authenticated';
END $$;

-- notifications: read and update own rows only. Inserts are service role.
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS notifications_insert_authenticated ON public.notifications';
  EXECUTE 'REVOKE INSERT, DELETE, TRUNCATE ON TABLE public.notifications FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE UPDATE (user_id) ON TABLE public.notifications FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated';
END $$;

-- parts: legacy table, no organization_id and no client reader or writer.
-- Service role only. An authenticated SELECT true would list every shop's rows.
DO $$
BEGIN
  IF to_regclass('public.parts') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE public.parts FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS parts_read_authenticated ON public.parts';
END $$;

-- labor_log and parts_used follow the ticket's organization.
DO $$
BEGIN
  IF to_regclass('public.labor_log') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.labor_log ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.labor_log FROM PUBLIC, anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.labor_log TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS labor_log_ticket_org ON public.labor_log';
    EXECUTE $policy$
      CREATE POLICY labor_log_ticket_org ON public.labor_log
        FOR ALL TO authenticated
        USING (public.caller_ticket_in_org(ticket_id))
        WITH CHECK (public.caller_ticket_in_org(ticket_id))
    $policy$;
  END IF;

  IF to_regclass('public.parts_used') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.parts_used ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.parts_used FROM PUBLIC, anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parts_used TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS parts_used_ticket_org ON public.parts_used';
    EXECUTE $policy$
      CREATE POLICY parts_used_ticket_org ON public.parts_used
        FOR ALL TO authenticated
        USING (public.caller_ticket_in_org(ticket_id))
        WITH CHECK (public.caller_ticket_in_org(ticket_id))
    $policy$;
  END IF;
END $$;

-- sites belong to an organization.
DO $$
BEGIN
  IF to_regclass('public.sites') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.sites FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sites TO authenticated';
  EXECUTE 'REVOKE UPDATE (organization_id) ON TABLE public.sites FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS sites_org_member ON public.sites';
  EXECUTE $policy$
    CREATE POLICY sites_org_member ON public.sites
      FOR ALL TO authenticated
      USING (public.caller_in_org(organization_id))
      WITH CHECK (public.caller_in_org(organization_id))
  $policy$;
END $$;

-- Forum. Categories are a shared catalog. Everything else is the author's.
DO $$
BEGIN
  IF to_regclass('public.forum_categories') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.forum_categories ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.forum_categories FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.forum_categories TO anon, authenticated';
    EXECUTE 'DROP POLICY IF EXISTS forum_categories_read ON public.forum_categories';
    EXECUTE $policy$
      CREATE POLICY forum_categories_read ON public.forum_categories
        FOR SELECT TO anon, authenticated
        USING (true)
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.forum_threads') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.forum_threads ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.forum_threads FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT ON TABLE public.forum_threads TO anon, authenticated';
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE public.forum_threads TO authenticated';
  EXECUTE 'REVOKE UPDATE (author_id) ON TABLE public.forum_threads FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS forum_threads_read ON public.forum_threads';
  EXECUTE 'DROP POLICY IF EXISTS forum_threads_write_author ON public.forum_threads';
  EXECUTE $policy$
    CREATE POLICY forum_threads_read ON public.forum_threads
      FOR SELECT TO anon, authenticated
      USING (true)
  $policy$;
  EXECUTE $policy$
    CREATE POLICY forum_threads_write_author ON public.forum_threads
      FOR ALL TO authenticated
      USING (author_id = auth.uid())
      WITH CHECK (author_id = auth.uid())
  $policy$;
END $$;

DO $$
BEGIN
  IF to_regclass('public.forum_posts') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.forum_posts FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT ON TABLE public.forum_posts TO anon, authenticated';
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE public.forum_posts TO authenticated';
  EXECUTE 'REVOKE UPDATE (author_id) ON TABLE public.forum_posts FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS forum_posts_read ON public.forum_posts';
  EXECUTE 'DROP POLICY IF EXISTS forum_posts_write_author ON public.forum_posts';
  EXECUTE $policy$
    CREATE POLICY forum_posts_read ON public.forum_posts
      FOR SELECT TO anon, authenticated
      USING (true)
  $policy$;
  EXECUTE $policy$
    CREATE POLICY forum_posts_write_author ON public.forum_posts
      FOR ALL TO authenticated
      USING (author_id = auth.uid())
      WITH CHECK (author_id = auth.uid())
  $policy$;
END $$;

DO $$
BEGIN
  IF to_regclass('public.forum_reactions') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.forum_reactions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.forum_reactions FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT ON TABLE public.forum_reactions TO anon, authenticated';
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE public.forum_reactions TO authenticated';
  EXECUTE 'REVOKE UPDATE (user_id) ON TABLE public.forum_reactions FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS forum_reactions_read ON public.forum_reactions';
  EXECUTE 'DROP POLICY IF EXISTS forum_reactions_write_author ON public.forum_reactions';
  EXECUTE $policy$
    CREATE POLICY forum_reactions_read ON public.forum_reactions
      FOR SELECT TO anon, authenticated
      USING (true)
  $policy$;
  EXECUTE $policy$
    CREATE POLICY forum_reactions_write_author ON public.forum_reactions
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid())
  $policy$;
END $$;

DO $$
BEGIN
  IF to_regclass('public.forum_bookmarks') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.forum_bookmarks ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON TABLE public.forum_bookmarks FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_bookmarks TO authenticated';
  EXECUTE 'REVOKE UPDATE (user_id) ON TABLE public.forum_bookmarks FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS forum_bookmarks_read ON public.forum_bookmarks';
  EXECUTE 'DROP POLICY IF EXISTS forum_bookmarks_write_author ON public.forum_bookmarks';
  EXECUTE $policy$
    CREATE POLICY forum_bookmarks_read ON public.forum_bookmarks
      FOR SELECT TO authenticated
      USING (user_id = auth.uid())
  $policy$;
  EXECUTE $policy$
    CREATE POLICY forum_bookmarks_write_author ON public.forum_bookmarks
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid())
  $policy$;
END $$;

DO $$
BEGIN
  IF to_regclass('public.forum_attachments') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.forum_attachments ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.forum_attachments FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT ON TABLE public.forum_attachments TO anon, authenticated';
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON TABLE public.forum_attachments TO authenticated';
  EXECUTE 'REVOKE UPDATE (uploaded_by) ON TABLE public.forum_attachments FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS forum_attachments_read ON public.forum_attachments';
  EXECUTE 'DROP POLICY IF EXISTS forum_attachments_write_author ON public.forum_attachments';
  EXECUTE $policy$
    CREATE POLICY forum_attachments_read ON public.forum_attachments
      FOR SELECT TO anon, authenticated
      USING (true)
  $policy$;
  EXECUTE $policy$
    CREATE POLICY forum_attachments_write_author ON public.forum_attachments
      FOR ALL TO authenticated
      USING (uploaded_by = auth.uid())
      WITH CHECK (uploaded_by = auth.uid())
  $policy$;
END $$;

-- Inventory writes must name the caller's location or org.
DO $$
BEGIN
  IF to_regclass('public.inventory_locations') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS locations_insert ON public.inventory_locations';
    EXECUTE 'REVOKE UPDATE (organization_id) ON TABLE public.inventory_locations FROM PUBLIC, anon, authenticated';
    EXECUTE 'REVOKE UPDATE (owner_user_id) ON TABLE public.inventory_locations FROM PUBLIC, anon, authenticated';
    EXECUTE 'DROP POLICY IF EXISTS locations_insert_own ON public.inventory_locations';
    EXECUTE $policy$
      CREATE POLICY locations_insert_own ON public.inventory_locations
        FOR INSERT TO authenticated
        WITH CHECK (
          (organization_id IS NOT NULL AND public.caller_in_org(organization_id))
          OR (organization_id IS NULL AND owner_user_id = auth.uid())
        )
    $policy$;
    EXECUTE 'DROP POLICY IF EXISTS locations_update ON public.inventory_locations';
    EXECUTE $policy$
      CREATE POLICY locations_update ON public.inventory_locations
        FOR UPDATE TO authenticated
        USING (
          (organization_id IS NOT NULL AND public.caller_in_org(organization_id))
          OR (organization_id IS NULL AND owner_user_id = auth.uid())
        )
        WITH CHECK (
          (organization_id IS NOT NULL AND public.caller_in_org(organization_id))
          OR (organization_id IS NULL AND owner_user_id = auth.uid())
        )
    $policy$;
  END IF;

  IF to_regclass('public.inventory_stock') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS stock_insert ON public.inventory_stock';
    EXECUTE 'DROP POLICY IF EXISTS stock_update ON public.inventory_stock';
    EXECUTE 'DROP POLICY IF EXISTS stock_insert_own ON public.inventory_stock';
    EXECUTE 'DROP POLICY IF EXISTS stock_update_own ON public.inventory_stock';
    EXECUTE $policy$
      CREATE POLICY stock_insert_own ON public.inventory_stock
        FOR INSERT TO authenticated
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.inventory_locations l
            WHERE l.id = inventory_stock.location_id
              AND (
                (l.organization_id IS NOT NULL AND public.caller_in_org(l.organization_id))
                OR (l.organization_id IS NULL AND l.owner_user_id = auth.uid())
              )
          )
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY stock_update_own ON public.inventory_stock
        FOR UPDATE TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.inventory_locations l
            WHERE l.id = inventory_stock.location_id
              AND (
                (l.organization_id IS NOT NULL AND public.caller_in_org(l.organization_id))
                OR (l.organization_id IS NULL AND l.owner_user_id = auth.uid())
              )
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.inventory_locations l
            WHERE l.id = inventory_stock.location_id
              AND (
                (l.organization_id IS NOT NULL AND public.caller_in_org(l.organization_id))
                OR (l.organization_id IS NULL AND l.owner_user_id = auth.uid())
              )
          )
        )
    $policy$;
  END IF;

  IF to_regclass('public.inventory_transactions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS transactions_insert ON public.inventory_transactions';
    EXECUTE 'DROP POLICY IF EXISTS transactions_read ON public.inventory_transactions';
    EXECUTE 'DROP POLICY IF EXISTS transactions_insert_own ON public.inventory_transactions';
    EXECUTE 'DROP POLICY IF EXISTS transactions_read_own ON public.inventory_transactions';
    EXECUTE $policy$
      CREATE POLICY transactions_read_own ON public.inventory_transactions
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.inventory_locations l
            WHERE l.id IN (inventory_transactions.from_location_id, inventory_transactions.to_location_id)
              AND (
                (l.organization_id IS NOT NULL AND public.caller_in_org(l.organization_id))
                OR (l.organization_id IS NULL AND l.owner_user_id = auth.uid())
              )
          )
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY transactions_insert_own ON public.inventory_transactions
        FOR INSERT TO authenticated
        WITH CHECK (
          (performed_by IS NULL OR performed_by = auth.uid())
          AND EXISTS (
            SELECT 1 FROM public.inventory_locations l
            WHERE l.id IN (inventory_transactions.from_location_id, inventory_transactions.to_location_id)
              AND (
                (l.organization_id IS NOT NULL AND public.caller_in_org(l.organization_id))
                OR (l.organization_id IS NULL AND l.owner_user_id = auth.uid())
              )
          )
        )
    $policy$;
  END IF;
END $$;

-- laser_models is a shared catalog. Clients only read it.
DO $$
BEGIN
  IF to_regclass('public.laser_models') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.laser_models ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS auth_insert_laser_models ON public.laser_models';
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can insert laser_models" ON public.laser_models';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.laser_models FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT SELECT ON TABLE public.laser_models TO anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS laser_models_read ON public.laser_models';
  EXECUTE $policy$
    CREATE POLICY laser_models_read ON public.laser_models
      FOR SELECT TO anon, authenticated
      USING (true)
  $policy$;
END $$;

-- part_vendors: public read stays. INSERT and UPDATE only on a catalog row
-- the caller created. DELETE is #217's 000700.
DO $$
BEGIN
  IF to_regclass('public.part_vendors') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS part_vendors_insert ON public.part_vendors';
  EXECUTE 'DROP POLICY IF EXISTS part_vendors_update ON public.part_vendors';
  EXECUTE 'DROP POLICY IF EXISTS part_vendors_write_owner ON public.part_vendors';
  EXECUTE 'DROP POLICY IF EXISTS part_vendors_insert_owner ON public.part_vendors';
  EXECUTE 'DROP POLICY IF EXISTS part_vendors_update_owner ON public.part_vendors';
  EXECUTE $policy$
    CREATE POLICY part_vendors_insert_owner ON public.part_vendors
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.parts_catalog p
          WHERE p.id = part_vendors.part_id
            AND p.created_by = auth.uid()
        )
      )
  $policy$;
  EXECUTE $policy$
    CREATE POLICY part_vendors_update_owner ON public.part_vendors
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.parts_catalog p
          WHERE p.id = part_vendors.part_id
            AND p.created_by = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.parts_catalog p
          WHERE p.id = part_vendors.part_id
            AND p.created_by = auth.uid()
        )
      )
  $policy$;
END $$;

-- parts_catalog insert must name the caller. UPDATE policy is #217's 000700.
DO $$
BEGIN
  IF to_regclass('public.parts_catalog') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS parts_catalog_insert ON public.parts_catalog';
  EXECUTE 'REVOKE UPDATE (created_by) ON TABLE public.parts_catalog FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS parts_catalog_insert_owner ON public.parts_catalog';
  EXECUTE $policy$
    CREATE POLICY parts_catalog_insert_owner ON public.parts_catalog
      FOR INSERT TO authenticated
      WITH CHECK (created_by = auth.uid())
  $policy$;
END $$;

-- Customer-org insert already exists with created_by = auth.uid().
-- The live policy only checked type = 'customer'.
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated can create customer orgs" ON public.organizations';
END $$;

-- A service org may link only a customer org its own member created,
-- or a customer org one of its members invited and that invite was accepted.
-- customer_organization_id cannot be retargeted.
CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(
  p_service bigint,
  p_customer bigint
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_service IS NOT NULL
    AND p_customer IS NOT NULL
    AND public.caller_in_org(p_service)
    AND (
      EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = p_customer
          AND o.created_by IS NOT NULL
          AND (
            EXISTS (
              SELECT 1
              FROM public.organization_memberships m
              WHERE m.user_id = o.created_by
                AND m.organization_id = p_service
            )
            OR EXISTS (
              SELECT 1
              FROM public.user_profiles p
              WHERE p.id = o.created_by
                AND p.organization_id = p_service
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.engineer_invitations i
        JOIN public.organization_memberships m
          ON m.user_id = i.invited_by
         AND m.organization_id = p_service
        WHERE i.organization_id = p_customer
          AND COALESCE(i.accepted, false) = true
      )
    );
$$;

REVOKE ALL ON FUNCTION public.customer_org_link_allowed(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_org_link_allowed(bigint, bigint) TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.organization_customers') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.organization_customers ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE UPDATE (customer_organization_id) ON TABLE public.organization_customers FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE UPDATE (service_organization_id) ON TABLE public.organization_customers FROM PUBLIC, anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS "Users can create customer links for their service org" ON public.organization_customers';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update their org''s customer links" ON public.organization_customers';
  EXECUTE 'DROP POLICY IF EXISTS organization_customers_insert_linked ON public.organization_customers';
  EXECUTE 'DROP POLICY IF EXISTS organization_customers_update_linked ON public.organization_customers';
  EXECUTE $policy$
    CREATE POLICY organization_customers_insert_linked ON public.organization_customers
      FOR INSERT TO authenticated
      WITH CHECK (
        public.customer_org_link_allowed(service_organization_id, customer_organization_id)
      )
  $policy$;
  EXECUTE $policy$
    CREATE POLICY organization_customers_update_linked ON public.organization_customers
      FOR UPDATE TO authenticated
      USING (public.caller_in_org(service_organization_id))
      WITH CHECK (
        public.customer_org_link_allowed(service_organization_id, customer_organization_id)
      )
  $policy$;
END $$;

-- Null organization_id must not make every signed-in user able to read
-- estimates and invoices. The created_by branch stays so the author still
-- sees a row they wrote.
DO $$
BEGIN
  IF to_regclass('public.service_estimates') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS service_estimates_member_all ON public.service_estimates';
    EXECUTE $policy$
      CREATE POLICY service_estimates_member_all ON public.service_estimates
        FOR ALL TO authenticated
        USING (
          organization_id IN (
            SELECT user_profiles.organization_id
            FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
          )
          OR created_by = auth.uid()
        )
        WITH CHECK (
          organization_id IN (
            SELECT user_profiles.organization_id
            FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
          )
          OR created_by = auth.uid()
        )
    $policy$;
  END IF;

  IF to_regclass('public.service_invoices') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS service_invoices_member_all ON public.service_invoices';
    EXECUTE $policy$
      CREATE POLICY service_invoices_member_all ON public.service_invoices
        FOR ALL TO authenticated
        USING (
          organization_id IN (
            SELECT user_profiles.organization_id
            FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
          )
          OR created_by = auth.uid()
        )
        WITH CHECK (
          organization_id IN (
            SELECT user_profiles.organization_id
            FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
          )
          OR created_by = auth.uid()
        )
    $policy$;
  END IF;
END $$;

-- Anon cannot UPDATE owner or org columns on any public table.
-- Authenticated UPDATE of created_by / organization_id / user_id stays on
-- tables whose saves send those columns (reports, listings, tickets).
-- Those tables are not in the open-policy list; their RLS is the control.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name IN (
        'created_by',
        'user_id',
        'owner_id',
        'organization_id',
        'seller_id',
        'bidder_id',
        'owner_user_id',
        'author_id',
        'uploaded_by',
        'invited_by',
        'posted_by',
        'engineer_id'
      )
  LOOP
    EXECUTE format(
      'REVOKE UPDATE (%I) ON TABLE public.%I FROM PUBLIC, anon',
      r.column_name,
      r.table_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
