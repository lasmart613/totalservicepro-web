-- Stop the two-step un-send that 000901 still allows.
--
-- 000901 refuses a supplier change while OLD.status = 'sent' or OLD.sent_at
-- is set, including a single PATCH that changes the supplier and the status
-- together. It still allows a signed-in user of the owning org to:
--   1. PATCH {status:'draft', sent_at:null}
--   2. PATCH {supplier_email:'anything'}
-- and then send the purchase order again.
--
-- Signed-in clients (auth.uid() is set) keep every 000901 rule:
--   * INSERT created_by must be auth.uid().
--   * UPDATE cannot change organization_id or created_by.
--   * Once OLD.status = 'sent' or OLD.sent_at IS NOT NULL, supplier_email
--     and supplier_organization_id cannot change.
--   * On INSERT, and on UPDATE of a draft that sets or changes
--     supplier_organization_id, a non-null value must reference an
--     organization whose type is parts_supplier, vendor, or supplier.
--     A null supplier organization is allowed. A draft update that leaves
--     the column unchanged does not retarget the supplier.
-- And, for the same signed-in callers:
--   * UPDATE refuses moving status off 'sent' when OLD.status = 'sent'.
--     That is step 1 of the un-send (status back to draft).
--   * UPDATE refuses clearing or changing sent_at once OLD.sent_at IS NOT NULL.
--     That is the other half of step 1. Step 2, the supplier change, stays
--     refused while the row is still sent.
--   * INSERT refuses status = 'sent' or a non-null sent_at.
-- Service role has no JWT user. auth.uid() IS NULL returns NEW, so the send
-- route's admin client can stamp status and sent_at on the first send and
-- on a re-send. An authenticated caller cannot.
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
-- This repo does not auto-apply SQL. The migration runner applies this file
-- as one transaction. Safe to re-run.

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
    IF NEW.status = 'sent' OR NEW.sent_at IS NOT NULL THEN
      RAISE EXCEPTION 'a purchase order cannot be inserted as sent'
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
    -- Step 1: un-send. Status leaving 'sent', or sent_at cleared or replaced.
    IF OLD.status = 'sent' AND NEW.status IS DISTINCT FROM 'sent' THEN
      RAISE EXCEPTION 'status cannot move off sent'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
      RAISE EXCEPTION 'sent_at cannot be cleared or changed after the purchase order is sent'
        USING ERRCODE = '42501';
    END IF;
    -- Step 2 stays refused: the row is still sent, so the supplier cannot move.
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
  -- A sent row already returned. An unchanged id on a draft is not a new target.
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
