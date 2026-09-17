-- Demo data for job-shop-for-claude-code.
-- Matai Engineering, a fictional Hamilton fabrication and machining shop:
-- 6 staff, 12 customers, 5 suppliers, 5 work centres, 17 stock items, 16 jobs
-- from quote to closed, purchase orders, and five invoices.
--
-- Deliberately messy, so the attention list has something to say:
--   a length of SHS issued to the structural mezzanine job with NO heat number
--   the press brake 100+ days past its 6-monthly service
--   the stainless platform job at 82% of its fixed quote, unfinished, 3 days late
--   the hydraladder repair silent on the floor for 10 days
--   the barn door job complete 12 days with nothing drafted ($9,200 asleep)
--   the shade structure job short 4 sheets of 10mm plate, promised in 12 days
--   the galvanising purchase order 9 days overdue, holding the mezzanine job
--   MIG wire through its reorder level with nothing on order
--   INV-3001 ($18,400) 25 days overdue, INV-3002 40 days overdue, and a council
--     draft that never went out, invoiced as construction work with no payment claim
--   a $2,150 retention due back 14 days ago and never claimed
--   Waikato Dairy over its $20,000 limit, owing five figures, with no PPSR
--     registration behind the retention-of-title terms
--   Marcus with no time booked for 5 days while the floor is busy
--   the arena harrow quote out 20 days and never chased
--   Frankton Freight on stop with a job on hold, and a task past its date
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Rates and names are DEMO VALUES for a fictional company. No real business
-- or person is depicted, and nothing here is legal or safety advice.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Staff -----------------------------------------------------------------------

insert into staff (id, full_name, code, email, phone, role, cost_rate_cents, charge_rate_cents, weekly_hours, active) values
  (seed_uuid('staff:grant'),  'Grant Sowman',  'GS', 'grant@mataieng.example.nz',  '07 555 0401', 'manager',      6500, 12500, 40, true),
  (seed_uuid('staff:priya'),  'Priya Nair',    'PN', 'priya@mataieng.example.nz',  '07 555 0402', 'estimator',    5500, 11000, 40, true),
  (seed_uuid('staff:tama'),   'Tama Walker',   'TW', 'tama@mataieng.example.nz',   '021 555 403', 'tradesperson', 4200,  9500, 40, true),
  (seed_uuid('staff:dylan'),  'Dylan Reece',   'DR', 'dylan@mataieng.example.nz',  '021 555 404', 'tradesperson', 4500, 10500, 40, true),
  (seed_uuid('staff:marcus'), 'Marcus Fifita', 'MF', 'marcus@mataieng.example.nz', '021 555 405', 'tradesperson', 4000,  9500, 40, true),
  (seed_uuid('staff:lena'),   'Lena Hovell',   'LH', 'lena@mataieng.example.nz',   '07 555 0406', 'storeman',     3200,  7000, 30, true)
on conflict do nothing;

-- Customers -------------------------------------------------------------------

