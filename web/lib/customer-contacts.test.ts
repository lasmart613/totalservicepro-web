import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIRECTORY_CONTACT_ROLES,
  DIRECTORY_ROLE_LABELS,
  applyDirectoryContactToLinked,
  contactWriteRows,
  directoryContactsFromContactRows,
  emptyDirectoryContacts,
  ensurePrimaryDirectoryRole,
  hydrateDirectoryContacts,
  parseDirectoryContactsJson,
  patchDirectoryRoleField,
  pickCrmReachEmail,
  resolveDirectoryContact,
  roleDisplayName,
  roleFieldsFromInput,
  roleKeyFromTitle,
  setDirectoryPrimaryRole,
  serializeDirectoryContacts,
} from './customer-contacts.ts';

function withRole(
  key: keyof typeof DIRECTORY_ROLE_LABELS,
  fields: { first_name?: string; last_name?: string; name?: string; email?: string; phone?: string },
  primary?: keyof typeof DIRECTORY_ROLE_LABELS | null
) {
  const state = emptyDirectoryContacts();
  state.roles[key] = roleFieldsFromInput(fields, { trim: false });
  state.primaryRole = primary === undefined ? key : primary;
  return ensurePrimaryDirectoryRole(state);
}

test('fixed directory roles are the five clinic titles', () => {
  assert.deepEqual([...DIRECTORY_CONTACT_ROLES], [
    'owner',
    'medical_director',
    'physician',
    'laser_technician',
    'office_manager',
  ]);
  assert.equal(DIRECTORY_ROLE_LABELS.laser_technician, 'Laser Technician');
  assert.equal(roleKeyFromTitle('Medical Director'), 'medical_director');
  assert.equal(roleKeyFromTitle('office-manager'), 'office_manager');
});

test('primary radio is empty until a person-role is filled, then exactly one', () => {
  const empty = ensurePrimaryDirectoryRole(emptyDirectoryContacts());
  assert.equal(empty.primaryRole, null);

  const filled = withRole('physician', { name: 'Dr. Kim' }, null);
  assert.equal(filled.primaryRole, 'physician');

  const switched = setDirectoryPrimaryRole(
    withRole('physician', { name: 'Dr. Kim' }, 'physician'),
    'owner'
  );
  assert.equal(switched.primaryRole, 'physician');

  const both = emptyDirectoryContacts();
  both.roles.owner = roleFieldsFromInput({ name: 'Pat' });
  both.roles.office_manager = roleFieldsFromInput({ name: 'Sam', email: 'sam@clinic.com' });
  both.primaryRole = 'office_manager';
  assert.equal(ensurePrimaryDirectoryRole(both).primaryRole, 'office_manager');

  both.roles.office_manager = roleFieldsFromInput({});
  assert.equal(ensurePrimaryDirectoryRole(both).primaryRole, 'owner');
});

test('resolve prefers primary role, then extra primary row, then legacy name, then main office', () => {
  const primary = resolveDirectoryContact({
    roles: withRole('owner', { name: 'Larry Smart', email: 'larry@clinic.com', phone: '555-0100' }),
    officeEmail: 'office@clinic.com',
    officePhone: '555-0000',
    legacyContactName: 'Old Name',
  });
  assert.equal(primary.source, 'primary_role');
  assert.equal(primary.name, 'Larry Smart');
  assert.equal(primary.email, 'larry@clinic.com');
  assert.equal(primary.phone, '555-0100');
  assert.equal(primary.roleLabel, 'Owner');

  const officeFill = resolveDirectoryContact({
    roles: withRole('office_manager', { name: 'Sam' }),
    officeEmail: 'office@clinic.com',
    officePhone: '555-0000',
  });
  assert.equal(officeFill.source, 'primary_role');
  assert.equal(officeFill.email, 'office@clinic.com');
  assert.equal(officeFill.phone, '555-0000');

  const extra = resolveDirectoryContact({
    contactRows: [
      { first_name: 'Jordan', last_name: 'Lee', title: 'Billing', email: 'jordan@clinic.com', is_primary: true },
    ],
    officeEmail: 'office@clinic.com',
    legacyContactName: 'Old Name',
  });
  assert.equal(extra.source, 'primary_row');
  assert.equal(extra.name, 'Jordan Lee');
  assert.equal(extra.email, 'jordan@clinic.com');

  const legacy = resolveDirectoryContact({
    legacyContactName: 'Pat Rivera',
    officeEmail: 'office@clinic.com',
    officePhone: '555-0000',
  });
  assert.equal(legacy.source, 'legacy_contact_name');
  assert.equal(legacy.name, 'Pat Rivera');
  assert.equal(legacy.email, 'office@clinic.com');

  const office = resolveDirectoryContact({
    officeEmail: 'office@clinic.com',
    officePhone: '555-0000',
  });
  assert.equal(office.source, 'main_office');
  assert.equal(office.name, '');
  assert.equal(office.email, 'office@clinic.com');

  const none = resolveDirectoryContact({});
  assert.equal(none.source, 'none');
});

