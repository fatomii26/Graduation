-- Permission keys and role presets (needed in every environment, including production)

insert into permissions (key, label, grp, sort) values
  ('view_dashboard',          'Dashboard',                                    'General',        10),
  ('master_list',             'Master List',                                  'General',        20),
  ('finance_entry',           'Finance Entry',                                'Finance',        30),
  ('financial_hold',          'Financial Hold',                               'Finance',        40),
  ('reconciliation',          'Reconciliation',                               'Finance',        50),
  ('graduation_day_payments', 'Graduation Day Payments',                      'Finance',        60),
  ('view_revenue',            'Revenue figures',                              'Revenue',        70),
  ('tickets_seating',         'E-Tickets and Seating',                        'Marketing',      80),
  ('transfer_approve',        'Approve transfers and name changes',           'Marketing',      90),
  ('layout_edit',             'Edit Hall Layout and Venue',                   'Marketing',     100),
  ('live_seating',            'Live Seating',                                 'Marketing',     110),
  ('entry_checkin',           'Entry Check-In',                               'Marketing',     120),
  ('package_collection',      'Package Collection',                           'Marketing',     130),
  ('merchandise',             'Merchandise',                                  'Marketing',     140),
  ('extra_tickets',           'Extra Tickets (view)',                         'Marketing',     150),
  ('extra_tickets_approve',   'Approve extra tickets',                        'Marketing',     160),
  ('lost_ticket',             'Lost Ticket resend',                           'Marketing',     170),
  ('scanner',                 'Scanner',                                      'Door',          180),
  ('potential_graduates',     'Potential Graduates',                          'DAR',           190),
  ('ceremony_allocation',     'Ceremony allocation',                          'DAR',           200),
  ('programme_map',           'Programme to Ceremony Map',                    'DAR',           210),
  ('user_access',             'User Access',                                  'Administration', 220),
  ('seasons',                 'Graduation Seasons and reminders',             'Administration', 230),
  ('prices',                  'Ticket Prices, Limits and Merchandise Items',  'Administration', 240),
  ('version_changes',         'Version Changes',                              'Administration', 250),
  ('tech_admin',              'Technical Settings',                           'Administration', 260);

insert into roles (name, description, sort) values
  ('Super Admin (Finance)',    'Everything except Technical Settings, including revenue', 10),
  ('Super Admin (Marketing)',  'Everything except Technical Settings and revenue', 20),
  ('Technical Super Admin',    'Technical Settings, User Access, Version Changes and all operational pages', 30),
  ('Finance',                  'Finance Entry, Financial Hold, Reconciliation, Graduation Day Payments, Merchandise, revenue', 40),
  ('Marketing',                'Tickets and zones, transfers, Live Seating, Entry Check-In, packages, merchandise, extra tickets', 50),
  ('Events Team',              'E-Tickets and Seating including Hall Layout, Live Seating, Entry Check-In', 60),
  ('DAR and Campus Central',   'Ceremony allocation, Potential Graduates, financial hold list, programme map, Master List', 70),
  ('Security',                 'Scanner and Live Seating', 80),
  ('Intern',                   'Package Collection, Entry Check-In, E-Tickets (view and Lost Ticket), Extra Tickets (view)', 90);

insert into role_permissions (role, permission)
select 'Super Admin (Finance)', key from permissions where key <> 'tech_admin';

insert into role_permissions (role, permission)
select 'Super Admin (Marketing)', key from permissions where key not in ('tech_admin', 'view_revenue');

insert into role_permissions (role, permission)
select 'Technical Super Admin', key from permissions where key <> 'view_revenue';

insert into role_permissions (role, permission)
select 'Finance', unnest(array['view_dashboard', 'master_list', 'finance_entry', 'financial_hold', 'reconciliation',
                               'graduation_day_payments', 'view_revenue', 'merchandise']);

insert into role_permissions (role, permission)
select 'Marketing', unnest(array['view_dashboard', 'master_list', 'tickets_seating', 'transfer_approve', 'live_seating', 'entry_checkin',
                                 'package_collection', 'merchandise', 'extra_tickets', 'extra_tickets_approve', 'lost_ticket']);

insert into role_permissions (role, permission)
select 'Events Team', unnest(array['view_dashboard', 'tickets_seating', 'layout_edit', 'live_seating', 'entry_checkin']);

insert into role_permissions (role, permission)
select 'DAR and Campus Central', unnest(array['view_dashboard', 'master_list', 'potential_graduates', 'ceremony_allocation', 'programme_map']);

insert into role_permissions (role, permission)
select 'Security', unnest(array['scanner', 'live_seating']);

insert into role_permissions (role, permission)
select 'Intern', unnest(array['package_collection', 'entry_checkin', 'tickets_seating', 'lost_ticket', 'extra_tickets']);
