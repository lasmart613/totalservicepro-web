-- Lock a purchase order's supplier after it is sent, and keep the sending
-- shop and creator on the row that was inserted.
--
-- Signed-in clients (auth.uid() is set):
--   * INSERT created_by must be auth.uid().
--   * UPDATE cannot change organization_id or created_by.
--   * Once OLD.status = 'sent' or OLD.sent_at IS NOT NULL, supplier_email
--     and supplier_organization_id cannot change. Changing status or
--     sent_at alone is allowed, including the send route's stamp when it
--     runs with the caller's JWT.
--   * On INSERT, and on UPDATE of a draft that sets or changes
--     supplier_organization_id, a non-null value must reference an
--     organization whose type is parts_supplier, vendor, or supplier.
--     Those are the supplier types the purchase-order form, the send route,
--     and the parts vendor picker accept. A null supplier organization is
--     allowed (email-only drafts). A draft update that leaves the column
--     unchanged is the send route stamping status and sent_at with the
--     caller's JWT, including when it also writes the mailbox it used.
--     That stamp does not retarget the supplier, so it is not rejected.
-- Service role has no JWT user. auth.uid() IS NULL returns NEW.
--
-- guard_tenant_owner_cols does not fit this table. It allows organization_id
-- to move to any org the caller belongs to, and it bypasses when
-- current_user is not authenticated/anon rather than when auth.uid() is
-- null. Purchase-order RLS is get_my_org_id(), not a membership check, so
-- attaching that trigger would reject shops the policy still allows.
-- organization_id and created_by are checked in this function instead.
-- This file does not create guard_tenant_owner_cols on purchase_orders.
--
-- Anon SELECT is blocked by RLS. purchase_orders enables row security, and
-- the only policy in migrations is purchase_orders_sending_org_all FOR ALL
-- TO authenticated (organization_id = get_my_org_id()). No policy applies
-- to anon, so anon reads no rows even if a table SELECT grant exists.
-- This migration does not revoke anon SELECT.
--
-- APPLY ON LIVE SUPABASE (SQL editor or CLI) after review.
-- This repo does not auto-apply SQL. Safe to re-run.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.purchase_orders_guard_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  supplier_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by must be the signed-in user'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'organization_id cannot be changed'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'created_by cannot be changed'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'sent' OR OLD.sent_at IS NOT NULL THEN
      IF NEW.supplier_email IS DISTINCT FROM OLD.supplier_email
         OR NEW.supplier_organization_id IS DISTINCT FROM OLD.supplier_organization_id THEN
        RAISE EXCEPTION 'supplier cannot be changed after the purchase order is sent'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  -- INSERT, and UPDATE of a draft that sets supplier_organization_id.
  -- A sent row already returned. An unchanged id on a draft is the send
  -- stamp (status / sent_at, and supplier_email set to the same mailbox).
  IF NEW.supplier_organization_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.supplier_organization_id IS DISTINCT FROM OLD.supplier_organization_id
     ) THEN
    SELECT lower(btrim(coalesce(o.type, '')))
      INTO supplier_type
    FROM public.organizations AS o
    WHERE o.id = NEW.supplier_organization_id;

    IF supplier_type IS NULL
       OR supplier_type NOT IN ('parts_supplier', 'vendor', 'supplier') THEN
      RAISE EXCEPTION 'supplier_organization_id must reference a parts supplier'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_orders_guard_supplier() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purchase_orders_guard_supplier() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS purchase_orders_guard_supplier ON public.purchase_orders;
CREATE TRIGGER purchase_orders_guard_supplier
  BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_orders_guard_supplier();

NOTIFY pgrst, 'reload schema';