insert into customers (id, name, code, account_type, contact_name, email, phone, city, terms_days, credit_limit_cents, on_stop, ppsr_registered_on, status, note, external_ref) values
  (seed_uuid('cust:waikatodairy'), 'Waikato Dairy Services Ltd',     'WDS001', 'trade',    'Karen Mulder', 'accounts@waikatodairy.example.nz', '07 555 0501', 'Hamilton',    20, 2000000, false, null,               'active', null, 'OS-C001'),
  (seed_uuid('cust:kahu'),         'Kahu Structural Builders Ltd',   'KSB001', 'trade',    'Mere Kingi',   'office@kahustructural.example.nz', '07 555 0502', 'Te Rapa',     20, 6000000, false, current_date - 200, 'active', null, 'OS-C002'),
  (seed_uuid('cust:rototuna'),     'Rototuna Transport Ltd',         'RTT001', 'trade',    'Baz Whitford', 'baz@rototunatransport.example.nz', '021 555 503', 'Rototuna',    20, 1500000, false, current_date - 300, 'active', null, 'OS-C003'),
  (seed_uuid('cust:council'),      'Hamilton City Council',          'HCC001', 'trade',    'Alice Zhou',   'ap@hamiltoncity.example.nz',       '07 555 0504', 'Hamilton',    30, null,    false, null,               'active', null, 'OS-C004'),
  (seed_uuid('cust:southbridge'),  'Southbridge Sheds & Barns Ltd',  'SSB001', 'trade',    'Piet Muller',  'piet@southbridgesheds.example.nz', '07 555 0505', 'Cambridge',   20, 1000000, false, null,               'active', null, 'OS-C005'),
  (seed_uuid('cust:piako'),        'Piako Orchard Machinery Ltd',    'POM001', 'trade',    'Hemi Turner',  'hemi@piakoorchard.example.nz',     '021 555 506', 'Morrinsville',20,  800000, false, null,               'active', null, 'OS-C006'),
  (seed_uuid('cust:frankton'),     'Frankton Freight Ltd',           'FFL001', 'trade',    'Gary Sole',    'gary@franktonfreight.example.nz',  '07 555 0507', 'Frankton',    20, null,    true,  null,               'active', 'On stop until the June account settles.', 'OS-C007'),
  (seed_uuid('cust:cambridge'),    'Cambridge Equine Arenas Ltd',    'CEA001', 'trade',    'Sophie Lang',  'sophie@cambridgeequine.example.nz','07 555 0508', 'Cambridge',   20,  500000, false, null,               'active', null, 'OS-C008'),
  (seed_uuid('cust:anchor'),       'Anchor Marine Ltd',              'ANM001', 'trade',    'Dion Paki',    'dion@anchormarine.example.nz',     '07 555 0509', 'Raglan',      20,  600000, false, null,               'active', null, 'OS-C009'),
  (seed_uuid('cust:cootes'),       'Ray Cootes',                     'RAY001', 'consumer', 'Ray Cootes',   'r.cootes@example.nz',              '021 555 510', 'Dinsdale',     7, null,    false, null,               'active', null, 'OS-C010'),
  (seed_uuid('cust:teawamutu'),    'Te Awamutu Water Services Ltd',  'TAW001', 'trade',    'Nga Parata',   'nga@tawater.example.nz',           '07 555 0511', 'Te Awamutu',  20,  600000, false, null,               'active', null, 'OS-C011'),
  (seed_uuid('cust:kirikiriroa'),  'Kirikiriroa Property Group Ltd', 'KPG001', 'trade',    'Sam Beattie',  'sam@kpgproperty.example.nz',       '07 555 0512', 'Hamilton',    20, 1000000, false, null,               'active', null, 'OS-C012')
on conflict do nothing;

-- Suppliers -------------------------------------------------------------------

insert into suppliers (id, name, code, contact_name, email, phone, lead_time_days, external_ref) values
  (seed_uuid('sup:waikatosteel'), 'Waikato Steel Supplies Ltd',   'WSS', 'Dean Corbett', 'sales@waikatosteel.example.nz', '07 555 0601', 3, 'OS-S001'),
  (seed_uuid('sup:galv'),         'Galv Services BOP Ltd',        'GAL', 'Ana Malielegaoi', 'jobs@galvbop.example.nz',    '07 555 0602', 7, 'OS-S002'),
  (seed_uuid('sup:laser'),        'Precision Laser Cut Ltd',      'PLC', 'Josh Barry',   'quotes@precisionlaser.example.nz', '07 555 0603', 5, 'OS-S003'),
  (seed_uuid('sup:fasteners'),    'Industrial Fasteners NZ Ltd',  'IFN', 'Kim Ludlow',   'orders@indfasteners.example.nz', '0800 555 604', 2, 'OS-S004'),
  (seed_uuid('sup:bearings'),     'Bay Bearings & Drives Ltd',    'BBD', 'Stu Hape',     'stu@baybearings.example.nz',    '07 555 0605', 2, 'OS-S005')
on conflict do nothing;

-- Work centres ------------------------------------------------------------------
-- The press brake is 100+ days past its 6-monthly service: a deliberate breach.

insert into work_centres (id, code, name, weekly_capacity_hours, last_service_on, service_interval_months, note, external_ref) values
  (seed_uuid('wc:saw'), 'SAW', 'Saw and prep',              40, current_date - 60,  6, null, 'OS-W001'),
  (seed_uuid('wc:mch'), 'MCH', 'Machine shop',              45, current_date - 90,  6, 'Lathe, mill and drill line.', 'OS-W002'),
  (seed_uuid('wc:brk'), 'BRK', 'Press brake',               40, current_date - 285, 6, 'Guarding checked at each service.', 'OS-W003'),
  (seed_uuid('wc:wld'), 'WLD', 'Welding bays',              80, current_date - 45,  6, 'Two bays, MIG and TIG.', 'OS-W004'),
  (seed_uuid('wc:pnt'), 'PNT', 'Blast and paint',           40, current_date - 30,  6, null, 'OS-W005')
on conflict do nothing;

-- Items: the shelf -----------------------------------------------------------------

