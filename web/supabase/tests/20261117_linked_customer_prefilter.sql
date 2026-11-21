-- Scratch proof for 000960's prefilter. Not applied to production.
-- Each directory layout and each role name must survive the prefilter.
-- find_linked_customer_by_name must keep a name longer than 80 characters.

CREATE TABLE IF NOT EXISTS organizations (
  id bigint PRIMARY KEY,
  name text,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  email text,
  contact_name text,
  directory_contacts jsonb,
  type text
);
CREATE TABLE IF NOT EXISTS organization_customers (
  service_organization_id bigint,
  customer_organization_id bigint,
  created_at timestamptz
);
CREATE TABLE IF NOT EXISTS contacts (
  id bigint PRIMARY KEY,
  organization_id bigint,
  first_name text,
  last_name text,
  title text,
  phone text,
  email text,
  is_primary boolean
);

INSERT INTO organizations (id, name, city, state, phone, email, type, directory_contacts) VALUES
  (1, 'Nested Physician', 'Austin', 'TX', '555-0001', 'office@nested.test', 'laser_clinic',
    '{"roles":{"physician":{"name":"Zelda Quinn"}},"primaryRole":"physician"}'::jsonb),
  (2, 'Flat Manager', 'Dallas', 'TX', '555-0002', 'office@flat.test', 'laser_clinic',
    '{"office_manager":{"name":"Mina Cole"}}'::jsonb),
  (3, 'String Tech', 'El Paso', 'TX', '555-0003', 'office@string.test', 'customer',
    to_jsonb('{"roles":{"laser_technician":{"name":"Rico Hale"}},"primaryRole":"laser_technician"}'::text)),
  (4, 'Owner Name', 'Waco', 'TX', '555-1000', 'office@owner.test', 'laser_clinic',
    '{"roles":{"owner":{"name":"Ada Owner"}}}'),
  (5, 'Director Name', 'Waco', 'TX', '555-1000', 'office@dir.test', 'laser_clinic',
    '{"roles":{"medical_director":{"name":"Bea Director"}}}'),
  (6, 'Resolved Phone', 'Waco', 'TX', '555-0001', 'office-only@phone.test', 'laser_clinic',
    '{"roles":{"physician":{"first_name":"Sam","last_name":"Lee","phone":"555-9999","email":"sam@lee.test"}},"primaryRole":"physician"}');

INSERT INTO organization_customers (service_organization_id, customer_organization_id, created_at)
SELECT 2655, id, now() FROM organizations WHERE id <= 6;

-- A long exact name must still be found. The search box caps at 80. This function must not.
INSERT INTO organizations (id, name, type)
VALUES (7, repeat('Long Clinic ', 12), 'laser_clinic');
INSERT INTO organization_customers (service_organization_id, customer_organization_id, created_at)
VALUES (2655, 7, now());

DO $$
DECLARE
  v_hit text;
BEGIN
  SELECT name INTO v_hit FROM search_linked_customers(2655, 'Zelda Quinn', 'az', 12);
  IF v_hit IS DISTINCT FROM 'Nested Physician' THEN
    RAISE EXCEPTION 'nested physician name missed, got %', v_hit;
  END IF;
  SELECT name INTO v_hit FROM search_linked_customers(2655, 'Mina Cole', 'az', 12);
  IF v_hit IS DISTINCT FROM 'Flat Manager' THEN
    RAISE EXCEPTION 'flat office_manager name missed, got %', v_hit;
  END IF;
  SELECT name INTO v_hit FROM search_linked_customers(2655, 'Rico Hale', 'az', 12);
  IF v_hit IS DISTINCT FROM 'String Tech' THEN
    RAISE EXCEPTION 'json-string laser_technician name missed, got %', v_hit;
  END IF;
  SELECT name INTO v_hit FROM search_linked_customers(2655, 'Ada Owner', 'az', 12);
  IF v_hit IS DISTINCT FROM 'Owner Name' THEN
    RAISE EXCEPTION 'owner name missed, got %', v_hit;
  END IF;
  SELECT name INTO v_hit FROM search_linked_customers(2655, 'Bea Director', 'az', 12);
  IF v_hit IS DISTINCT FROM 'Director Name' THEN
    RAISE EXCEPTION 'medical_director name missed, got %', v_hit;
  END IF;
  -- Office phone is not the resolved phone, so it must not be a match.
  IF EXISTS (SELECT 1 FROM search_linked_customers(2655, '555-0001', 'az', 12) WHERE name = 'Resolved Phone') THEN
    RAISE EXCEPTION 'office phone matched after the role phone replaced it';
  END IF;
  SELECT name INTO v_hit FROM search_linked_customers(2655, '555-9999', 'az', 12);
  IF v_hit IS DISTINCT FROM 'Resolved Phone' THEN
    RAISE EXCEPTION 'resolved phone missed, got %', v_hit;
  END IF;
  SELECT name INTO v_hit FROM find_linked_customer_by_name(2655, repeat('Long Clinic ', 12));
  IF v_hit IS NULL THEN
    RAISE EXCEPTION 'long name was truncated or missed';
  END IF;
END $$;
