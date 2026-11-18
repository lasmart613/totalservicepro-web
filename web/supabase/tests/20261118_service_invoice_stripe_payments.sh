#!/usr/bin/env bash
# Scratch proof for 000963. Local Postgres only. Never production.
# Org 2655 is a QA id. Exit 0 means every check passed.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
MIG="$ROOT/migrations/20261118_000963_service_invoice_stripe_payments.sql"
RB="$ROOT/migrations/20261118_000963_service_invoice_stripe_payments_rollback.sql"
DB=${PAY_DB:-invoice_stripe_payments_963}
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-55463} PGUSER=${PGUSER:-postgres}
P="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1: got [$2] want [$3]"; fail=1; fi; }

dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"

$P <<'SQL' >/dev/null
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.service_invoices (
  id bigint PRIMARY KEY,
  organization_id bigint,
  status text,
  total numeric(12,2),
  amount_paid numeric(12,2) DEFAULT 0,
  paid_at timestamptz,
  payment_method text,
  stripe_session_id text,
  invoice_data jsonb,
  updated_at timestamptz
);
INSERT INTO public.service_invoices (id, organization_id, status, total, amount_paid, stripe_session_id, invoice_data)
VALUES (
  265501, 2655, 'partially_paid', 1000, 100, 'cs_test_backfill',
  '{"line_items":[{"description":"Service"}],"payment_url":"https://checkout.stripe.com/c/pay/cs_test_backfill"}'::jsonb
);
SQL

$P -c "BEGIN" -f "$MIG" -c "COMMIT" >/tmp/pay963-mig.log 2>&1 || { echo "FAIL migration"; cat /tmp/pay963-mig.log; exit 1; }

check "no backfill rows" "$($P -At -c "SELECT count(*) FROM public.service_invoice_stripe_payments")" "0"

# Stand-in for draft #390's 000962 guard. auth.uid() is null here, which is
# the service role. The claim function must still be able to write the
# locked pay-link keys. A later step points auth.uid() at a user and shows
# that user cannot change them.
$P <<'SQL' >/dev/null
CREATE OR REPLACE FUNCTION public.service_invoices_guard_stripe_session()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id THEN
    RAISE EXCEPTION 'stripe_session_id cannot be changed by the client';
  END IF;
  IF COALESCE(NEW.invoice_data->>'payment_url', '') IS DISTINCT FROM COALESCE(OLD.invoice_data->>'payment_url', '')
     OR COALESCE(NEW.invoice_data->>'stripe_checkout_session_id', '') IS DISTINCT FROM COALESCE(OLD.invoice_data->>'stripe_checkout_session_id', '')
     OR COALESCE(NEW.invoice_data->>'stripe_checkout_session_conflict', '') IS DISTINCT FROM COALESCE(OLD.invoice_data->>'stripe_checkout_session_conflict', '') THEN
    RAISE EXCEPTION 'invoice payment fields cannot be changed by the client';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS service_invoices_guard_stripe_session ON public.service_invoices;
CREATE TRIGGER service_invoices_guard_stripe_session
  BEFORE UPDATE ON public.service_invoices
  FOR EACH ROW EXECUTE FUNCTION public.service_invoices_guard_stripe_session();
SQL

# A then B then replay A then replay B on a fresh $1000 invoice.
$P -c "INSERT INTO public.service_invoices (id, organization_id, status, total, amount_paid, invoice_data) VALUES (265502, 2655, 'sent', 1000, 0, '{\"line_items\":[{\"description\":\"Job\"}]}'::jsonb)" >/dev/null
A=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_A', 300, 'usd', '{}'::jsonb)->>'amount_paid'")
B=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_B', 300, 'usd', '{}'::jsonb)->>'amount_paid'")
REPLAY_A=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_A', 300, 'usd', '{}'::jsonb)->>'claimed'")
REPLAY_B=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_B', 300, 'usd', '{}'::jsonb)->>'claimed'")
LEFT=$($P -At -c "SELECT amount_paid || ':' || status || ':' || (SELECT count(*) FROM public.service_invoice_stripe_payments WHERE invoice_id = 265502) FROM public.service_invoices WHERE id = 265502")
check "A then B amounts" "$A $B" "300.00 600.00"
check "replays are not claims" "$REPLAY_A $REPLAY_B" "false false"
check "ledger stays at 600 with two sessions" "$LEFT" "600.00:partially_paid:2"
LINES=$($P -At -c "SELECT invoice_data->'line_items'->0->>'description' FROM public.service_invoices WHERE id = 265502")
check "jsonb merge keeps line items" "$LINES" "Job"