insert into items (id, code, description, kind, unit, on_hand, reorder_level, reorder_qty, unit_cost_cents, sell_cents, traceable, preferred_supplier_id, external_ref) values
  (seed_uuid('item:ub200'),   'UB-200',    '200UB25 universal beam',        'material',  'm',     18,  6, 24,  5200,  8300, true,  seed_uuid('sup:waikatosteel'), 'OS-I001'),
  (seed_uuid('item:shs100'),  'SHS-100',   '100x100x5 SHS',                 'material',  'm',     36,  6, 48,  3800,  6100, true,  seed_uuid('sup:waikatosteel'), 'OS-I002'),
  (seed_uuid('item:pfc150'),  'PFC-150',   '150PFC channel',                'material',  'm',     24,  4, 24,  3300,  5300, true,  seed_uuid('sup:waikatosteel'), 'OS-I003'),
  (seed_uuid('item:rhs50'),   'RHS-50',    '50x25x2.5 RHS',                 'material',  'm',    120, 20, 60,  1450,  2400, true,  seed_uuid('sup:waikatosteel'), 'OS-I004'),
  (seed_uuid('item:fl50'),    'FL-50',     '50x6 flat bar',                 'material',  'm',     85, 15, 60,   900,  1600, true,  seed_uuid('sup:waikatosteel'), 'OS-I005'),
  (seed_uuid('item:pl10'),    'PL-10',     '10mm plate 2.4x1.2',            'material',  'sheet',  2,  2,  6, 31000, 48000, true,  seed_uuid('sup:waikatosteel'), 'OS-I006'),
  (seed_uuid('item:pl6'),     'PL-6',      '6mm plate 2.4x1.2',             'material',  'sheet',  9,  3,  6, 26500, 42000, true,  seed_uuid('sup:waikatosteel'), 'OS-I007'),
  (seed_uuid('item:pls3'),    'PL-S3',     '3mm 304 stainless sheet 2.4x1.2','material', 'sheet',  6,  2,  8, 42000, 63000, true,  seed_uuid('sup:waikatosteel'), 'OS-I008'),
  (seed_uuid('item:brg6205'), 'BRG-6205',  '6205 sealed bearing',           'bought-in', 'ea',     6,  2, 10,  4800,  7200, false, seed_uuid('sup:bearings'),     'OS-I009'),
  (seed_uuid('item:mtr3kw'),  'MTR-3KW',   '3kW 3-phase motor',             'bought-in', 'ea',     1,  0,  1, 68000, 99000, false, seed_uuid('sup:bearings'),     'OS-I010'),
  (seed_uuid('item:hnghd'),   'HNG-HD',    'Heavy duty door hinge',         'bought-in', 'ea',    10,  4, 24,  3400,  5500, false, seed_uuid('sup:fasteners'),    'OS-I011'),
  (seed_uuid('item:cast150'), 'CAST-150',  '150mm swivel castor',           'bought-in', 'ea',     8,  2,  8,  5600,  8900, false, seed_uuid('sup:bearings'),     'OS-I012'),
  (seed_uuid('item:boltm16'), 'BOLT-M16',  'M16 galv structural bolt kit',  'bought-in', 'ea',    30,  5, 40,  2600,  4100, false, seed_uuid('sup:fasteners'),    'OS-I013'),
  (seed_uuid('item:wire09'),  'WIRE-09',   '0.9mm MIG wire 15kg spool',     'consumable','ea',     2,  6, 12, 12500, 18500, false, seed_uuid('sup:waikatosteel'), 'OS-I014'),
  (seed_uuid('item:disc125'), 'DISC-125',  '125mm cutting disc',            'consumable','ea',    40, 15, 50,   320,   600, false, seed_uuid('sup:fasteners'),    'OS-I015'),
  (seed_uuid('item:paintepx'),'PAINT-EPX', 'Epoxy primer',                  'consumable','l',     18,  5, 20,  9800, 14500, false, seed_uuid('sup:waikatosteel'), 'OS-I016'),
  (seed_uuid('item:gasarg'),  'GAS-ARG',   'Argoshield bottle swap',        'consumable','ea',     3,  1,  4, 15500, 22000, false, seed_uuid('sup:waikatosteel'), 'OS-I017')
on conflict do nothing;

-- Jobs -----------------------------------------------------------------------------

