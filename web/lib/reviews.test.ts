import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_VISIBLE_REVIEWS,
  REVIEW_EDIT_WINDOW_DAYS,
  attachRatingSummaries,
  canReplyToReview,
  formatOrgRating,
  mapReviewWriteError,
  publicProfileFromRpc,
  publicReviewsFromRpc,
  showOrgRating,
  validateHideReview,
  validateReviewReply,
  validateReviewTarget,
  validateReviewWrite,
} from './reviews.ts';

const here = dirname(fileURLToPath(import.meta.url));
const up = readFileSync(join(here, '../supabase/migrations/20261116_000957_service_org_reviews.sql'), 'utf8');
const down = readFileSync(join(here, '../supabase/migrations/20261116_000957_service_org_reviews_rollback.sql'), 'utf8');
const proof = readFileSync(join(here, '../supabase/tests/20261116_service_org_reviews.sql'), 'utf8');

test('stars are required and a written review cannot stand alone', () => {
  const textOnly = validateReviewWrite({ body: 'Great work' });
  assert.equal(textOnly.ok, false);
  if (!textOnly.ok) assert.equal(textOnly.error, 'A written review needs a star rating.');

  const nullStars = validateReviewWrite({ stars: null, body: 'Great work' });
  assert.equal(nullStars.ok, false);

  const blankStars = validateReviewWrite({ stars: '  ', body: 'Great work' });
  assert.equal(blankStars.ok, false);

  const missing = validateReviewWrite({});
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, 'Stars are required.');

  const zero = validateReviewWrite({ stars: 0, body: 'Nope' });
  assert.equal(zero.ok, false);
  const six = validateReviewWrite({ stars: 6 });
  assert.equal(six.ok, false);
  const fraction = validateReviewWrite({ stars: 4.5 });
  assert.equal(fraction.ok, false);

  const starsOnly = validateReviewWrite({ stars: 5, body: '   ' });
  assert.equal(starsOnly.ok, true);
  if (starsOnly.ok) {
    assert.equal(starsOnly.stars, 5);
    assert.equal(starsOnly.body, null);
  }

  const both = validateReviewWrite({ stars: '4', body: ' On time ' });
  assert.equal(both.ok, true);
  if (both.ok) {
    assert.equal(both.stars, 4);
    assert.equal(both.body, 'On time');
  }
});

test('a rating names one completed job and a reply is one text', () => {
  assert.equal(validateReviewTarget({}).ok, false);
  assert.equal(validateReviewTarget({ ticketId: 0 }).ok, false);
  assert.equal(validateReviewTarget({ reportId: 'not-a-uuid' }).ok, false);
  const ticket = validateReviewTarget({ ticketId: '501' });
  assert.equal(ticket.ok, true);
  if (ticket.ok) assert.equal(ticket.ticketId, 501);
  const invoice = validateReviewTarget({ invoiceId: 603 });
  assert.equal(invoice.ok, true);
  assert.equal(validateReviewReply('').ok, false);
  assert.equal(validateReviewReply('  Thank you ').ok, true);
  assert.equal(canReplyToReview('fse'), false);
  assert.equal(canReplyToReview('admin'), true);
  assert.equal(canReplyToReview('company_admin'), true);
  assert.equal(canReplyToReview('owner'), true);
  assert.equal(validateHideReview({ hidden: true, reason: 'no' }).ok, false);
  const hide = validateHideReview({ hidden: true, reason: 'abusive language' });
  assert.equal(hide.ok, true);
  if (hide.ok) assert.equal(hide.reason, 'abusive language');
  const unhide = validateHideReview({ hidden: false });
  assert.equal(unhide.ok, true);
  if (unhide.ok) assert.equal(unhide.reason, null);
});

test('public reads keep prices, contact details, and hidden reasons out', () => {
  const profile = publicProfileFromRpc({
    id: 88022,
    name: 'QA Repair Co',
    type: 'service_company',
    city: 'Dallas',
    state: 'TX',
    phone: '214-555-0199',
    email: 'shop-secret@example.com',
    notes: 'SECRET-NOTE',
    total: 99999.99,
    rating_count: 2,
    rating_average: 4.5,
  });
  assert.ok(profile);
  assert.equal(profile?.name, 'QA Repair Co');
  assert.equal(profile?.ratingCount, 2);
  assert.equal(JSON.stringify(profile).includes('214-555'), false);
  assert.equal(JSON.stringify(profile).includes('shop-secret'), false);
  assert.equal(JSON.stringify(profile).includes('99999'), false);
  assert.equal(publicProfileFromRpc({ id: 1, phone: '555' })?.name, null);
  assert.equal(showOrgRating(0), false);
  assert.equal(showOrgRating(MIN_VISIBLE_REVIEWS), true);
  const rows = attachRatingSummaries(
    [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    [{ service_organization_id: 1, review_count: 0, average_stars: 5 }]
  );
  assert.equal(rows[0].ratingCount, null);
  assert.equal(rows[1].ratingAverage, null);
  const reviews = publicReviewsFromRpc([
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', stars: 5, body: null, total: 12, hidden_reason: 'secret' },
  ]);
  assert.equal(reviews.length, 1);
  assert.equal(JSON.stringify(reviews).includes('secret'), false);
  assert.equal(JSON.stringify(reviews).includes('total'), false);
  assert.equal(formatOrgRating(4), '4.0');
  assert.match(mapReviewWriteError('duplicate key value violates unique constraint job_key'), /already rated/);
  assert.equal(REVIEW_EDIT_WINDOW_DAYS, 30);
});

test('000957 requires stars in the database and checks membership, not profile role', () => {
  assert.match(up, /stars smallint NOT NULL/);
  assert.match(up, /CONSTRAINT service_org_reviews_stars_chk CHECK \(stars BETWEEN 1 AND 5\)/);
  assert.match(up, /body text/);
  assert.match(up, /body IS NULL OR char_length\(body\)/);
  assert.match(up, /organization_memberships/);
  assert.match(up, /is_active_org_member/);
  assert.doesNotMatch(up, /FROM public\.user_profiles/i);
  assert.doesNotMatch(up, /JOIN public\.user_profiles/i);
  assert.match(up, /only a platform admin can hide a review/);
  assert.match(up, /you cannot rate an organization you belong to/);
  assert.match(up, /service_org_review_edit_window/);
  assert.match(up, /interval '30 days'/);
  assert.match(up, /hidden_at IS NULL/);
  assert.match(down, /DROP TABLE IF EXISTS public\.service_org_reviews/);
  assert.match(proof, /text without stars/i);
  assert.match(proof, /23502/);
  assert.doesNotMatch(`${up}\n${down}\n${proof}`, /organization_id\s*=\s*(4|153|154|1005|2616|5509|5515)\b/);
  const profileRoute = readFileSync(join(here, '../app/api/directory/profile/route.ts'), 'utf8');
  assert.match(profileRoute, /public_service_org_profile/);
  assert.doesNotMatch(profileRoute, /getSupabaseAdmin|SERVICE_ROLE|user_profiles/);
  const godRoute = readFileSync(join(here, '../app/api/god/reviews/route.ts'), 'utf8');
  assert.match(godRoute, /requireGodCaller/);
  assert.doesNotMatch(godRoute, /user_profiles/);
  const writeRoute = readFileSync(join(here, '../app/api/reviews/route.ts'), 'utf8');
  assert.match(writeRoute, /validateReviewWrite/);
  assert.doesNotMatch(writeRoute, /getSupabaseAdmin/);
});