test('reach email prefers primary person, then main office, then any contact, then form', () => {
  assert.equal(
    pickCrmReachEmail({
      directoryContacts: serializeDirectoryContacts(
        withRole('owner', { name: 'Larry', email: 'larry@clinic.com' })
      ),
      officeEmail: 'office@clinic.com',
      formEmail: 'form@clinic.com',
    }).source,
    'crm_contact'
  );
  assert.equal(
    pickCrmReachEmail({
      directoryContacts: serializeDirectoryContacts(withRole('owner', { name: 'Larry' })),
      officeEmail: 'office@clinic.com',
    }).email,
    'office@clinic.com'
  );
  assert.equal(
    pickCrmReachEmail({
      contactRows: [{ email: 'billing@clinic.com', is_primary: false }],
      formEmail: 'form@clinic.com',
    }).email,
    'billing@clinic.com'
  );
  assert.equal(pickCrmReachEmail({ formEmail: 'form@clinic.com' }).source, 'form');
  assert.equal(pickCrmReachEmail({}).source, 'none');
});

test('JSON parse and contact-row hydrate keep empty roles valid', () => {
  const parsed = parseDirectoryContactsJson({
    version: 1,
    primaryRole: 'laser_technician',
    roles: {
      laser_technician: { name: 'Alex', email: '', phone: '555-0199' },
    },
  });
  assert.equal(parsed?.primaryRole, 'laser_technician');
  assert.equal(roleDisplayName(parsed?.roles.owner), '');
  assert.equal(parsed?.roles.laser_technician.first_name, 'Alex');
  assert.equal(parsed?.roles.laser_technician.phone, '555-0199');

  const fromRows = directoryContactsFromContactRows([
    { first_name: 'Owner', title: 'Owner', email: 'o@clinic.com', is_primary: true },
    { first_name: 'Kai', last_name: 'Ng', title: 'Office Manager', phone: '555-0111' },
  ]);
  assert.equal(fromRows.roles.owner.email, 'o@clinic.com');
  assert.equal(roleDisplayName(fromRows.roles.owner), '');
  assert.equal(fromRows.roles.office_manager.first_name, 'Kai');
  assert.equal(fromRows.roles.office_manager.last_name, 'Ng');
  assert.equal(roleDisplayName(fromRows.roles.office_manager), 'Kai Ng');
  assert.equal(fromRows.primaryRole, 'owner');

  const hydrated = hydrateDirectoryContacts({
    directoryContacts: null,
    contactRows: [{ first_name: 'Pat', title: 'Physician', email: 'pat@clinic.com', is_primary: true }],
  });
  assert.equal(hydrated.primaryRole, 'physician');
});

test('linked-customer fallback uses primary then office then legacy contact_name', () => {
  const primary = applyDirectoryContactToLinked({
    contact_name: 'Old',
    email: 'office@clinic.com',
    phone: '555-0000',
    directory_contacts: serializeDirectoryContacts(
      withRole('medical_director', { name: 'Dr. Chen', email: 'chen@clinic.com', phone: '555-0144' })
    ),
  });
  assert.equal(primary.contact, 'Dr. Chen');
  assert.equal(primary.email, 'chen@clinic.com');
  assert.equal(primary.phone, '555-0144');
  assert.equal(primary.contactRole, 'Medical Director');

  const legacy = applyDirectoryContactToLinked({
    contact_name: 'Old',
    email: 'office@clinic.com',
    phone: '555-0000',
  });
  assert.equal(legacy.contact, 'Old');
  assert.equal(legacy.email, 'office@clinic.com');
  assert.equal(legacy.phone, '555-0000');
});