insert into jobs (id, ref, customer_id, title, description, status, charge_basis, quoted_cents, quoted_on, won_on, started_on, promised_on, completed_on, closed_on, po_number, structural, construction_work, estimator_id, lost_reason, note, external_ref) values
  (seed_uuid('job:1200'), 'J-1200', seed_uuid('cust:kahu'),        'Mezzanine floor steelwork, Te Rapa warehouse', 'Beams, posts and stair, hot dip galvanised, site bolted.', 'in-progress', 'fixed', 4850000, current_date - 40, current_date - 32, current_date - 25, current_date + 10, null, null, 'KSB-8804', true,  true,  seed_uuid('staff:priya'), null, null, 'OS-J1200'),
  (seed_uuid('job:1201'), 'J-1201', seed_uuid('cust:waikatodairy'),'Stainless platform and walkway, milk plant',   'Grade 304 platform, treads and handrails to plant room.',  'in-progress', 'fixed', 2400000, current_date - 50, current_date - 42, current_date - 30, current_date - 3,  null, null, 'WDS-3301', false, false, seed_uuid('staff:priya'), null, 'Access windows are tight: plant washdown 11am to 1pm daily.', 'OS-J1201'),
  (seed_uuid('job:1202'), 'J-1202', seed_uuid('cust:rototuna'),    'Truck deck rebuild, unit 14',                  'Strip, re-sheet and box the deck. Charge as it runs.',     'in-progress', 'time-and-materials', null, current_date - 12, current_date - 10, current_date - 6, current_date + 9, null, null, 'RTT-118', false, false, seed_uuid('staff:grant'), null, null, 'OS-J1202'),
  (seed_uuid('job:1203'), 'J-1203', seed_uuid('cust:council'),     'Playground shade structure frames x3',         'Powder coated frames, footing cages by others.',           'accepted',    'fixed', 1680000, current_date - 15, current_date - 8,  null, current_date + 12, null, null, 'HCC-77521', true, true,  seed_uuid('staff:priya'), null, null, 'OS-J1203'),
  (seed_uuid('job:1204'), 'J-1204', seed_uuid('cust:southbridge'), 'Barn door sets x6',                            'Sliding door frames and tracks, primed.',                  'complete',    'fixed',  920000, current_date - 35, current_date - 30, current_date - 24, current_date - 14, current_date - 12, null, 'SSB-51', false, false, seed_uuid('staff:grant'), null, null, 'OS-J1204'),
  (seed_uuid('job:1205'), 'J-1205', seed_uuid('cust:piako'),       'Hydraladder chassis repairs',                  'Crack repairs and new castor mounts. Charge as it runs.',  'in-progress', 'time-and-materials', null, current_date - 20, current_date - 18, current_date - 14, current_date + 30, null, null, null, false, false, seed_uuid('staff:grant'), null, null, 'OS-J1205'),
  (seed_uuid('job:1206'), 'J-1206', seed_uuid('cust:frankton'),    'Container ramp',                               'Folded plate ramp with kerbs.',                             'on-hold',     'fixed',  740000, current_date - 28, current_date - 24, null, current_date + 14, null, null, null, false, false, seed_uuid('staff:priya'), null, 'On hold: account went on stop before the steel was cut.', 'OS-J1206'),
  (seed_uuid('job:1207'), 'J-1207', seed_uuid('cust:cootes'),      'Tandem trailer build',                         '2.7t tandem, cage sides, LED kit.',                         'in-progress', 'fixed',  680000, current_date - 18, current_date - 15, current_date - 9, current_date + 14, null, null, null, false, false, seed_uuid('staff:grant'), null, null, 'OS-J1207'),
  (seed_uuid('job:1208'), 'J-1208', seed_uuid('cust:cambridge'),   'Arena harrow frames x2',                       'Folded frame, tine mounts, zinc primer.',                   'quote',       'fixed',  590000, current_date - 20, null, null, null, null, null, null, false, false, seed_uuid('staff:priya'), null, null, 'OS-J1208'),
  (seed_uuid('job:1209'), 'J-1209', seed_uuid('cust:anchor'),      'Alloy fuel tanks x2',                          'Baffled 120L tanks to survey drawing.',                     'quote',       'fixed',  430000, current_date - 6,  null, null, null, null, null, null, false, false, seed_uuid('staff:priya'), null, null, 'OS-J1209'),
  (seed_uuid('job:1210'), 'J-1210', seed_uuid('cust:waikatodairy'),'Platform handrails stage 2',                   'Handrail run to match stage 1.',                            'quote',       'fixed',  890000, current_date - 3,  null, null, null, null, null, null, false, false, seed_uuid('staff:priya'), null, null, 'OS-J1210'),
  (seed_uuid('job:1211'), 'J-1211', seed_uuid('cust:kahu'),        'Stair stringers, Rotokauri site',              'Stringers and landing frames, galvanised.',                 'closed',      'fixed', 2150000, current_date - 100, current_date - 95, current_date - 88, current_date - 70, current_date - 68, current_date - 55, 'KSB-8721', true, true, seed_uuid('staff:priya'), null, null, 'OS-J1211'),
  (seed_uuid('job:1212'), 'J-1212', seed_uuid('cust:rototuna'),    'Drawbar recertification and repair',           'Crack test, gusset and recert.',                            'closed',      'time-and-materials', null, current_date - 70, current_date - 68, current_date - 66, current_date - 60, current_date - 62, current_date - 58, 'RTT-102', false, false, seed_uuid('staff:grant'), null, null, 'OS-J1212'),
  (seed_uuid('job:1213'), 'J-1213', seed_uuid('cust:council'),     'Street bollards x18',                          'Fabricate and install bollards, CBD upgrade.',              'closed',      'fixed',  520000, current_date - 30, current_date - 26, current_date - 22, current_date - 15, current_date - 14, current_date - 12, 'HCC-77102', false, true, seed_uuid('staff:grant'), null, null, 'OS-J1213'),
  (seed_uuid('job:1214'), 'J-1214', seed_uuid('cust:teawamutu'),   'Silo ladder cages x2',                         'Cages and hoops to drawing.',                               'lost',        'fixed',  310000, current_date - 25, null, null, null, null, null, null, false, false, seed_uuid('staff:priya'), 'Lost on price to an Auckland shop.', null, 'OS-J1214'),
  (seed_uuid('job:1215'), 'J-1215', seed_uuid('cust:waikatodairy'),'Milk tanker gantry',                           'Access gantry over the load-out bay.',                      'closed',      'fixed', 1840000, current_date - 80, current_date - 75, current_date - 70, current_date - 50, current_date - 48, current_date - 45, 'WDS-3188', true, false, seed_uuid('staff:priya'), null, null, 'OS-J1215')
