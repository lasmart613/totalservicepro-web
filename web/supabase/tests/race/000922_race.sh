#!/usr/bin/env bash
# Two-session races for 000922 on a committed fixture DB (local PG17 only,
# fixture data only, never production). Needs an empty server reachable with
# PGHOST/PGPORT/PGUSER (default /tmp:55309 postgres). Exit 0 = all PASS.
#  1) two parallel requests for one laser   -> one pending row
#  2) two parallel approvals                -> one grant
#  3) N-1 grant vs join, both orders        -> 0 active grants by the joiner
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-55309} PGUSER=${PGUSER:-postgres}
DB=${RACE_DB:-race922}
OUT=$(mktemp -d)
P="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
dropdb --if-exists "$DB" 2>/dev/null; createdb "$DB"
$P -f "$HERE/000922_race_setup.sql" >"$OUT/setup.log" 2>&1 || { echo "setup failed"; tail -5 "$OUT/setup.log"; exit 1; }
as() { echo "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$1', false);"; }
L=00000000-0000-0000-0000-0000000000b1; C=00000000-0000-0000-0000-0000000000c1; M=00000000-0000-0000-0000-0000000000c3
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1: $2"; else echo "FAIL $1: got $2, want $3"; fail=1; fi; }

( echo "$(as $L) BEGIN; SELECT 'A', status, created FROM public.request_service_history_access(10, 1); SELECT pg_sleep(2); COMMIT;" | $P -At ) >"$OUT/a" 2>&1 &
sleep 0.5
( echo "$(as $L) SELECT 'B', status, created FROM public.request_service_history_access(10, 1);" | $P -At ) >"$OUT/b" 2>&1
wait
check "race requests: one pending row" "$($P -At -c "SELECT count(*) FROM public.service_history_requests")" 1

RID=$($P -At -c "SELECT id FROM public.service_history_requests")
( echo "$(as $C) BEGIN; SELECT 'A', status FROM public.respond_to_service_history_request($RID, 'approve'); SELECT pg_sleep(2); COMMIT;" | $P -At ) >"$OUT/c" 2>&1 &
sleep 0.5
( echo "$(as $M) SELECT 'B', status FROM public.respond_to_service_history_request($RID, 'approve');" | $P -At ) >"$OUT/d" 2>&1
wait
check "race approvals: one grant" "$($P -At -c "SELECT count(*) FROM public.service_history_grants")" 1

# N-1: manager M (clinic 10 approver, not in shop 1) grants all lasers to shop 1
# while M joins shop 1 in another session. Both orders must end with 0 active
# grants by M (revoked after the wait, or refused by M-1).
GRANT="$(as $M) SELECT 'grant=' || public.grant_service_history(10, 1, NULL);"
JOIN="INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES ('$M', 1, 'fse');"
reset() { $P -c "DELETE FROM public.service_history_grants WHERE granted_by = '$M'; DELETE FROM public.organization_memberships WHERE user_id = '$M' AND organization_id = 1;" >/dev/null; }
active() { $P -At -c "SELECT count(*) FROM public.service_history_grants WHERE granted_by = '$M' AND revoked_at IS NULL"; }
member() { $P -At -c "SELECT count(*) FROM public.organization_memberships WHERE user_id = '$M' AND organization_id = 1"; }
for order in grant_first join_first; do
  reset
  if [ $order = grant_first ]; then FIRST=$GRANT; SECOND=$JOIN; else FIRST=$JOIN; SECOND=$GRANT; fi
  ( echo "BEGIN; $FIRST SELECT pg_sleep(2); COMMIT;" | $P -At ) >"$OUT/n1a_$order" 2>&1 &
  sleep 0.5
  ( echo "BEGIN; $SECOND COMMIT;" | $P -At ) >"$OUT/n1b_$order" 2>&1
  wait
  check "N-1 $order: active grants by the joiner" "$(active)" 0
  check "N-1 $order: joiner is a shop member" "$(member)" 1
  echo "  session A: $(tr '\n' ' ' <"$OUT/n1a_$order" | cut -c1-160)"
  echo "  session B: $(tr '\n' ' ' <"$OUT/n1b_$order" | cut -c1-160)"
done
reset
dropdb --if-exists "$DB" 2>/dev/null
exit $fail