test('contact sync writes filled roles only and marks the primary', () => {
  const rows = contactWriteRows(
    99,
    ensurePrimaryDirectoryRole({
      ...emptyDirectoryContacts(),
      roles: {
        ...emptyDirectoryContacts().roles,
        owner: roleFieldsFromInput({ name: 'Larry Smart', email: 'larry@clinic.com' }),
        office_manager: roleFieldsFromInput({}),
      },
      primaryRole: 'owner',
    })
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Owner');
  assert.equal(rows[0].first_name, 'Larry');
  assert.equal(rows[0].last_name, 'Smart');
  assert.equal(rows[0].is_primary, true);
});

test('directory, invite, and billing surfaces use primary then office fallback', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const customers = readFileSync(join(here, '../app/customers/page.tsx'), 'utf8');
  const profile = readFileSync(join(here, '../app/customers/[id]/page.tsx'), 'utf8');
  const invite = readFileSync(join(here, '../app/api/customers/invite/route.ts'), 'utf8');
  const sendDoc = readFileSync(join(here, './billing/send-doc-email.ts'), 'utf8');
  const invoice = readFileSync(join(here, '../app/api/billing/send-invoice/route.ts'), 'utf8');
  assert.match(customers, /applyDirectoryContactToLinked/);
  assert.match(customers, /display_contact/);
  assert.match(profile, /resolveDirectoryContact/);
  assert.match(profile, /roleDisplayName/);
  assert.match(profile, /directory-primary-contact|Main office/);
  assert.match(invite, /pickCrmReachEmail/);
  assert.match(invite, /resolveDirectoryContact/);
  assert.match(sendDoc, /pickCrmReachEmail/);
  assert.match(invoice, /fetchDirectoryContactSources/);
});

test('role name edits keep spaces while typing and persist First + Last', () => {
  let state = emptyDirectoryContacts();
  state = patchDirectoryRoleField(state, 'medical_director', 'first_name', 'Mary ');
  assert.equal(state.roles.medical_director.first_name, 'Mary ');
  assert.equal(state.primaryRole, 'medical_director');

  state = patchDirectoryRoleField(state, 'medical_director', 'last_name', 'Ann Chen');
  assert.equal(state.roles.medical_director.last_name, 'Ann Chen');
  assert.equal(roleDisplayName(state.roles.medical_director), 'Mary Ann Chen');

  const json = serializeDirectoryContacts(state);
  assert.equal(json.version, 2);
  assert.equal(json.roles.medical_director.first_name, 'Mary');
  assert.equal(json.roles.medical_director.last_name, 'Ann Chen');
  assert.equal(json.roles.medical_director.name, 'Mary Ann Chen');

  const rows = contactWriteRows(12, state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Medical Director');
  assert.equal(rows[0].first_name, 'Mary');
  assert.equal(rows[0].last_name, 'Ann Chen');

  const parsed = parseDirectoryContactsJson(json);
  assert.equal(parsed?.roles.medical_director.first_name, 'Mary');
  assert.equal(parsed?.roles.medical_director.last_name, 'Ann Chen');
  assert.equal(roleDisplayName(parsed?.roles.medical_director), 'Mary Ann Chen');
});

test('legacy single name JSON and contact rows backfill into first + last', () => {
  const fromV1 = parseDirectoryContactsJson({
    version: 1,
    primaryRole: 'laser_technician',
    roles: {
      laser_technician: { name: 'Alex Rivera', email: 'alex@clinic.com', phone: '' },
    },
  });
  assert.equal(fromV1?.roles.laser_technician.first_name, 'Alex');
  assert.equal(fromV1?.roles.laser_technician.last_name, 'Rivera');
  assert.equal(roleDisplayName(fromV1?.roles.laser_technician), 'Alex Rivera');

  const fromRow = directoryContactsFromContactRows([
    { first_name: 'Pat Rivera', title: 'Office Manager', email: 'pat@clinic.com', is_primary: true },
  ]);
  assert.equal(fromRow.roles.office_manager.first_name, 'Pat');
  assert.equal(fromRow.roles.office_manager.last_name, 'Rivera');
  assert.equal(roleDisplayName(fromRow.roles.office_manager), 'Pat Rivera');
});