on conflict do nothing;

-- Planned materials ------------------------------------------------------------------

insert into job_lines (id, job_id, item_id, qty_planned, unit_cost_cents, sell_cents, note) values
  (seed_uuid('jl:1200-ub'),   seed_uuid('job:1200'), seed_uuid('item:ub200'),   30, 5200,  8300, null),
  (seed_uuid('jl:1200-pl10'), seed_uuid('job:1200'), seed_uuid('item:pl10'),     2, 31000, 48000, 'Base plates.'),
  (seed_uuid('jl:1200-shs'),  seed_uuid('job:1200'), seed_uuid('item:shs100'),  12, 3800,  6100, 'Posts.'),
  (seed_uuid('jl:1200-bolt'), seed_uuid('job:1200'), seed_uuid('item:boltm16'), 10, 2600,  4100, 'Site bolts.'),
  (seed_uuid('jl:1201-pls3'), seed_uuid('job:1201'), seed_uuid('item:pls3'),    24, 42000, 63000, null),
  (seed_uuid('jl:1201-shs'),  seed_uuid('job:1201'), seed_uuid('item:shs100'),  40, 3800,  6100, null),
  (seed_uuid('jl:1203-pl10'), seed_uuid('job:1203'), seed_uuid('item:pl10'),     6, 31000, 48000, 'Gusset and cap plates.'),
  (seed_uuid('jl:1203-rhs'),  seed_uuid('job:1203'), seed_uuid('item:rhs50'),   40, 1450,  2400, null),
  (seed_uuid('jl:1205-cast'), seed_uuid('job:1205'), seed_uuid('item:cast150'),  4, 5600,  8900, null),
  (seed_uuid('jl:1206-pfc'),  seed_uuid('job:1206'), seed_uuid('item:pfc150'),  18, 3300,  5300, null),
  (seed_uuid('jl:1207-rhs'),  seed_uuid('job:1207'), seed_uuid('item:rhs50'),   30, 1450,  2400, null),
  (seed_uuid('jl:1207-fl'),   seed_uuid('job:1207'), seed_uuid('item:fl50'),    10, 900,   1600, null)
on conflict do nothing;

-- Issues: stock drawn onto jobs --------------------------------------------------------
-- The SHS onto the structural mezzanine job carries NO heat number: deliberate.

