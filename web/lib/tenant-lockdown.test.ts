import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideSwitch } from './org-membership.ts';
import {
  authorizeInviteAccept,
  authorizeSelfOrgAttach,
  decideFounderLink,
  decideMemberRoleChange,
  signupAssignsTenant,
} from './tenant-lockdown.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('cross-org founder link is refused; own org gets a derived role, never platform admin', () => {
  const stolen = decideFounderLink({
    callerId: 'user-a',
    orgCreatedBy: 'user-b',
    orgType: 'service_company',
  });
  assert.equal(stolen.ok, false);
  if (stolen.ok) return;
  assert.equal(stolen.status, 403);

  const own = decideFounderLink({
    callerId: 'user-a',
    orgCreatedBy: 'user-a',
    orgType: 'service_company',
  });
  assert.equal(own.ok, true);
  if (!own.ok) return;
  assert.equal(own.role, 'company_admin');

  const clinic = decideFounderLink({
    callerId: 'user-a',
    orgCreatedBy: 'user-a',
    orgType: 'laser_clinic',
  });
  assert.equal(clinic.ok, true);
  if (!clinic.ok) return;
  assert.equal(clinic.role, 'owner');
  assert.notEqual(clinic.role, 'admin');
});

test('self-attach refuses a cross-tenant join and allows an unaccepted invite', () => {
  const refused = authorizeSelfOrgAttach({
    createdByCaller: false,
    alreadyMember: false,
    hasUnacceptedInvite: false,
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.status, 403);
  assert.match(refused.error, /were not invited/);

  const invited = authorizeSelfOrgAttach({
    createdByCaller: false,
    alreadyMember: false,
    hasUnacceptedInvite: true,
  });
  assert.equal(invited.ok, true);
});

test('invite accept requires the caller auth email and returns the invitation role', () => {
  const mismatch = authorizeInviteAccept({
    callerEmail: 'attacker@example.com',
    inviteEmail: 'engineer@example.com',
    inviteOrgId: 44,
    inviteRole: 'fse',
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.status, 403);

  const accepted = authorizeInviteAccept({
    callerEmail: 'Engineer@Example.com',
    inviteEmail: 'engineer@example.com',
    inviteOrgId: 44,
    inviteRole: 'dispatcher',
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.organizationId, 44);
  assert.equal(accepted.role, 'dispatcher');
});

test('switch to an org without a membership is refused', () => {
  const refused = decideSwitch({
    targetOrgId: 99,
    memberships: [{ organizationId: 4, role: 'fse', isHome: true }],
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.match(refused.error, /not a member/i);

  const allowed = decideSwitch({
    targetOrgId: 4,
    memberships: [{ organizationId: 4, role: 'fse', isHome: true }],
  });
  assert.equal(allowed.ok, true);
  if (!allowed.ok) return;
  assert.equal(allowed.role, 'fse');
});

test('role change refuses escalation and platform admin; same-org equal rank is allowed', () => {
  const cross = decideMemberRoleChange({
    callerRole: 'company_admin',
    targetRole: 'fse',
    sameOrganization: false,
  });
  assert.equal(cross.ok, false);

  const escalate = decideMemberRoleChange({
    callerRole: 'company_admin',
    targetRole: 'admin',
    sameOrganization: true,
  });
  assert.equal(escalate.ok, false);
  if (escalate.ok) return;
  assert.match(escalate.error, /platform admin|above your own/i);

  const above = decideMemberRoleChange({
    callerRole: 'owner',
    targetRole: 'company_admin',
    sameOrganization: true,
  });
  assert.equal(above.ok, false);

  const staff = decideMemberRoleChange({
    callerRole: 'fse',
    targetRole: 'viewer',
    sameOrganization: true,
  });
  assert.equal(staff.ok, false);

  const ok = decideMemberRoleChange({
    callerRole: 'company_admin',
    targetRole: 'service_manager',
    sameOrganization: true,
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.role, 'service_manager');

  const platform = decideMemberRoleChange({
    callerRole: 'admin',
    targetRole: 'admin',
    sameOrganization: true,
  });
  assert.equal(platform.ok, false);
  if (platform.ok) return;
  assert.match(platform.error, /memberships cannot use the platform admin role/i);
});

test('email signup rejects an organization or role in the body', () => {
  assert.equal(signupAssignsTenant({ email: 'a@b.co', role: 'admin' }), true);
  assert.equal(signupAssignsTenant({ organization_id: 4 }), true);
  assert.equal(signupAssignsTenant({ activeOrganizationId: '9' }), true);
  assert.equal(signupAssignsTenant({ email: 'a@b.co', firstName: 'A' }), false);
  assert.equal(signupAssignsTenant({ role: '  ' }), false);
});

test('migration revokes tenant columns and the trigger raises instead of downgrading', () => {
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261006_000400_user_profiles_tenant_lockdown.sql'),
    'utf8'
  );
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.user_profiles FROM authenticated/);
  assert.match(sql, /GRANT UPDATE \(%s\) ON TABLE public\.user_profiles TO authenticated/);
  assert.doesNotMatch(sql, /'organization_id', 'active_organization_id', 'role'/);
  assert.match(sql, /RAISE EXCEPTION 'cannot self-assign an elevated role'/);
  assert.match(
    sql,
    /RAISE EXCEPTION 'cannot join an organization you did not create, are not a member of, and were not invited to'/
  );
  assert.match(sql, /RAISE EXCEPTION 'active_organization_id must reference an existing membership'/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.user_profiles/);
  assert.match(
    sql,
    /NEW\.role := CASE\s+WHEN TG_OP = 'UPDATE' AND lower\(btrim\(OLD\.role\)\) = 'admin' THEN 'admin'\s+ELSE grant_role/
  );
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /current_user NOT IN \('authenticated', 'anon'\)/);
  assert.match(sql, /FROM PUBLIC, anon/);
  assert.match(sql, /email_confirmed_at IS NOT NULL/);
  assert.match(sql, /DROP TRIGGER IF EXISTS on_auth_user_created ON auth\.users/);
  assert.doesNotMatch(sql, /CREATE TRIGGER on_auth_user_created/);
  assert.match(sql, /organization_memberships_role_not_platform_admin/);
  assert.match(sql, /ALTER FUNCTION public\.generate_ticket_number\(bigint\) SET search_path/);
  assert.match(sql, /ALTER FUNCTION public\.handle_new_user\(\) SET search_path/);
  assert.match(sql, /ALTER FUNCTION public\.set_organization_created_by\(\) SET search_path/);
  assert.match(sql, /generate_ticket_number\(uuid\) already has search_path public/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.leave_organization\(p_organization_id bigint\)/);
  assert.match(sql, /'left_organization_id', p_organization_id/);
  assert.match(sql, /'account_kept', true/);
  assert.match(sql, /lower\(btrim\(kept_role\)\) = 'admin' THEN\s+next_role := 'admin'/);
  assert.match(sql, /profile_role_from_membership\(next_mem\.role\)/);
  assert.match(sql, /invitation_is_open\(i\.accepted, i\.expires_at, i\.created_at\)/);
  assert.doesNotMatch(sql, /NOT IN \('admin', 'company_admin'\)/);
  assert.match(sql, /invitation_is_open/);
  assert.match(sql, /profile_role_from_membership/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.engineer_invitations FROM anon/);
  assert.match(sql, /GRANT INSERT \(%s\) ON TABLE public\.organizations TO authenticated/);
  const orgGrantCols = sql.slice(sql.indexOf('insert_cols text[]'), sql.indexOf('present_ins text[]'));
  assert.match(orgGrantCols, /'timezone'/);
  assert.doesNotMatch(orgGrantCols, /is_premium|premium_until|premium_grant|subscription_tier|'plan'/);
  assert.match(sql, /organization_memberships admin -> company_admin/);
});

test('server routes call the authorizers and do not trust a client role on founder link', () => {
  const founder = readFileSync(join(here, '../app/api/org/founder/route.ts'), 'utf8');
  const claim = readFileSync(join(here, '../app/api/team/claim/route.ts'), 'utf8');
  const role = readFileSync(join(here, '../app/api/org/members/role/route.ts'), 'utf8');
  const signup = readFileSync(join(here, '../app/api/auth/signup/route.ts'), 'utf8');
  const company = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  const adminTeam = readFileSync(join(here, '../app/admin/team/page.tsx'), 'utf8');
  assert.match(founder, /decideFounderLink/);
  assert.match(founder, /hasServiceRole/);
  assert.doesNotMatch(founder, /body\.role/);
  assert.ok(
    founder.indexOf('const decision = decideFounderLink') <
      founder.indexOf('applyComplimentarySignupFields(patch'),
    'complimentary premium runs only after the caller is the org creator'
  );
  assert.match(founder, /priorPremium/);
  assert.match(claim, /authorizeInviteAccept/);
  assert.match(role, /decideMemberRoleChange/);
  assert.match(signup, /signupAssignsTenant/);
  assert.match(company, /postMemberRole/);
  assert.match(adminTeam, /postMemberRole/);
});

test('open write policies replace catalog update and freeze identity columns', () => {
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261006_000401_open_write_policies.sql'),
    'utf8'
  );
  assert.match(sql, /DROP POLICY IF EXISTS %I ON public\.%I', 'Allow all - ' \|\| tbl, tbl/);
  assert.match(sql, /'engineer_invitations'/);
  assert.match(sql, /notifications_insert_authenticated/);
  assert.match(sql, /forum_threads_write_author/);
  assert.match(sql, /author_id = auth\.uid\(\)/);
  assert.match(sql, /labor_log_ticket_org/);
  assert.match(sql, /parts_used_ticket_org/);
  assert.match(sql, /sites_org_member/);
  assert.match(sql, /parts_catalog_insert_owner/);
  assert.match(sql, /created_by = auth\.uid\(\)/);
  assert.match(sql, /Authenticated can create customer orgs/);
  assert.match(sql, /laser_models_read/);
  assert.match(sql, /DROP POLICY IF EXISTS parts_catalog_update ON public\.parts_catalog/);
  assert.match(sql, /CREATE POLICY parts_catalog_update_owner/);
  assert.match(sql, /lower\(admin_m\.role\) IN \('admin', 'company_admin'\)/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS "public insert waitlist"/);
  assert.match(sql, /REVOKE UPDATE \(%I\) ON TABLE public\.%I FROM PUBLIC, anon/);
  assert.match(sql, /REVOKE UPDATE ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /guard_tenant_owner_cols/);
  assert.match(sql, /current_user NOT IN \('authenticated', 'anon'\)/);
  assert.match(sql, /get_my_org_id\(\)/);
  assert.match(sql, /laser_clinic/);
  assert.match(sql, /customer_org_link_allowed/);
  assert.match(sql, /organization_customers_insert_linked/);
  assert.match(sql, /forum_bookmarks_read/);
  assert.match(sql, /user_id = auth\.uid\(\)/);
  assert.match(sql, /part_vendors_insert_owner/);
  assert.match(sql, /part_vendors_update_owner/);
  assert.doesNotMatch(sql, /CREATE POLICY part_vendors_write_owner/);
  assert.doesNotMatch(sql, /GRANT SELECT ON TABLE public\.parts TO authenticated/);
  const estimateRules = sql.slice(sql.indexOf('Null organization_id must not'));
  assert.match(estimateRules, /organization_id = public\.get_my_org_id\(\)/);
  assert.match(estimateRules, /organization_id IS NULL AND created_by = auth\.uid\(\)/);
  assert.doesNotMatch(estimateRules, /OR created_by = auth\.uid\(\)/);

  const invite = readFileSync(join(here, '../app/api/team/invite/route.ts'), 'utf8');
  assert.doesNotMatch(invite, /userClient\.from\('engineer_invitations'\)\.insert/);
  assert.match(invite, /missing service role/);

  const award = readFileSync(join(here, 'award.ts'), 'utf8');
  const notify = readFileSync(join(here, '../app/api/marketplace/award-notify/route.ts'), 'utf8');
  const assignee = readFileSync(join(here, '../app/api/tickets/notify-assignee/route.ts'), 'utf8');
  assert.match(award, /\/api\/marketplace\/award-notify/);
  assert.doesNotMatch(award, /from\('notifications'\)\.insert/);
  assert.match(notify, /hasServiceRole/);
  assert.match(notify, /posted_by/);
  assert.match(notify, /created_by/);
  assert.match(assignee, /getSupabaseAdmin\(\)\.from\('notifications'\)\.insert/);
  assert.doesNotMatch(assignee, /writer\.from\('notifications'\)\.insert/);
});

test('cross-tenant audit file is SELECT only', () => {
  const audit = readFileSync(
    join(here, '../supabase/audits/20261006_cross_tenant_membership_audit.sql'),
    'utf8'
  );
  const stripped = audit.replace(/--.*$/gm, '');
  assert.match(stripped, /\bSELECT\b/);
  assert.doesNotMatch(stripped, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/i);
  assert.match(audit, /membership_role/);
  assert.match(audit, /profile_role/);
  assert.match(audit, /engineer_invitations/);
});
