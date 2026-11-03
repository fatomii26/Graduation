-- Demo and test data. FICTIONAL PEOPLE ONLY. Never load this into production, and never load real
-- student data into the testing environment.
--   npm run db:seed
do $$
declare
  firsts text[] := array['Aisha','Omar','Fatima','Rahul','Priya','Yousef','Mariam','Daniel','Sara','Hamza',
                         'Leila','Arjun','Noor','Kevin','Zainab','Ali','Hannah','Imran','Layla','Ravi'];
  lasts  text[] := array['Khan','Al Mansoori','Patel','Haddad','Fernandes','Rahman','Siddiqui','Thomas','Nair','Hussain'];
  progs  text[] := array['BA Business Management','BA Accounting and Finance','BSc Business Information Systems',
                         'BSc Computer Science','BEng Electronic Engineering','BSc Cyber Security',
                         'BSc Psychology','BA Media and Communication','LLB Law',
                         'MBA','MSc Finance','MA Education'];
  demo   text[] := array['M00123456','M00123457','M00123458','M00123459','M00123461','M00123462','M00987001'];
  s text; i int; m text; prog text; cer int; confirmed boolean; hold boolean; cid bigint; r jsonb; zc bigint; zb bigint; oid uuid; t uuid;
begin
  -- Seasons: three closed, Oct 2026 is the working season
  perform create_season('MAR-2025', 'Mar 2025', null, 'seed');
  update season_settings set graduate_price_aed = 325, guest_price_aed = 375, venue_name = 'Graduation Hall', venue_area = 'Dubai Knowledge Park',
         graduate_capacity = 250, hold_minutes = 10 where season_id = 'MAR-2025';
  perform save_zone('MAR-2025', null, 'A', 'Zone A', 'Door 2A', '#7A1128', 200, 6, 1, true, 'seed');
  perform save_zone('MAR-2025', null, 'B', 'Zone B', 'Door 2B', '#1F3A5F', 200, 4, 2, true, 'seed');
  perform save_zone('MAR-2025', null, 'C', 'Zone C', 'Door 2C', '#2F7D4F', 200, 0, 3, true, 'seed');
  perform save_zone('MAR-2025', null, 'D', 'Zone D', 'Door 2D', '#946200', 180, 0, 4, true, 'seed');
  insert into merch_items (season_id, name, description, price_aed, image, sort) values
    ('MAR-2025', 'Teddy',    'Graduation teddy bear in gown and cap', 50, '🧸', 1),
    ('MAR-2025', 'Bottle',   'Steel water bottle with the MDX crest',  20, '🧴', 2),
    ('MAR-2025', 'Keychain', 'Enamel keychain, Class of the season',   5, '🔑', 3),
    ('MAR-2025', 'Cup',      'Ceramic cup with the graduation logo',   10, '☕', 4);
  for i in 1..12 loop
    insert into programme_ceremony_map (season_id, programme, ceremony_number) values ('MAR-2025', progs[i], ((i - 1) / 3) + 1);
  end loop;
  perform create_season('OCT-2025', 'Oct 2025', 'MAR-2025', 'seed');
  perform create_season('MAR-2026', 'Mar 2026', 'OCT-2025', 'seed');
  perform create_season('OCT-2026', 'Oct 2026', 'MAR-2026', 'seed');
  perform set_season_status('MAR-2025', 'closed', 'seed');
  perform set_season_status('OCT-2025', 'closed', 'seed');
  perform set_season_status('MAR-2026', 'closed', 'seed');

  s := 'OCT-2026';
  update season_settings set sales_open = true, shop_close_date = date '2026-11-25',
         sales_window_text = 'Ticket sales are open until 20 November 2026.',
         public_notice = 'Children under 4 do not need a ticket or a seat.'
   where season_id = s;
  perform save_ceremony(s, 1, 'Ceremony 1 · Business',              timestamptz '2026-11-24 10:00+04', timestamptz '2026-11-24 08:30+04', 'Graduate entrance (North)', 'seed');
  perform save_ceremony(s, 2, 'Ceremony 2 · Science and Technology', timestamptz '2026-11-24 16:00+04', timestamptz '2026-11-24 14:30+04', 'Graduate entrance (North)', 'seed');
  perform save_ceremony(s, 3, 'Ceremony 3 · Psychology, Media and Law', timestamptz '2026-11-25 10:00+04', timestamptz '2026-11-25 08:30+04', 'Graduate entrance (North)', 'seed');
  perform save_ceremony(s, 4, 'Ceremony 4 · Postgraduate',          timestamptz '2026-11-25 16:00+04', timestamptz '2026-11-25 14:30+04', 'Graduate entrance (North)', 'seed');

  -- Staff in each role (the prototype's team list, plus a security officer)
  insert into staff (email, full_name, job_title, department, role, status) values
    ('r.nair@mdx.ac.ae',     'R. Nair',     'Finance Manager',       'Finance',                'Super Admin (Finance)',   'active'),
    ('a.sayed@mdx.ac.ae',    'A. Sayed',    'Marketing Manager',     'Marketing',              'Super Admin (Marketing)', 'active'),
    ('s.qureshi@mdx.ac.ae',  'S. Qureshi',  'Finance Officer',       'Finance',                'Finance',                 'active'),
    ('m.haidari@mdx.ac.ae',  'M. Haidari',  'Marketing Executive',   'Marketing',              'Marketing',               'active'),
    ('f.osman@mdx.ac.ae',    'F. Osman',    'DAR Officer',           'DAR and Campus Central', 'DAR and Campus Central',  'active'),
    ('t.rahman@mdx.ac.ae',   'T. Rahman',   'Intern',                'Marketing',              'Intern',                  'active'),
    ('j.mathew@mdx.ac.ae',   'J. Mathew',   'Events Coordinator',    'Events Team',            'Events Team',             'active'),
    ('k.joseph@mdx.ac.ae',   'K. Joseph',   'Security Officer',      'Security',               'Security',                'active'),
    ('f.akter@mdx.ac.ae',    'F. Akter',    'Technical Super Admin', 'IT',                     'Technical Super Admin',   'active')
  on conflict (email) do nothing;

  -- 100 fictional graduates
  for i in 1..100 loop
    m := case when i <= 7 then demo[i] else 'M00' || (100000 + i)::text end;
    prog := case when i <= 7 then progs[1 + (i % 3)] else progs[1 + (i % 12)] end;
    select ceremony_number into cer from programme_ceremony_map where season_id = s and programme = prog;
    confirmed := not (i = 5 or (i > 7 and i % 20 = 0));
    hold := (i = 4 or (i > 7 and i % 17 = 0));
    select id into cid from ceremonies where season_id = s and number = cer;
    insert into graduates (season_id, misis, email, mobile, full_name, programme, potential_graduate, confirmed_graduate,
                           finance_request_sent_at, ceremony_id, grad_seat_label)
    values (s, m, lower(m) || '@live.mdx.ac.uk', '+97150' || lpad((1000000 + i * 7919 % 9000000)::text, 7, '0'),
            firsts[1 + (i * 7) % 20] || ' ' || lasts[1 + (i * 3) % 10], prog, true, confirmed,
            case when confirmed and not hold then now() - interval '20 days' end,
            case when confirmed and not hold then cid end,
            case when confirmed and not hold then 'G' || cer || '-' || i end);
    if hold then
      perform place_hold(s, m, 'Outstanding tuition balance', 1250, 's.qureshi@mdx.ac.ae');
    end if;
  end loop;

  -- Demo cases from the prototype
  select id into zc from zones where season_id = s and code = 'C';
  select id into zb from zones where season_id = s and code = 'B';
  -- M00123456: 1 graduate + 1 guest, e-tickets issued
  r := book_order(s, 'M00123456', 'main', jsonb_build_array(jsonb_build_object('name', 'Sana Rahman', 'zone_id', zc)), null, 'student:M00123456');
  perform mark_order_paid((r->>'order_id')::uuid, 'online', 'SIM-DEMO-0001', 'seed');
  insert into payments (season_id, misis, order_id, channel, method, amount_aed, reference, recorded_by)
  values (s, 'M00123456', (r->>'order_id')::uuid, 'online', 'ccavenue', 700, 'SIM-DEMO-0001', 'seed');
  -- M00123458: 1 graduate + 2 guests, can buy 2 more
  r := book_order(s, 'M00123458', 'main', jsonb_build_array(
         jsonb_build_object('name', 'Rashid Patel', 'zone_id', zb),
         jsonb_build_object('name', 'Meera Patel', 'zone_id', zb)), null, 'student:M00123458');
  perform mark_order_paid((r->>'order_id')::uuid, 'online', 'SIM-DEMO-0002', 'seed');
  insert into payments (season_id, misis, order_id, channel, method, amount_aed, reference, recorded_by)
  values (s, 'M00123458', (r->>'order_id')::uuid, 'online', 'ccavenue', 1075, 'SIM-DEMO-0002', 'seed');
  -- M00123462: 1 graduate e-ticket, package collected
  r := book_order(s, 'M00123462', 'main', '[]'::jsonb, null, 'student:M00123462');
  perform mark_order_paid((r->>'order_id')::uuid, 'online', 'SIM-DEMO-0003', 'seed');
  insert into payments (season_id, misis, order_id, channel, method, amount_aed, reference, recorded_by)
  values (s, 'M00123462', (r->>'order_id')::uuid, 'online', 'ccavenue', 325, 'SIM-DEMO-0003', 'seed');
  perform set_package(s, 'M00123462', true, true, true, true, 't.rahman@mdx.ac.ae');
  -- M00987001: paid at the counter, graduate + 2 guests, zone and names still to choose (receipt RC482193)
  insert into receipts (receipt_number, season_id, misis, source, includes_graduate, guest_count, amount_aed, method, entered_by)
  values ('RC482193', s, 'M00987001', 'counter', true, 2, 1075, 'Card at Desk', 's.qureshi@mdx.ac.ae');
  insert into payments (season_id, misis, receipt_number, channel, method, amount_aed, reference, recorded_by)
  values (s, 'M00987001', 'RC482193', 'counter', 'Card at Desk', 1075, 'RC482193', 's.qureshi@mdx.ac.ae');
  -- A transfer request between two graduates of the same ceremony, waiting for Marketing
  m := (select g.misis from graduates g where g.season_id = s and g.ceremony_id = (select ceremony_id from graduates where season_id = s and misis = 'M00123458')
          and g.misis not in (select unnest(demo)) and g.confirmed_graduate order by g.misis limit 1);
  select id into t from tickets where season_id = s and misis = 'M00123458' and kind = 'guest' and holder_name = 'Meera Patel';
  perform request_transfer(s, 'M00123458', m, array[t], 'My cousin will sit with ' || m || '''s family.', 'student:M00123458');
  -- An extra ticket request and a name change request, waiting for Marketing
  perform request_extra_tickets(s, 'M00123456', 2, 'Grandparents travelling from abroad.', 'student:M00123456');
  select id into t from tickets where season_id = s and misis = 'M00123456' and kind = 'guest';
  perform request_name_change(s, 'M00123456', t, 'Sana R. Rahman', 'Name as on Emirates ID', 'student:M00123456');

  -- A few more paid bookings so the dashboard and Live Seating have numbers
  for i in 8..40 loop
    m := 'M00' || (100000 + i)::text;
    if eligibility(s, m) is null then
      r := book_order(s, m, 'main', (
             select jsonb_agg(jsonb_build_object('name', 'Guest ' || k || ' of ' || m,
                                                 'zone_id', (select id from zones where season_id = s and code = (array['A','B','C','D'])[1 + i % 4])))
               from generate_series(1, 1 + i % 4) k), null, 'student:' || m);
      if (r->>'ok')::boolean then
        perform mark_order_paid((r->>'order_id')::uuid, 'online', 'SIM-DEMO-' || i, 'seed');
        insert into payments (season_id, misis, order_id, channel, method, amount_aed, reference, recorded_by)
        values (s, m, (r->>'order_id')::uuid, 'online', 'ccavenue', (r->>'amount')::numeric, 'SIM-DEMO-' || i, 'seed');
      end if;
    end if;
  end loop;

  -- Merchandise: one online order paid, one counter order collected
  r := create_merch_order(s, 'M00123456', 'Sana Rahman', 'sana.rahman@example.com',
                          jsonb_build_array(jsonb_build_object('item_id', (select id from merch_items where season_id = s and name = 'Teddy'), 'qty', 1),
                                            jsonb_build_object('item_id', (select id from merch_items where season_id = s and name = 'Cup'), 'qty', 2)),
                          'online', null, 'public');
  perform record_payment('demo:merch1', 'ccavenue', 'merch', r->>'order_id', 'paid', 70, 'SIM-MERCH-1', '{}'::jsonb, 'seed');
  r := create_merch_order(s, 'M00123462', 'Bilal Khan', null,
                          jsonb_build_array(jsonb_build_object('item_id', (select id from merch_items where season_id = s and name = 'Keychain'), 'qty', 3)),
                          'counter', 'Cash', 's.qureshi@mdx.ac.ae');
  perform mark_collected((r->>'order_id')::uuid, 'm.haidari@mdx.ac.ae');
end $$;