insert into issues (id, job_id, item_id, qty, unit_cost_cents, sell_cents, heat_no, issued_on, issued_by, note) values
  (seed_uuid('iss:1200-ub'),   seed_uuid('job:1200'), seed_uuid('item:ub200'),   30, 5200,  8300, 'H2288-04', current_date - 6, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1200-pl10'), seed_uuid('job:1200'), seed_uuid('item:pl10'),     2, 31000, 48000, 'C7741-2', current_date - 4, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1200-shs'),  seed_uuid('job:1200'), seed_uuid('item:shs100'),  12, 3800,  6100, null,       current_date - 2, seed_uuid('staff:tama'), 'Grabbed off the rack on the Saturday. Cert not recorded.'),
  (seed_uuid('iss:1201-pls3'), seed_uuid('job:1201'), seed_uuid('item:pls3'),    22, 42000, 63000, null,      current_date - 15, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1201-shs'),  seed_uuid('job:1201'), seed_uuid('item:shs100'),  40, 3800,  6100, null,       current_date - 20, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1202-fl'),   seed_uuid('job:1202'), seed_uuid('item:fl50'),    12, 900,   1600, null,       current_date - 4, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1202-brg'),  seed_uuid('job:1202'), seed_uuid('item:brg6205'),  2, 4800,  7200, null,       current_date - 4, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1204-hng'),  seed_uuid('job:1204'), seed_uuid('item:hnghd'),   24, 3400,  5500, null,       current_date - 20, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1204-rhs'),  seed_uuid('job:1204'), seed_uuid('item:rhs50'),   60, 1450,  2400, null,       current_date - 20, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1204-pl6'),  seed_uuid('job:1204'), seed_uuid('item:pl6'),      2, 26500, 42000, null,      current_date - 18, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1205-cast'), seed_uuid('job:1205'), seed_uuid('item:cast150'),  4, 5600,  8900, null,       current_date - 12, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1207-rhs'),  seed_uuid('job:1207'), seed_uuid('item:rhs50'),   28, 1450,  2400, null,       current_date - 8, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1207-fl'),   seed_uuid('job:1207'), seed_uuid('item:fl50'),     8, 900,   1600, null,       current_date - 8, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1215-pl6'),  seed_uuid('job:1215'), seed_uuid('item:pl6'),      4, 26500, 42000, 'B6650-1', current_date - 65, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1215-ub'),   seed_uuid('job:1215'), seed_uuid('item:ub200'),   20, 5200,  8300, 'H1975-11', current_date - 65, seed_uuid('staff:lena'), null),
  (seed_uuid('iss:1211-shs'),  seed_uuid('job:1211'), seed_uuid('item:shs100'),  30, 3800,  6100, 'H2011-07', current_date - 85, seed_uuid('staff:lena'), null)
on conflict do nothing;

-- Time -------------------------------------------------------------------------------
-- Marcus's last booking is 5 days old: the deliberate timesheet gap.

insert into time_entries (id, job_id, staff_id, work_centre_id, worked_on, hours, cost_rate_cents, charge_rate_cents, note) values
  -- Stainless platform: the quote is nearly eaten.
  (seed_uuid('te:1201-t1'), seed_uuid('job:1201'), seed_uuid('staff:tama'),   seed_uuid('wc:wld'), current_date - 24, 38, 4200, 9500, 'Week total.'),
  (seed_uuid('te:1201-t2'), seed_uuid('job:1201'), seed_uuid('staff:tama'),   seed_uuid('wc:wld'), current_date - 17, 40, 4200, 9500, 'Week total.'),
  (seed_uuid('te:1201-t3'), seed_uuid('job:1201'), seed_uuid('staff:tama'),   seed_uuid('wc:wld'), current_date - 6,   8, 4200, 9500, null),
  (seed_uuid('te:1201-t4'), seed_uuid('job:1201'), seed_uuid('staff:tama'),   seed_uuid('wc:wld'), current_date - 5,   4, 4200, 9500, null),
  (seed_uuid('te:1201-m1'), seed_uuid('job:1201'), seed_uuid('staff:marcus'), seed_uuid('wc:wld'), current_date - 24, 40, 4000, 9500, 'Week total.'),
  (seed_uuid('te:1201-m2'), seed_uuid('job:1201'), seed_uuid('staff:marcus'), seed_uuid('wc:wld'), current_date - 12, 24, 4000, 9500, 'Week total.'),
  (seed_uuid('te:1201-m3'), seed_uuid('job:1201'), seed_uuid('staff:marcus'), seed_uuid('wc:wld'), current_date - 5,   6, 4000, 9500, null),
  -- Mezzanine.
  (seed_uuid('te:1200-t1'), seed_uuid('job:1200'), seed_uuid('staff:tama'),   seed_uuid('wc:wld'), current_date - 3,   8, 4200, 9500, null),
  (seed_uuid('te:1200-t2'), seed_uuid('job:1200'), seed_uuid('staff:tama'),   seed_uuid('wc:wld'), current_date - 2,   8, 4200, 9500, null),
  (seed_uuid('te:1200-d1'), seed_uuid('job:1200'), seed_uuid('staff:dylan'),  seed_uuid('wc:mch'), current_date - 2,   4, 4500, 10500, 'Base plate drilling.'),
  -- Truck deck, T and M.
  (seed_uuid('te:1202-d1'), seed_uuid('job:1202'), seed_uuid('staff:dylan'),  seed_uuid('wc:mch'), current_date - 4,   8, 4500, 10500, null),
  (seed_uuid('te:1202-d2'), seed_uuid('job:1202'), seed_uuid('staff:dylan'),  seed_uuid('wc:mch'), current_date - 1,   6, 4500, 10500, null),
  -- Hydraladder: stalled 10 days.
  (seed_uuid('te:1205-d1'), seed_uuid('job:1205'), seed_uuid('staff:dylan'),  seed_uuid('wc:mch'), current_date - 10,  5, 4500, 10500, null),
  -- Trailer.
  (seed_uuid('te:1207-m1'), seed_uuid('job:1207'), seed_uuid('staff:marcus'), seed_uuid('wc:wld'), current_date - 8,  12, 4000, 9500, null),
  (seed_uuid('te:1207-d1'), seed_uuid('job:1207'), seed_uuid('staff:dylan'),  seed_uuid('wc:mch'), current_date - 3,   4, 4500, 10500, 'Axle machining.'),
  -- Barn doors, complete.
  (seed_uuid('te:1204-m1'), seed_uuid('job:1204'), seed_uuid('staff:marcus'), seed_uuid('wc:brk'), current_date - 20, 30, 4000, 9500, 'Week total.'),
  (seed_uuid('te:1204-t1'), seed_uuid('job:1204'), seed_uuid('staff:tama'),   seed_uuid('wc:wld'), current_date - 20, 25, 4200, 9500, 'Week total.'),
  -- Closed jobs, for the history.
  (seed_uuid('te:1215-t1'), seed_uuid('job:1215'), seed_uuid('staff:tama'),   seed_uuid('wc:wld'), current_date - 60, 60, 4200, 9500, 'Job total.'),
  (seed_uuid('te:1211-m1'), seed_uuid('job:1211'), seed_uuid('staff:marcus'), seed_uuid('wc:wld'), current_date - 80, 55, 4000, 9500, 'Job total.'),
  (seed_uuid('te:1212-d1'), seed_uuid('job:1212'), seed_uuid('staff:dylan'),  seed_uuid('wc:mch'), current_date - 63,  9, 4500, 10500, 'Job total.'),
  (seed_uuid('te:1213-m1'), seed_uuid('job:1213'), seed_uuid('staff:marcus'), seed_uuid('wc:wld'), current_date - 18, 20, 4000, 9500, 'Job total.')
