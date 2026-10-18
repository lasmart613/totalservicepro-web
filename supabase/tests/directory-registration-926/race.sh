#!/usr/bin/env bash
# Parallel step1 on the proof DB: 12 calls from one IP -> exactly 5 orgs; 6 calls for one email -> exactly 1 org.
export PATH=/usr/lib/postgresql/17/bin:$PATH
DB=${1:-mrn926}; Q="psql -h /tmp -p 55309 -U postgres -d $DB -Atq"
$Q -c "delete from directory_registration_attempts where key_value like 'ip-rc%'"
for i in $(seq 1 12); do $Q -c "set role service_role; select public.directory_registration_step1('Racer $i','service','x$i@racer$i.com',null,null,'ip-rc')" >/dev/null & done; wait
a=$($Q -c "select count(*) from organizations where name like 'Racer %'")
for i in $(seq 1 6); do $Q -c "set role service_role; select public.directory_registration_step1('Twin Racer','service','t@twinracer.com',null,null,'ip-rc2-$i')" >/dev/null & done; wait
b=$($Q -c "select count(*) from organizations where name='Twin Racer'")
[ "$a" = 5 ] && echo "PASS ip race: $a orgs" || echo "FAILED ip race: $a"
[ "$b" = 1 ] && echo "PASS email race: $b org" || echo "FAILED email race: $b"
