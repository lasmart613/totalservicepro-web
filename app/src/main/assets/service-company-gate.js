/** Offline Service Company gate — keep in sync with web/lib/roles.ts. */
function tspNormalizeRole(role) {
    return String(role || '').toLowerCase().trim();
}
function tspNormalizeOrgType(orgType) {
    return String(orgType || '').toLowerCase().trim();
}
function tspIsOwnerish(role, orgType) {
    const r = tspNormalizeRole(role);
    const t = tspNormalizeOrgType(orgType);
    if (r === 'owner' || r === 'customer') return true;
    return t === 'customer' || t === 'laser_clinic' || t === 'laser_rental' || t === 'laser_reseller';
}
function tspIsSupplier(role, orgType) {
    const r = tspNormalizeRole(role);
    const t = tspNormalizeOrgType(orgType);
    if (r === 'parts_supplier' || r === 'supplier') return true;
    return t === 'parts_supplier' || t === 'vendor';
}
function tspIsServiceCompany(role, orgType) {
    if (tspIsOwnerish(role, orgType) || tspIsSupplier(role, orgType)) return false;
    const t = tspNormalizeOrgType(orgType);
    if (t === 'service_company' || t === 'service') return true;
    const r = tspNormalizeRole(role);
    return (
        r === 'admin' ||
        r === 'company_admin' ||
        r === 'service_manager' ||
        r === 'fse' ||
        r === 'engineer' ||
        r === 'dispatcher' ||
        r === 'scheduler' ||
        r === 'billing_manager' ||
        r === 'crm'
    );
}
function tspCanAccessServiceManuals(role, orgType) {
    return tspIsServiceCompany(role, orgType);
}
function tspCanAccessRepairAi(role, orgType) {
    return tspIsServiceCompany(role, orgType);
}
function tspOrgTypeFromProfile(prof, fallback) {
    const org = prof && prof.organizations;
    if (Array.isArray(org)) return (org[0] && org[0].type) || fallback || null;
    if (org && org.type) return org.type;
    return fallback || null;
}
async function tspLoadServiceAccess(client, user) {
    if (!user) return { allowed: false, reason: 'login' };
    let role = user.user_metadata && user.user_metadata.role;
    let orgType = user.user_metadata && user.user_metadata.organization_type;
    try {
        const { data: prof } = await client
            .from('user_profiles')
            .select('role, organization_id, organizations(type)')
            .eq('id', user.id)
            .maybeSingle();
        if (prof) {
            role = prof.role || role;
            orgType = tspOrgTypeFromProfile(prof, orgType);
        }
    } catch (e) { /* keep metadata fallback */ }
    const allowed = tspCanAccessServiceManuals(role, orgType);
    return { allowed: allowed, reason: allowed ? 'ok' : 'role', role: role, orgType: orgType };
}