# Same-session race: the second call blocks on the invoice row lock.
( echo "BEGIN; SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_race', 50, 'usd', '{}'::jsonb)->>'claimed'; SELECT pg_sleep(1); COMMIT;" | $P -At ) >/tmp/pay963-race-a.txt 2>&1 &
sleep 0.3
( echo "SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_race', 50, 'usd', '{}'::jsonb)->>'claimed';" | $P -At ) >/tmp/pay963-race-b.txt 2>&1
wait
RACE_AMT=$($P -At -c "SELECT amount_paid FROM public.service_invoices WHERE id = 265502")
RACE_N=$($P -At -c "SELECT count(*) FROM public.service_invoice_stripe_payments WHERE session_id = 'cs_test_race'")
check "race credits the session once" "$RACE_AMT $RACE_N" "650.00 1"
ta=$(grep -cx true /tmp/pay963-race-a.txt || true)
tb=$(grep -cx true /tmp/pay963-race-b.txt || true)
fa=$(grep -cx false /tmp/pay963-race-a.txt || true)
fb=$(grep -cx false /tmp/pay963-race-b.txt || true)
check "race returns one claim and one replay" "$((ta + tb)) $((fa + fb))" "1 1"

OVER=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_over', 900, 'usd', '{}'::jsonb)->>'reason'")
OVER_AMT=$($P -At -c "SELECT amount_paid FROM public.service_invoices WHERE id = 265502")
check "amount over the balance is recorded and not credited" "$OVER $OVER_AMT" "overpaid_not_credited 650.00"
CUR=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_eur', 10, 'eur', '{}'::jsonb)->>'reason'")
check "non-usd currency is refused" "$CUR" "currency_mismatch"

# $585 session after $100 cash on a $585 invoice. The id is only the open
# pay link (stripe_checkout_session_id), so this is a real overpayment.
$P -c "INSERT INTO public.service_invoices (id, organization_id, status, total, amount_paid, invoice_data) VALUES (265503, 2655, 'partially_paid', 585, 100, '{\"line_items\":[{\"description\":\"Link\"}],\"payment_url\":\"https://checkout.stripe.com/c/pay/cs_test_585\",\"stripe_checkout_session_id\":\"cs_test_585\"}'::jsonb)" >/dev/null
OVER585=$($P -At -c "SELECT (r->>'reason') || ':' || (r->>'notify') FROM (SELECT public.apply_service_invoice_stripe_payment(265503, 'cs_test_585', 585, 'usd', '{\"payment_url\":\"https://evil.example\"}'::jsonb) AS r) s")
NOTIFY585=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265503, 'cs_test_585', 585, 'usd', '{}'::jsonb)->>'notify'")
$P -c "SELECT public.apply_service_invoice_stripe_payment(265503, 'cs_test_585b', 500, 'usd', '{}'::jsonb)" >/dev/null
STATE585=$($P -At <<'SQL'
SELECT amount_paid::text
  || ':' || (invoice_data->'stripe_checkout_session_conflict'->0->>'reason')
  || ':' || (invoice_data->'stripe_checkout_session_conflict'->0->>'sessionId')
  || ':' || (invoice_data->'stripe_checkout_session_conflict'->0->>'amount')
  || ':' || (invoice_data->'stripe_checkout_session_conflict'->1->>'sessionId')
  || ':' || jsonb_array_length(invoice_data->'stripe_checkout_session_conflict')::text
  || ':' || COALESCE(invoice_data->>'payment_url', '')
  || ':' || (
    SELECT outcome || ':' || count(*)::text
    FROM public.service_invoice_stripe_payments
    WHERE session_id = 'cs_test_585'
    GROUP BY outcome
  )
FROM public.service_invoices
WHERE id = 265503;
SQL
)
check "585 overpayment reason" "$OVER585" "overpaid_not_credited:true"
check "585 replay does not notify again" "$NOTIFY585" "false"
check "585 ledger keeps both conflicts" "$STATE585" "100.00:overpaid:cs_test_585:585.00:cs_test_585b:2:https://checkout.stripe.com/c/pay/cs_test_585:overpaid_not_credited:1"

