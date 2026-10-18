#!/usr/bin/env bash
# Parallel step1 on the proof DB: 12 calls from one IP -> exactly 5 orgs; 6 calls for one email -> exactly 1 org.
export PATH=/usr/lib/postgresql/17/bin:$PATH
DB=${1:-mrn926}; Q="psql -h /tmp -p 55309 -U postgres -d $DB -Atq"
$Q -c "delete from directory_registration_attempts where key_value like 'ip-rc%' or key_kind='global'"
for i in $(seq 1 12); do $Q -c "set role service_role; select public.directory_registration_step1('Racer $i','service','x$i@racer$i.com',null,null,'ip-rc',gen_random_uuid())" >/dev/null & done; wait
a=$($Q -c "select count(*) from organizations where name like 'Racer %'")
for i in $(seq 1 6); do $Q -c "set role service_role; select public.directory_registration_step1('Twin Racer','service','t@twinracer.com',null,null,'ip-rc2-$i',gen_random_uuid())" >/dev/null & done; wait
b=$($Q -c "select count(*) from organizations where name='Twin Racer'")
[ "$a" = 5 ] && echo "PASS ip race: $a orgs" || echo "FAILED ip race: $a"
[ "$b" = 1 ] && echo "PASS email race: $b org" || echo "FAILED email race: $b"
# Parallel approve of one registration: exactly one invite and one audit row.
rid=$($Q -c "select (public.directory_registration_step1('Race Approve Co','service','ra@raceapprove.test',null,null,'ip-rc3',gen_random_uuid())->>'registration_id')")
for i in $(seq 1 8); do $Q -c "select public.directory_registration_review('$rid','approve','aaaaaaaa-0000-0000-0000-00000000a00$i','r$i@x.test')" >/dev/null & done; wait
c=$($Q -c "select (select count(*) from directory_listing_invites i join directory_registrations r on r.organization_id=i.organization_id where r.id='$rid')||'|'||(select count(*) from directory_registration_reviews where registration_id='$rid')")
[ "$c" = "1|1" ] && echo "PASS approve race: $c" || echo "FAILED approve race: $c"
# Global cap under spoofed IPs: 40 parallel sign-ups, each with its own IP and email -> exactly 30 accepted.
$Q -c "delete from directory_registration_attempts where key_kind='global'"
for i in $(seq 1 40); do $Q -c "set role service_role; select public.directory_registration_step1('Spoof $i','service','s$i@spoof$i.com',null,null,'ip-spoof-$i',gen_random_uuid())" >/dev/null & done; wait
g=$($Q -c "select count(*) from directory_registrations where company_name like 'Spoof %'")
[ "$g" = 30 ] && echo "PASS global cap race: $g of 40" || echo "FAILED global cap race: $g"