on conflict do nothing;

-- Purchase orders -----------------------------------------------------------------------

insert into purchase_orders (id, ref, supplier_id, job_id, status, ordered_on, expected_on, received_on, note, external_ref) values
  (seed_uuid('po:500'), 'PO-500', seed_uuid('sup:waikatosteel'), null,                  'open',     current_date - 3,  current_date + 5,  null, '10mm plate for the shade structures.', 'OS-P500'),
  (seed_uuid('po:501'), 'PO-501', seed_uuid('sup:galv'),         seed_uuid('job:1200'), 'open',     current_date - 16, current_date - 9,  null, 'Hot dip galvanising, mezzanine steel.', 'OS-P501'),
  (seed_uuid('po:502'), 'PO-502', seed_uuid('sup:laser'),        seed_uuid('job:1201'), 'received', current_date - 20, current_date - 13, current_date - 12, 'Laser cut treads and brackets.', 'OS-P502'),
  (seed_uuid('po:503'), 'PO-503', seed_uuid('sup:fasteners'),    null,                  'received', current_date - 32, current_date - 30, current_date - 30, null, 'OS-P503')
on conflict do nothing;

insert into po_lines (id, po_id, item_id, description, qty, unit_cost_cents) values
  (seed_uuid('pol:500-pl10'), seed_uuid('po:500'), seed_uuid('item:pl10'),   '10mm plate 2.4x1.2',                      8, 30500),
  (seed_uuid('pol:501-galv'), seed_uuid('po:501'), null,                     'Hot dip galvanising, mezzanine steelwork', 1, 180000),
  (seed_uuid('pol:502-lsr'),  seed_uuid('po:502'), null,                     'Laser cut stainless treads and brackets',  1, 240000),
  (seed_uuid('pol:503-bolt'), seed_uuid('po:503'), seed_uuid('item:boltm16'),'M16 galv structural bolt kit',            20, 2600)
on conflict do nothing;

-- Invoices --------------------------------------------------------------------------------