# $1,760 invoice, $1,175 already stored from a credit made before this table,
# then $100 cash (amount_paid 1275). Replaying the old session must not raise
# an overpayment. Scratch invoice 265523 stands in for that shape. Org 2655.
$P <<'SQL' >/dev/null
INSERT INTO public.service_invoices (id, organization_id, status, total, amount_paid, stripe_session_id, invoice_data)
VALUES (
  265523, 2655, 'partially_paid', 1760, 1275, 'cs_test_1175',
  '{"line_items":[{"description":"Older"}],"stripe_checkout_session_id":"cs_test_1175","stripe_checkout_session_ids":["cs_test_1175"]}'::jsonb
);
SQL
BIG=$($P -At -c "SELECT (r->>'reason') || ':' || (r->>'notify') FROM (SELECT public.apply_service_invoice_stripe_payment(265523, 'cs_test_1175', 1175, 'usd', '{}'::jsonb) AS r) s")
BIG_NOTIFY=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265523, 'cs_test_1175', 1175, 'usd', '{}'::jsonb)->>'notify'")
BIGSTATE=$($P -At <<'SQL'
SELECT amount_paid::text
  || ':' || (invoice_data->'stripe_checkout_session_conflict'->0->>'reason')
  || ':' || jsonb_array_length(invoice_data->'stripe_checkout_session_conflict')::text
  || ':' || (
    SELECT outcome || ':' || count(*)::text
    FROM public.service_invoice_stripe_payments
    WHERE invoice_id = 265523
    GROUP BY outcome
  )
FROM public.service_invoices
WHERE id = 265523;
SQL
)
check "stored 1175 replay is not an overpayment" "$BIG" "possibly_already_credited:false"
check "stored 1175 replay does not notify" "$BIG_NOTIFY" "false"
check "stored 1175 ledger" "$BIGSTATE" "1275.00:verify:1:possibly_already_credited:1"

EXTRA=$($P -At -c "SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_allow', 10, 'usd', '{\"payment_url\":\"https://evil.example\",\"stripe_destination_account\":\"acct_123\",\"payout_status\":\"held\"}'::jsonb)->>'claimed'")
EXTRA_URL=$($P -At -c "SELECT COALESCE(invoice_data->>'payment_url', '') || ':' || COALESCE(invoice_data->>'stripe_destination_account', '') || ':' || COALESCE(invoice_data->>'payout_status', '') FROM public.service_invoices WHERE id = 265502")
check "allowlisted extra still credits" "$EXTRA" "true"
check "p_extra cannot set payment_url" "$EXTRA_URL" ":acct_123:held"

# Flip to a signed-in uid. The guard installed above now rejects client edits.
$P <<'SQL' >/dev/null
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000002655'::uuid $$;
SQL
CLIENT=$($P -At -c "UPDATE public.service_invoices SET invoice_data = invoice_data || '{\"payment_url\":\"https://evil.example\"}'::jsonb WHERE id = 265502" 2>&1 || true)
check "signed-in pay-link edit is rejected" "$(printf '%s' "$CLIENT" | grep -c 'cannot be changed by the client')" "1"

$P -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'invoice_client') THEN CREATE ROLE invoice_client NOINHERIT; END IF; END \$\$; GRANT INSERT ON public.service_invoice_stripe_payments TO invoice_client" >/dev/null
DENIED=$($P -At -c "SET ROLE invoice_client; INSERT INTO public.service_invoice_stripe_payments (invoice_id, session_id, amount) VALUES (265502, 'cs_test_client', 1);" 2>&1 || true)
$P -c "RESET ROLE" >/dev/null
check "client insert is denied by RLS" "$(printf '%s' "$DENIED" | grep -c 'row-level security')" "1"
EXEC=$($P -At -c "SET ROLE invoice_client; SELECT public.apply_service_invoice_stripe_payment(265502, 'cs_test_client', 10, 'usd', '{}'::jsonb);" 2>&1 || true)
$P -c "RESET ROLE" >/dev/null
check "client cannot execute the claim function" "$(printf '%s' "$EXEC" | grep -c 'permission denied')" "1"

$P -c "BEGIN" -f "$RB" -c "COMMIT" >/tmp/pay963-rb.log 2>&1 || { echo "FAIL rollback"; cat /tmp/pay963-rb.log; exit 1; }
check "rollback drops the table" "$($P -At -c "SELECT to_regclass('public.service_invoice_stripe_payments') IS NULL")" "t"
check "rollback drops the function" "$($P -At -c "SELECT to_regprocedure('public.apply_service_invoice_stripe_payment(bigint, text, numeric, text, jsonb)') IS NULL")" "t"
check "rollback keeps the invoice amount" "$($P -At -c "SELECT amount_paid FROM public.service_invoices WHERE id = 265502")" "660.00"

dropdb --if-exists "$DB" >/dev/null 2>&1 || true
if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILED"; exit 1; fi
