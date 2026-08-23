import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvedTicketRefFromEstimate,
  callerRoleOnEstimate,
  isEstimateCustomer,
  isEstimateShop,
  isMarketplaceVisibleStatus,
  mergeApprovedTicketIntoEstimateData,
  sameOrgId,
  UNSCHEDULED_TICKET_STATUS,
  unscheduledTicketPayloadFromEstimate,
} from './approve-estimate-helpers.ts';

const estimate = {
  id: 42,
  organization_id: 113,
  customer_organization_id: 9001,
  created_by: 'shop-user',
  customer_name: 'Northshore Clinic',
  estimate_number: 'RP-EST-20260823-01',
  device_model: 'Candela GentleMax Pro',
  issues: 'No output',
  estimate_data: {
    manufacturer: 'Candela',
    model: 'GentleMax Pro',
    serial: 'GMP-1',
    custEmail: 'clinic@example.com',
    custAddress: '1 Lake St',
    custCity: 'Evanston',
    custState: 'IL',
    services: ['Repair'],
    urgency: 'standard',
    customer_organization_id: 9001,
  },
};

test('sameOrgId treats numeric and string org ids as equal', () => {
  assert.equal(sameOrgId(113, '113'), true);
  assert.equal(sameOrgId(113, 9001), false);
  assert.equal(sameOrgId(null, 113), false);
});

test('clinic org or estimate email is the customer; shop org is not', () => {
  assert.equal(isEstimateCustomer(estimate, { orgId: 9001 }), true);
  assert.equal(isEstimateCustomer(estimate, { email: 'clinic@example.com' }), true);
  assert.equal(isEstimateCustomer(estimate, { orgId: 113, email: 'shop@example.com' }), false);
  assert.equal(isEstimateShop(estimate, { orgId: 113 }), true);
  assert.equal(isEstimateShop(estimate, { userId: 'shop-user' }), true);
  assert.equal(isEstimateShop(estimate, { orgId: 9001 }), false);
});

test('shop role wins when the same person could match both sides', () => {
  assert.equal(callerRoleOnEstimate(estimate, { orgId: 113, email: 'clinic@example.com' }), 'shop');
  assert.equal(callerRoleOnEstimate(estimate, { orgId: 9001 }), 'customer');
  assert.equal(callerRoleOnEstimate(estimate, { orgId: 77, email: 'other@example.com' }), null);
});

test('approval payload is unscheduled, shop-owned, and not marketplace-open', () => {
  const payload = unscheduledTicketPayloadFromEstimate(estimate);
  assert.equal(payload.organization_id, 113);
  assert.equal(payload.status, UNSCHEDULED_TICKET_STATUS);
  assert.equal(payload.service_date, null);
  assert.equal(payload.scheduled_time, null);
  assert.equal(payload.estimate_id, 42);
  assert.equal(payload.assigned_to, null);
  assert.equal(payload.equipment_make, 'Candela');
  assert.equal(payload.service_type, 'Repair');
  assert.equal(isMarketplaceVisibleStatus(payload.status), false);
  assert.match(String(payload.notes), /Not posted to the marketplace/);
  assert.doesNotMatch(String(payload.status), /open|bidding/i);
});

test('already-approved ticket refs are read from columns or estimate_data', () => {
  const fromCols = approvedTicketRefFromEstimate({
    approved_ticket_id: 7,
    approved_ticket_number: 'RP-TKT-01',
    estimate_data: {},
  });
  assert.deepEqual(fromCols, { id: 7, number: 'RP-TKT-01' });

  const fromJson = approvedTicketRefFromEstimate({
    estimate_data: {
      approved_ticket_id: 8,
      approved_ticket_number: 'RP-TKT-02',
    },
  });
  assert.deepEqual(fromJson, { id: 8, number: 'RP-TKT-02' });
});

test('merge stores ticket id/number without inventing a manufacturer type', () => {
  const ed = mergeApprovedTicketIntoEstimateData(
    { manufacturer: 'Candela' },
    { id: 9, ticket_number: 'RP-TKT-03' }
  );
  assert.equal(ed.manufacturer, 'Candela');
  assert.equal(ed.approved_ticket_id, 9);
  assert.equal(ed.approved_ticket_number, 'RP-TKT-03');
  assert.equal(ed.approved_service_request_id, 9);
});