insert into invoices (id, number, job_id, customer_id, issued_on, due_on, total_cents, payment_claim, retention_cents, retention_due_on, retention_received_on, status, sent_on, paid_on, note) values
  (seed_uuid('inv:3001'), 'INV-3001', seed_uuid('job:1215'), seed_uuid('cust:waikatodairy'), current_date - 45, current_date - 25, 1840000, false, 0,      null,               null, 'sent',  current_date - 45, null, 'Milk tanker gantry, final.'),
  (seed_uuid('inv:3002'), 'INV-3002', seed_uuid('job:1212'), seed_uuid('cust:rototuna'),     current_date - 60, current_date - 40,  390000, false, 0,      null,               null, 'sent',  current_date - 60, null, null),
  (seed_uuid('inv:3003'), 'INV-3003', seed_uuid('job:1213'), seed_uuid('cust:council'),      current_date - 12, current_date + 18,  520000, false, 0,      null,               null, 'draft', null, null, 'Drafted at completion and never sent.'),
  (seed_uuid('inv:3004'), 'INV-3004', seed_uuid('job:1200'), seed_uuid('cust:kahu'),         current_date - 7,  current_date + 13, 2000000, true,  100000, current_date + 173, null, 'sent',  current_date - 7,  null, 'Progress claim 1, mezzanine.'),
  (seed_uuid('inv:3005'), 'INV-3005', seed_uuid('job:1211'), seed_uuid('cust:kahu'),         current_date - 80, current_date - 60, 2150000, true,  215000, current_date - 14,  null, 'paid',  current_date - 80, current_date - 55, 'Paid less retention.')
on conflict do nothing;

insert into invoice_lines (id, invoice_id, description, amount_cents) values
  (seed_uuid('il:3001-1'), seed_uuid('inv:3001'), 'Milk tanker gantry: fabricate, galvanise and install', 1840000),
  (seed_uuid('il:3002-1'), seed_uuid('inv:3002'), 'Drawbar crack test, gusset and recertification',        390000),
  (seed_uuid('il:3003-1'), seed_uuid('inv:3003'), 'Street bollards x18, CBD upgrade',                      520000),
  (seed_uuid('il:3004-1'), seed_uuid('inv:3004'), 'Progress claim 1: mezzanine steelwork to date',        2000000),
  (seed_uuid('il:3005-1'), seed_uuid('inv:3005'), 'Stair stringers and landing frames, galvanised',       2150000)
on conflict do nothing;

-- Notes -------------------------------------------------------------------------------------

insert into notes (id, customer_id, job_id, staff_id, noted_on, channel, note) values
  (seed_uuid('note:kahu1'),   seed_uuid('cust:kahu'),         seed_uuid('job:1200'), seed_uuid('staff:grant'), current_date - 2,  'phone', 'Chased Galv Services on PO-501: promised the mezzanine steel back by Thursday. Site wants it Monday.'),
  (seed_uuid('note:wd1'),     seed_uuid('cust:waikatodairy'), null,                  seed_uuid('staff:grant'), current_date - 5,  'phone', 'Karen says INV-3001 is with their group accountant. Chase again Friday if nothing lands.'),
  (seed_uuid('note:wd2'),     seed_uuid('cust:waikatodairy'), seed_uuid('job:1201'), seed_uuid('staff:priya'), current_date - 4,  'site',  'Walkway rework after the washdown clash. Hours are running well past the estimate: flag a variation for the extra handrail run.'),
  (seed_uuid('note:anchor1'), seed_uuid('cust:anchor'),       seed_uuid('job:1209'), seed_uuid('staff:priya'), current_date - 2,  'email', 'Dion confirmed the survey drawing revision. Quote holds.'),
  (seed_uuid('note:frank1'),  seed_uuid('cust:frankton'),     null,                  seed_uuid('staff:grant'), current_date - 24, 'phone', 'Gary aware the ramp is parked until the account settles.'),
  (seed_uuid('note:roto1'),   seed_uuid('cust:rototuna'),     null,                  seed_uuid('staff:grant'), current_date - 8,  'phone', 'Baz disputes two hours on the drawbar job. Sent him the time record; he went quiet.')
on conflict do nothing;

-- Tasks -------------------------------------------------------------------------------------

insert into tasks (id, title, customer_id, job_id, staff_id, due_on, status, note) values
  (seed_uuid('task:wd'),   'Ring Waikato Dairy group accountant about INV-3001', seed_uuid('cust:waikatodairy'), seed_uuid('job:1215'), seed_uuid('staff:grant'), current_date - 2, 'open', 'Karen gave the direct line. 25 days overdue and they still owe the platform job on top.'),
  (seed_uuid('task:kahu'), 'Confirm crane booking for the mezzanine site bolt-up', seed_uuid('cust:kahu'),        seed_uuid('job:1200'), seed_uuid('staff:grant'), current_date + 3, 'open', null)
on conflict do nothing;
