-- Purchase orders follow the active shop (user_profiles.organization_id),
-- same as tickets and reports. Moonlight memberships must not see POs for
-- shops the user is not currently working as.

DROP POLICY IF EXISTS purchase_orders_sending_org_all ON public.purchase_orders;
CREATE POLICY purchase_orders_sending_org_all ON public.purchase_orders
  FOR ALL TO authenticated
  USING (organization_id = public.get_my_org_id())
  WITH CHECK (organization_id = public.get_my_org_id());

NOTIFY pgrst, 'reload schema';
