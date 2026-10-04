import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPEN_SERVICE_REQUEST_COLUMNS,
  PRIVATE_SHOP_FIELDS,
  canReadShopRecord,
  equipmentPhotoDisplayUrl,
  refuseForeignShopRead,
  shopRecordForMember,
  storageObjectFromPublicUrl,
} from './org-scoped-read.ts';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '../supabase/migrations/20261002_000001_org_member_shop_reads.sql'),
  'utf8'
);

const job = {
  id: 9,
  organization_id: 22,
  customer_name: 'Other Clinic',
  customer_email: 'desk@other.test',
  serial_number: 'SN-SECRET',
  photo_url: 'https://cdn.example/equipment-photos/equipment/22/laser.jpg',
  logo_url: 'https://cdn.example/logos/22/logo.png',
  notes: 'private notes',
};

test('a non-member cannot read another organization job, equipment, or photo', () => {
  assert.equal(
    canReadShopRecord({ membershipOrgIds: [7], recordOrganizationId: 22 }),
    false
  );
  assert.equal(canReadShopRecord({ membershipOrgIds: [], recordOrganizationId: 22 }), false);
  assert.equal(shopRecordForMember(job, [7]), null);

  const equipment = { id: 3, customer_organization_id: 22, serial_number: 'SN-SECRET', photo_url: job.photo_url };
  assert.equal(shopRecordForMember(equipment, [7], 'customer_organization_id'), null);

  const refused = refuseForeignShopRead();
  assert.equal(refused.status, 404);
  assert.deepEqual(refused.body, { error: 'Not found' });
  const encoded = JSON.stringify(refused);
  for (const field of PRIVATE_SHOP_FIELDS) {
    assert.equal(encoded.includes(field), false, field);
  }
  assert.equal(encoded.includes('Other Clinic'), false);
  assert.equal(encoded.includes('SN-SECRET'), false);
  assert.equal(encoded.includes('desk@other.test'), false);
});

test('membership orgs can read that shop, including a second moonlight shop', () => {
  assert.equal(canReadShopRecord({ membershipOrgIds: [7, '22'], recordOrganizationId: 22 }), true);
  const visible = shopRecordForMember(job, [22]);
  assert.equal(visible?.customer_name, 'Other Clinic');
  assert.equal(shopRecordForMember(job, []), null);
});

test('profile email is not treated as organization membership', () => {
  assert.doesNotMatch(migration, /user_profiles\.email\s*=/);
  assert.doesNotMatch(migration, /FROM public\.user_profiles/);
  assert.match(migration, /Ignores user_profiles\.email/);
  assert.match(migration, /m\.user_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /GOD_ADMIN|isGodIdentity|god_allow/i);
  assert.doesNotMatch(migration, /marketplace_listings|marketplace-images|stripe/i);
});

test('equipment, jobs, and photos are membership reads and the open select is removed', () => {
  assert.match(migration, /DROP POLICY IF EXISTS equipment_authenticated_select ON public\.equipment/);
  assert.match(
    migration,
    /CREATE POLICY equipment_member_select ON public\.equipment[\s\S]*auth_member_of_org\(customer_organization_id\)/
  );
  assert.doesNotMatch(
    migration,
    /CREATE POLICY equipment_authenticated_select[\s\S]{0,120}USING \(true\)/
  );
  assert.match(migration, /CREATE POLICY service_tickets_member_select[\s\S]*auth_member_of_org\(organization_id\)/);
  assert.match(migration, /SET public = false/);
  assert.match(migration, /WHERE id = 'equipment-photos'/);
  assert.match(migration, /DROP POLICY IF EXISTS equipment_photos_public_read ON storage\.objects/);
  assert.match(
    migration,
    /CREATE POLICY equipment_photos_member_read ON storage\.objects[\s\S]*auth_member_of_org\(public\.storage_org_id_from_name\(name\)\)/
  );
  assert.doesNotMatch(
    migration,
    /CREATE POLICY equipment_photos_public_read[\s\S]{0,80}USING \(bucket_id = 'equipment-photos'\)/
  );
});

test('logo list is not the whole bucket; published directory and storefront listings stay', () => {
  assert.match(migration, /DROP POLICY IF EXISTS logos_public_read ON storage\.objects/);
  assert.match(migration, /logo_object_readable\(name\)/);
  assert.match(migration, /list_in_directory/);
  assert.match(migration, /storefront_enabled/);
  assert.doesNotMatch(
    migration,
    /CREATE POLICY logos_public_read[\s\S]{0,80}USING \(bucket_id = 'logos'\)/
  );
  assert.match(migration, /organizations_member_select/);
  assert.match(migration, /organizations_published_select/);
  assert.match(migration, /organizations_storefront_select/);
});

test('open bid list omits another shop equipment, photos, serials, contacts, and logos', () => {
  const wanted = migration.slice(
    migration.indexOf("wanted text[] :="),
    migration.indexOf('];', migration.indexOf("wanted text[] :="))
  );
  for (const hidden of ['images', 'equipment_id', 'photo_url', 'logo_url', 'facility_contact', 'provider_contact', 'serial_number', 'posted_by', 'created_by']) {
    assert.equal(wanted.includes(`'${hidden}'`), false, hidden);
  }
  assert.match(wanted, /'title'/);
  assert.match(wanted, /'manufacturer'/);
  assert.match(migration, /status IN \(''open'', ''bidding''\)/);
  assert.match(migration, /security_invoker = false/);

  for (const hidden of ['images', 'equipment_id', 'photo_url', 'logo_url', 'facility_contact', 'serial_number']) {
    assert.equal(OPEN_SERVICE_REQUEST_COLUMNS.includes(hidden), false, hidden);
  }
});

test('full service_request rows are limited to members, posters, and the winning bidder', () => {
  assert.match(migration, /DROP POLICY IF EXISTS "Authenticated can view open service_requests"/);
  assert.match(migration, /CREATE POLICY "Members read own service_requests"/);
  const policy = migration.slice(
    migration.indexOf('CREATE POLICY "Members read own service_requests"'),
    migration.indexOf('DROP POLICY IF EXISTS "Owners manage own service_requests"')
  );
  assert.match(policy, /auth_member_of_org\(organization_id\)/);
  assert.match(policy, /created_by = auth\.uid\(\)/);
  assert.match(policy, /posted_by = auth\.uid\(\)/);
  assert.match(policy, /user_is_winning_bidder\(id\)/);
  assert.doesNotMatch(policy, /status IN \('open', 'bidding'\)/);
});

test('bid screens read the open list instead of every shop request', () => {
  const requests = readFileSync(join(here, '../app/service-requests/page.tsx'), 'utf8');
  const detail = readFileSync(join(here, '../app/marketplace/requests/[id]/page.tsx'), 'utf8');
  const home = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  const bids = readFileSync(join(here, '../app/bids/page.tsx'), 'utf8');
  assert.match(requests, /from\('open_service_requests'\)/);
  assert.match(requests, /OPEN_SERVICE_REQUEST_COLUMNS/);
  assert.match(requests, /Do not fall back to select \*/);
  assert.match(detail, /from\('open_service_requests'\)/);
  assert.match(home, /from\('open_service_requests'\)/);
  assert.match(bids, /from\('open_service_requests'\)/);
  assert.doesNotMatch(
    bids,
    /from\('service_requests'\)[\s\S]{0,180}select\('id, title, description, urgency, manufacturer, model, status'\)/
  );
});

test('ticket notify refusal does not return the other shop ticket', () => {
  const route = readFileSync(join(here, '../app/api/tickets/notify-assignee/route.ts'), 'utf8');
  assert.match(route, /refuseForeignShopRead\(\)/);
  assert.match(route, /NextResponse\.json\(refused\.body, \{ status: refused\.status \}\)/);
  assert.doesNotMatch(route, /Not a member of this ticket/);
});

test('public RFQ share and marketplace listing images stay published', () => {
  const share = readFileSync(join(here, '../app/api/share/request/[id]/route.ts'), 'utf8');
  assert.match(share, /open\/bidding requests/);
  assert.match(share, /serial_number/);
  assert.doesNotMatch(share, /from\('equipment'\)/);
  assert.doesNotMatch(share, /logo_url/);
  assert.doesNotMatch(share, /equipment-photos/);
  const listings = readFileSync(
    join(here, '../supabase/migrations/20260620_000000_marketplace_tables_and_rls.sql'),
    'utf8'
  );
  assert.match(listings, /Authenticated can view active listings/);
  assert.match(listings, /bucket_id = 'marketplace-images'/);
});

test('equipment photo display does not fall back to the public object URL', async () => {
  const url = 'https://db.example/storage/v1/object/public/equipment-photos/equipment/22/laser.jpg';
  assert.deepEqual(storageObjectFromPublicUrl(url), {
    bucket: 'equipment-photos',
    path: 'equipment/22/laser.jpg',
  });
  const denied = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, 'equipment-photos');
        return {
          createSignedUrl: async () => ({ data: null, error: { message: 'denied' } }),
        };
      },
    },
  };
  assert.equal(await equipmentPhotoDisplayUrl(denied, url), null);
  const signed = {
    storage: {
      from() {
        return {
          createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/laser' }, error: null }),
        };
      },
    },
  };
  assert.equal(await equipmentPhotoDisplayUrl(signed, url), 'https://signed.example/laser');
  assert.equal(
    await equipmentPhotoDisplayUrl(denied, 'https://cdn.example/marketplace-images/listing.jpg'),
    'https://cdn.example/marketplace-images/listing.jpg'
  );
});
