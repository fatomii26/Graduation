# Graduation Ticketing System: Build Specification

**Organisation:** Middlesex University Dubai
**Purpose:** One system for the whole graduation operation: ticket sales, guest seating, payments, e-tickets, door scanning, merchandise and staff administration.
**Used by:** Students and guests (public site), Finance, Marketing, DAR and Campus Central, Events team, Security, and IT.
**Version:** 1.0 (3 November 2026). This document is the single source of truth for what to build.

---

## 1. How to use this document

1. Read the whole document before writing code. Build **one system**: one codebase, one database, one set of business rules, one sign-in, one audit log.
2. The folder `reference/` holds two read-only reference sources. Do not run or extend them as separate applications. Take from them what this document says to take.

| Reference | What it is | How to use it |
|---|---|---|
| `reference/prototype/graduation-portal-online-final.html` | A single-file clickable prototype. All data is in memory and every payment, upload and email is simulated. | The reference for **screens, wording, menus, permissions and behaviour**. Open it in a browser and use the "Logged in as" selector to see each role. Do not port its code. |
| `reference/ticketing-app/` | A working Next.js and PostgreSQL ticketing application with database migrations, 136 database tests, QR ticket logic, a camera scanner and a payment callback. | The reference for **database rules, ticket and QR logic, scanner, payment callback and tests**. Reuse and adapt its code where section 21 says so. |

3. **Prototype screens to skip.** The prototype contains a page called "Event Site Connection", an "Event Site Monitor" in Technical Settings, and Event Site address and key fields. Do not build these. Seat selection, seat holds, QR issuing, scanning and check-in are all part of this one system and write directly to its own database.
4. Where the prototype and the ticketing app differ, this document decides. Where this document is silent, follow the prototype for screens and the ticketing app for data safety.
5. Conventions: TypeScript in strict mode, numbered SQL migrations, every business rule enforced in the database and covered by an automated test, English interface, times in Asia/Dubai, currency AED.
6. Anything marked **(confirm)** is a working default that the project owner may still change. Build it as a setting, not as hard-coded behaviour, wherever practical.

---

## 2. Scope

**In scope**
- Public ticket site for graduates and their guests.
- Guest seat map with first come, first served seat selection and a 10 minute hold.
- Online payment, counter payment at the Finance Office, payment by a third party, extra tickets.
- QR e-tickets shown immediately after payment, with sharing, download and Lost Ticket resend.
- Transfers of guest tickets between graduates with Marketing approval.
- Two-door scanning on any phone, Live Seating, Entry Check-In and Dashboard.
- Master List, Financial Hold, Potential Graduates, ceremony allocation, Reconciliation, Graduation Day Payments.
- Package collection (cap, gown, scarf, name card).
- Merchandise shop (public, staff, counter sales, items managed by admins).
- Seasons, prices, ticket limits, hall layout and venue for each season.
- Roles, permissions, Add User, Technical Super Admin and Technical Settings.
- Audit log for every change.

**Out of scope for version 1**
- Graduate seat codes. Graduates are seated by the University on the day. A graduate may have an optional staff-only seat label (section 6.4).
- Refunds inside the system. They are handled by Finance in the payment gateway.
- A native mobile app. The site works in a mobile browser.

---

## 3. Users and roles

### 3.1 Public users
- **Student (graduate):** signs in with MISIS and a 6 digit code emailed to the address on the Master List. Buys tickets, chooses guest seats, views and shares tickets, requests a transfer.
- **Third party payer (parent, guardian, sponsor):** pays for a student by entering the student's MISIS. Receives a receipt, does not see seats or tickets unless the student shares them.
- **Merchandise buyer:** anyone with a graduate's MISIS. No code needed. The MISIS is not checked against the Master List.

### 3.2 Staff roles
Staff sign in with their university Microsoft account (section 13.3). Each role is a preset of separate permissions. A super admin can change any person's permissions one by one.

| Role | Main responsibilities | Does not see |
|---|---|---|
| Super Admin (Finance) | Everything except Technical Settings, including revenue | Technical Settings |
| Super Admin (Marketing) | Everything except Technical Settings and revenue views | Technical Settings, revenue |
| Technical Super Admin (IT) | Technical Settings, User Access, Version Changes, all operational pages | Finance and revenue figures by default **(confirm)** |
| Finance | Finance Entry, Financial Hold, Reconciliation, Graduation Day Payments, Merchandise, revenue | Version Changes, Admin Access, hall layout editing |
| Marketing | Seat dials and ticket counts, E-Tickets and Seating, transfer approvals, Live Seating, Entry Check-In, Package Collection, Merchandise, Extra Tickets, Master List | Revenue |
| Events Team | E-Tickets and Seating including Hall Layout, Live Seating, Entry Check-In | Payments, revenue |
| DAR and Campus Central | Ceremony allocation, Potential Graduates, Financial Hold list, programme map, Master List | Payments, revenue |
| Security | Scanner and Live Seating | Everything else |
| Intern | Package Collection, Entry Check-In, E-Tickets (view and Lost Ticket), Extra Tickets (view only) | Revenue, admin |

### 3.3 Permission keys (starting list)
`view_dashboard`, `master_list`, `finance_entry`, `financial_hold`, `reconciliation`, `graduation_day_payments`, `view_revenue`, `tickets_seating`, `transfer_approve`, `layout_edit`, `live_seating`, `entry_checkin`, `scanner`, `package_collection`, `merchandise`, `extra_tickets`, `lost_ticket`, `potential_graduates`, `ceremony_allocation`, `programme_map`, `user_access`, `seasons`, `prices`, `version_changes`, `tech_admin`.

Rules:
- Every page and every server action checks its permission on the server. Hiding a menu item is not enough.
- Revenue figures are a separate permission group. Marketing, Events and Security never receive them.
- Staff can be limited to specific seasons.

### 3.4 Add User
1. A super admin enters full name, job title and MDX staff email. Only addresses ending in `@mdx.ac.ae` are accepted.
2. Choose department: Finance, Marketing, DAR and Campus Central, Events Team or IT.
3. Choose a role preset, adjust individual permissions, choose visible seasons.
4. The system creates the staff record and emails a welcome message to the MDX address. The person signs in with their Microsoft account. No password is created or stored.
5. User list shows status (Invited, Active, Paused) with Resend Invite, Pause or Activate, and Remove (a status change, never a deletion). Every action is logged.
6. **Fallback (confirm):** if IT cannot enable Microsoft sign-in, use a one-time link valid for 24 hours to set a password. Nobody, including admins, can ever see a password.

---

## 4. Seasons

- Every table that holds season data carries `season_id`. Each season has its own graduates, prices, ceremonies, hall layout, seats, orders, tickets, scans, merchandise and settings.
- Several seasons can be open at once. A super admin opens, closes, reopens or creates a season.
- Closing a season stops online sales. Staff can still edit its data.
- A new season copies the previous season's prices, hall layout, merchandise items and guest limit of 4.
- Season data is never deleted. Personal details can be removed from a closed season by the Data Clean-Up tool (section 16), keeping MISIS and payment records.

---

## 5. Business rules

Each rule must be enforced in the database or a server function, and covered by an automated test.

**Eligibility to buy**
1. A student can buy only if they are on the Master List, are a confirmed graduate, have no financial hold, have a ceremony allocated, and ticket sales are open.
2. A student cannot be allocated to a ceremony unless confirmed as a graduate, free of financial hold, and Finance has sent the request.

**Tickets and limits**
3. One graduate ticket and up to 4 guest tickets per graduate. The limit is raised only by an approved extra ticket request. Children under 4 need no ticket and no seat.
4. Each graduate can have only one active order at a time. A graduate can add further tickets with an extra ticket code.
5. The graduate ticket price and guest ticket price come from the season's price settings.

**Seats**
6. Guest seats are first come, first served. Two people can never hold or buy the same seat.
7. A seat is held for **10 minutes** (setting) while the student pays. An unpaid hold is released automatically by a scheduled job running every minute.
8. After payment, a guest seat cannot be changed. The only exception is an approved transfer (rule 15).
9. Students never see how many seats are left. They see the map only.

**Payments**
10. Tickets are issued only when payment is confirmed by the payment gateway or recorded by Finance.
11. Payment confirmations are signed, safe to receive twice, and the amount is checked against the order. A mismatch is flagged in a Needs Attention list.
12. A payment that arrives after the seat hold expired is accepted if the seats are still free. If not, the order goes to Needs Attention for Finance to resolve.
13. Over-the-counter payments produce a receipt number. The student enters MISIS and receipt number on the public page, chooses seats and receives tickets.

**Transfers**
14. A student can ask to transfer guest tickets to another graduate in the **same ceremony**.
15. Marketing approves or rejects. On approval the old tickets become void, new tickets with new QR codes are issued for the **same seats**, and the receiving graduate holds them. No other change to paid seats is allowed.
16. A correction of a guest's name on a ticket by Marketing uses the same reissue step with the same seat and graduate **(confirm)**.

**Scanning**
17. Every guest ticket works **once at Door 1** (venue entrance) and **once at Door 2** (hall door), then is refused. A person counts as in the hall after the Door 2 scan.
18. Graduate tickets work at **every scan**, at any door, any number of times.
19. Void, wrong-ceremony and unknown tickets are refused. Every scan, including refused ones, is written to an append-only scan log.

**Data safety**
20. Orders, tickets, payments, scans, transfers and the audit log are never deleted. Cancellations and voids are status changes. The audit log and scan log also reject updates.
21. Every change writes to the audit log with who, when, what and why.
22. The portal does not email e-tickets automatically after payment. Students share them. Staff can resend one ticket with Lost Ticket.

---

## 6. Seating

### 6.1 One hall per season
All ceremonies in a season use the same hall, one after the other. Graduates sit in front, guests behind.

### 6.2 Hall layout (set by the Events team or a super admin, per season)
- Venue name and area. The venue name also appears on the public page.
- Graduate block: rows, seats per row, aisle after seat number.
- Guest block: rows (A, B, C and so on), seats per row, aisle after seat number.
- Seat hold time in minutes.
- Capacity is calculated from these values. The demo layout is graduates 10 rows of 25 (250) and guests rows A to Z of 30 (780).
- Saving regenerates the seat map for each ceremony of the season. A guest block cannot be made smaller where seats are sold or held.
- Accessible places: a configurable number of wheelchair spaces, each with one companion place next to it, shown on the map and on the ticket.

### 6.3 Guest seat map
- One seat map per ceremony. States: available, held, sold, blocked.
- Choosing a seat creates a hold at once. The map updates for other students within 3 seconds.
- The student chooses one seat for each guest before paying.

### 6.4 Graduate seating
- The system reserves the front block on the map and counts it in capacity. It does not allocate or show graduate seats to students.
- The Master List may carry an optional `grad_seat_label` for staff use only. The ticket says "Graduate seating, seated on the day".

### 6.5 Live Seating and Entry Check-In
- **Live Seating:** per ceremony, shows who is in the hall. Seat map lights up guest seats after the Door 2 scan, with counts for graduates, guests, and still to arrive. Refreshes every 3 seconds. Read only.
- **Entry Check-In:** one row per graduate, with graduate ticket status and each guest's Door 1 and Door 2 time. Read only. Scans are made only by the scanner page. **(confirm)** a manual override for a failed scanner, with a required reason and an audit entry.

---

## 7. Tickets and QR codes

- One e-ticket per person: one for the graduate and one for each guest.
- Each ticket has a random token of at least 244 bits, never derived from the student or seat. The QR code contains `https://<site>/t/<token>`. Anyone with the link can view that one ticket. Only staff can admit it.
- Guest tickets show ceremony, date and time, seat, venue and door instructions. Graduate tickets show ceremony and graduate entrance.
- The QR code never changes unless the ticket is voided and reissued (transfer or correction). The old token then shows as replaced.
- Students see their tickets on screen at once after payment. They can download all tickets as one PDF, save each ticket as an image, or email any ticket to their MDX email, a private email or a guest.
- Lost Ticket (Marketing, Intern): staff choose one ticket and send it again to the student's MDX or private email, or a guest's email or mobile. The same QR code is sent. The action is logged.
- QR images are generated on the server as SVG. No dependence on a third party at runtime.

### 7.1 Scanner
- A page for Security and others with the `scanner` permission, on any phone, tablet or laptop with a camera. No app install. Camera reading in the browser, with paste or type as a fallback.
- Staff choose the ceremony and the checkpoint: Door 1, Door 2 or Graduate entrance.
- Result screen: **Admit**, **Already used** (with time and door), **Wrong ceremony**, **Void or replaced**, **Not found**.
- Every call goes to the server so that one entry per guest per door is guaranteed. **Scanning needs internet at the venue.** Plan a dedicated network for scanners **(confirm offline needs)**.

---

## 8. Payments

### 8.1 Online (CCAvenue)
- The student is sent to CCAvenue with the order. CCAvenue confirms the payment to the server. The student's browser returns to a waiting page that shows the tickets once the confirmation arrives, normally within seconds.
- Keep all gateway code behind one adapter file so the gateway can change. CCAvenue details (merchant ID, access code, working key) are held as secrets, never in the database or the browser. Confirm exact message formats against CCAvenue's current documentation with the Finance merchant account.
- Keep the safety behaviour of the reference callback: signature or encryption check, idempotency key, amount check, Needs Attention on mismatch.
- A `simulate` mode (test only) lets a developer complete a payment without the gateway. It must switch itself off in live mode.

### 8.2 Over the counter (Finance Office)
- Finance enters MISIS, amount and method. The system creates a **receipt number** and emails it to the student.
- The student enters MISIS and receipt number on the public page, chooses guest seats and receives tickets. The receipt number works once.
- Finance Entry shows a list **Students With Tickets Updated** with date, MISIS, name, ceremony, type, tickets added, amount, order or receipt number, who entered it and tickets now held. It can be filtered, searched and exported.

### 8.3 Paid by someone else
A parent, guardian or sponsor pays by entering the student's MISIS. The student receives a notice and chooses the seats.

### 8.4 Extra tickets
Marketing approves a request (from a form) and the system creates a **code valid for 72 hours**. The student enters it, chooses seats, pays and receives the extra tickets.

### 8.5 Graduation Day Payments
Finance takes payments on the day with the same counter flow, shown on its own page.

### 8.6 Reconciliation
Finance uploads the SAP daily balance and invoice reports. The system compares them with payments and lists differences. Revenue is visible only with `view_revenue`.

---

## 9. Data model

All tables have `season_id` where they hold season data, `created_at`, and `updated_at` where they change. Names are guidance. Keep the ticketing app's constraints and protection triggers.

**Season and set-up**
- `seasons` (id, name, status open or closed)
- `season_settings` (season_id, ticket prices, guest limit, hold minutes, sales open, shop close date, reminder setting, feature switches)
- `ceremonies` (season_id, number, name, starts_at, doors_open_at, graduate entrance name)
- `programme_ceremony_map` (season_id, programme, ceremony)
- `hall_layouts` (season_id, venue, area, graduate rows, per row, aisle, guest rows, per row, aisle, hold minutes, wheelchair spaces)

**People**
- `graduates` (season_id, misis, email, mobile, full_name, programme, potential_graduate, confirmed_graduate, financial_hold, ceremony, max_guests, grad_seat_label). Unique on season and MISIS, and on season and email.
- `financial_holds` (season_id, misis, reason, amount, status, removed_by, removed_at, dar_notified_at)
- `staff` (email, full_name, job_title, department, role, status, seasons)
- `staff_permissions` (email, permission, allowed)

**Seats and tickets**
- `seats` (season_id, ceremony, id, section guest or accessible, row_label, seat_number, kind standard, wheelchair or companion, status)
- `seat_holds` (seat_id, misis, order_id, expires_at)
- `orders` (id, season_id, misis, status, channel online, counter or third party, guest_count, amount_aed, payment_ref, receipt_number, needs_attention, expires_at)
- `receipts` (receipt_number, misis, amount, method, entered_by, used_at)
- `extra_ticket_codes` (code, misis, extra_guests, approved_by, expires_at, used_at)
- `tickets` (id, order_id, misis, kind graduate or guest, holder_name, seat_id, token, status valid, void, replaced_by, replaces, door1_at, door2_at)
- `transfers` (id, from_misis, to_misis, ticket_ids, status requested, approved, rejected, decided_by, reason)
- `ticket_sends` (ticket_id, channel, address, sent_by, sent_at) for Lost Ticket and sharing
- `scans` (append only: ticket_id, ceremony, checkpoint, result, holder_name, staff, at)
- `package_collections` (season_id, misis, cap, gown, scarf, name_card, collected_by, at)

**Money**
- `payments` and `payment_events` (append only: event key, order or merchandise order, gateway reference, amount, payload)
- `reconciliation_uploads` and `reconciliation_lines`

**Merchandise**
- `merch_items` (season_id, name, price, image, active)
- `merch_orders` (id, season_id, misis, buyer name, buyer email, channel online or counter, payment status, collected flag, collected_by, collected_at)
- `merch_order_lines` (order, item, quantity, unit price)

**System**
- `audit_log` (append only), `technical_change_log`, `email_templates`, `scheduled_job_runs`, `error_log`, `email_outbox`

**Rules to keep from the ticketing app**
- Unique index so a seat has at most one valid ticket.
- Unique index for one active order per graduate per season.
- Lock the seat rows before holding or selling.
- Delete and truncate protection on orders, tickets, payments, scans, transfers and the audit log.
- Row level security on every table. Browsers may read only what is public (settings, ceremonies, the seat map status). All writes go through server-side functions.

---

## 10. Database functions

Plain PostgreSQL functions, called only by the server. Each has tests.

`eligibility(season, misis)`, `hold_seats(season, misis, seat_ids)`, `release_expired_holds()`, `create_order(...)`, `mark_order_paid(order, method, ref, actor)`, `record_counter_payment(...)`, `redeem_receipt(misis, receipt)`, `approve_extra_ticket(...)`, `redeem_extra_code(...)`, `request_transfer(...)`, `approve_transfer(id, actor)`, `reject_transfer(id, actor, reason)`, `reissue_ticket(ticket, actor, reason)`, `scan_ticket(token, ceremony, checkpoint, actor)`, `live_stats(ceremony)`, `save_hall_layout(...)`, `merch_order_paid(...)`, `mark_collected(...)`, `log_event(...)`.

The ticketing app already contains versions of eligibility, holds, order creation, payment marking, release of expired holds, scanning and live stats. Adapt them to add `season_id` and the two-door rule.

---

## 11. Screens

### 11.1 Public site
- **Home and ticket box:** check eligibility, buy graduate and guest tickets, choose guest seats on the map, pay online. Links for: paying for a student, paid at the Finance Office (receipt number), and extra ticket code.
- **My E-Tickets:** view, download PDF, save images, email, request transfer.
- **Merchandise box:** enter a MISIS, choose items with pictures, enter buyer name and email, pay online.
- **Ticket page** `/t/<token>`: single ticket, public by link.
- **Accessibility menu:** text size, contrast, reduced motion (reuse from the ticketing app).
- **Maintenance page** when Maintenance Mode is on.
- Students do not see seat counts.

### 11.2 Staff back office (menu order)
1. **Dashboard:** tickets sold, seat use per ceremony, arrivals, with revenue shown only to `view_revenue`.
2. **Master List:** upload, search, edit contact details.
3. **Finance:** Finance Entry (Over the Counter, Online Payments Live, Receipts and Seats, Paid by Someone Else, Email Students), Financial Hold, Reconciliation, Graduation Day Payments.
4. **Marketing:** E-Tickets and Seating (Issued E-Tickets, Seating Plan, Hall Layout, Transfer Requests), Live Seating, Entry Check-In, Package Collection, Merchandise (Orders, OTC Payment, Items Sold), Extra Tickets.
5. **DAR and Campus Central:** Financial Hold, Potential Graduates, ceremony allocation.
6. **Scanner** for Security.
7. **Administration:** Technical Settings, Admin Access, Version Changes.

Every page except Dashboard, Package Collection, Version Changes and Admin Access has a search bar for MISIS that shows the information of that page.

**Admin Access headings:** User Access, Graduation Seasons, Ticket Prices and Packages, Ticket Purchase Limit, Hall Layout and Venue, Package Collection Reminder, Merchandise Items, Programme to Ceremony Map.

### 11.3 Merchandise rules
- Public and counter orders. Mark as Collected is allowed only after a successful payment.
- Items are added, edited, hidden or removed by a super admin, with price, picture or drawing, and the shop close date (normally the graduation day).
- Demo items: Teddy AED 50, Bottle AED 20, Keychain AED 5, Cup AED 10.

---

## 12. Outside services

| Service | Used for | Notes |
|---|---|---|
| CCAvenue | Online payment for tickets and merchandise, daily report | Server confirmation required. Test and live accounts. |
| Microsoft Entra ID | Staff sign-in | App registration by IT. |
| Registry and clearance | Master List upload, graduate and clearance status | Start with CSV upload. Support a signed webhook and a pull request later (reuse the ticketing app's clearance code). |
| SAP | Daily balance and invoice reports | Start with file upload. |
| Email service | Sign-in codes, receipts, ticket sends, staff invites, reminders | SMTP or provider API. Templates editable in Technical Settings. |

Master List columns: `misis, email, mobile, full_name, programme, confirmed_graduate, financial_hold, ceremony, grad_seat_label, max_guests`. Re-importing updates existing rows and never removes anyone. MISIS is 4 to 20 letters or digits. The email must be the university address.

---

## 13. Architecture and hosting

### 13.1 Shape of the system
```
Browser (students, staff, scanner phones)
   |
Web application (Next.js, TypeScript): pages + server actions + API routes
   |
PostgreSQL database: tables, rules as functions, scheduled jobs
   |
Outside services: CCAvenue, Microsoft Entra ID, email, Registry, SAP
```
- Pages hold no business rules. Rules live in database functions so they cannot be bypassed.
- Live screens (seat map, Live Seating, Entry Check-In) refresh by polling every 3 seconds. Do not depend on a vendor-specific realtime feature.

### 13.2 Hosting
- **Testing now:** Supabase (PostgreSQL, sign-in) and Vercel, with fictional data only.
- **Production:** Azure UAE North, run by the university IT team: managed PostgreSQL, a container or app service for the web application, a secrets vault, automated backups with point-in-time restore.
- **Keep it portable.** Standard PostgreSQL 15 or later. Use no Supabase-only features in business logic. Keep sign-in in one module (`lib/auth/`), and storage, email and job scheduling behind small adapter files, so moving to Azure changes only those files. Include the Dockerfile and a `docker compose` file for local development with a plain PostgreSQL container.
- Real student data must not be loaded into the testing environment.

### 13.3 Sign-in
- Staff: Microsoft Entra ID, single tenant. The email must match an active `staff` row. Role and permissions come from the database.
- Students: MISIS plus a 6 digit code sent to the Master List email. Codes expire (default 10 minutes), are single use and are rate limited.

### 13.4 Scheduled jobs
Release expired seat holds (every minute), package collection reminder, daily payment comparison with SAP files, daily backup check, season close tasks. Technical Settings can run, pause or restart each job.

### 13.5 Targets (confirm)
Support about 500 students booking at the same time. Payment to ticket on screen within 10 seconds. A scan answered within 1 second on venue Wi-Fi.

---

## 14. Security and data protection

- All writes through server functions. Secrets only in environment or vault. No secret ever appears in the browser, the database dump or a log.
- Signed payment and clearance messages. Idempotent handlers.
- Rate limits on sign-in codes, ticket pages and the receipt and extra code fields.
- Server-side permission checks on every action. Sign-out for any user in the Security Log.
- Personal data kept only as long as needed. Data Clean-Up for closed seasons. IT and legal confirm the retention period and compliance with UAE data protection law before launch.
- Backups with a tested restore before sales open.
- Accessibility: keyboard use, contrast, text size, reduced motion.

---

## 15. Emails

Sign-in code, receipt number, payment confirmation notice, third party payment notice, extra ticket code, transfer decision, Lost Ticket send, ticket share, package collection reminder, staff welcome. Subjects and wording are editable templates with the placeholders `{name}`, `{misis}`, `{tickets}`, `{ceremony}`, `{paid}`, `{team}`. Use an outbox table with retry so a mail failure never blocks a payment.

---

## 16. Technical Settings (Technical Super Admin)

Every change is recorded in the Technical Change Log with the old and new value.

1. **Connection Settings:** CCAvenue merchant ID, access code, working key, and the email sender. Secrets are write-only: they can be replaced, never read back on screen. Test Connections button.
2. **Test Mode and Maintenance Mode:** switch Test and Live with a confirmation step. Maintenance Mode closes the public page with a message while staff keep working. Test mode shows a strip on every page.
3. **Feature Switches:** ticket sales, guest seat selection, merchandise shop, transfers, extra ticket requests.
4. **Public Page Text:** sales window text and an optional notice.
5. **Email Templates:** edit subject and wording, set code validity, reset to original.
6. **Scheduled Tasks:** run now, pause, restart.
7. **Error Log and System Health:** uptime, page load time, logged problems.
8. **Security Log:** who is signed in, sign-in history with failed attempts, Sign Out for any user.
9. **Backups:** create, download, restore with confirmation.
10. **Data Clean-Up:** remove names, emails and mobile numbers from a closed season, keeping MISIS and payments.
11. **Upload Rules:** the required columns of each upload file.
12. **Technical Change Log.**

---

## 17. Build phases

Each phase ends with passing tests and a short demo. Durations are estimates.

| Phase | Content | Estimate |
|---|---|---|
| 0. Set-up | Project skeleton, local PostgreSQL, CI, migrations from the ticketing app adapted to seasons, accounts requested from IT | 2 to 3 days |
| 1. Core ticketing | Master List upload, eligibility, hall layout, seat map with holds, orders, CCAvenue adapter with simulate mode, QR tickets on screen, sharing, public site, student sign-in, emails | 1 to 2 weeks |
| 2. Door and live views | Scanner with two-door rule, Live Seating, Entry Check-In, Dashboard | about 1 week |
| 3. Finance and roles | Finance Entry and receipts, Financial Hold, Graduation Day Payments, Reconciliation, roles, permissions, Add User, Microsoft sign-in | 1 to 2 weeks |
| 4. Marketing and DAR | Transfers, extra tickets, Lost Ticket, Package Collection, Potential Graduates, ceremony allocation | 1 week |
| 5. Merchandise | Public shop, counter sales, collection, item admin | 1 to 2 weeks (can run in parallel with 3 and 4) |
| 6. Technical Settings | All 12 sections, maintenance and test modes, logs | about 1 week |
| 7. Hardening | Load test, security review, backup restore test, scanning rehearsal with real phones at the venue, team sign-off | about 1 week |
| 8. Launch | Move to Azure UAE North, re-check sign-in and payment, open sales | set with IT |

---

## 18. Acceptance checks

1. A student on hold or not yet a confirmed graduate cannot buy tickets or be allocated.
2. Two students cannot hold or buy the same seat, even at the same moment. A hold is released 10 minutes after it was made if unpaid.
3. Tickets appear on screen within seconds of a successful payment.
4. A guest QR code is refused on a second scan at the same door. A graduate QR code is accepted at every scan.
5. A transfer voids the old QR code and issues a new one for the same seat. No other post-payment seat change is possible.
6. Students never see seat counts.
7. Scans appear on Live Seating and Entry Check-In within 3 seconds.
8. Changing the hall layout never removes sold or held guest seats.
9. Merchandise can be marked collected only after a successful payment.
10. Each role sees only its own pages and actions, checked on the server.
11. A connection secret saved in Technical Settings can never be read back on screen.
12. Maintenance Mode closes the public page while staff can still sign in.
13. A duplicate payment confirmation does not create a second set of tickets. A wrong amount goes to Needs Attention.
14. Orders, tickets, payments, scans and the audit log cannot be deleted by any role.
15. A rehearsal with one ceremony passes: a full online purchase, a counter payment, a transfer and at least 200 scans at both doors.

Extend the ticketing app's test file (`supabase/tests/booking.test.mjs`) with tests for seasons, the seat map, the two-door rule, transfers and receipts. Add end-to-end tests for the main flows.

---

## 19. Demo and seed data

For development and demos, with fictional people only.
- Season Oct 2026 is the working season. Closed seasons: Mar 2026, Oct 2025, Mar 2025.
- Seed: 100 fictional graduates, staff in each role, the demo hall layout (graduates 10 by 25, guests A to Z by 30), four ceremonies, and the four demo merchandise items.
- Demo cases from the prototype: a student with 1 graduate and 1 guest ticket, an eligible student with nothing bought, a student with 2 guests who can buy 2 more, a student who paid at the counter with a receipt and two seats still to choose, and a transfer between two graduates in the same ceremony.
- A "Staff View" shortcut that skips verification codes is allowed in test mode only and must be absent in live mode.

---

## 20. Open decisions

Build each as a setting or a small isolated piece so a change is cheap.

1. Whether the Technical Super Admin sees finance and revenue figures (default off).
2. Whether guest name correction by Marketing is allowed (default yes, through the reissue step).
3. Whether scanning needs an offline mode (default no, dedicated network).
4. Whether Entry Check-In has a manual override for scanner failure (default no).
5. Whether Microsoft sign-in is available for all staff at launch, or the one-time link fallback is needed.
6. Real venue layout, ceremony dates and times, prices, wheelchair places.
7. Which email service sends ticket and receipt emails.
8. Data retention period and legal review before launch.
9. Registry and clearance route: CSV only, or also automatic updates.

---

## 21. Reference file map

Reuse the ticketing app as follows. Adapt every file to seasons and the rules above, and delete anything not needed.

| Need | Take from `reference/ticketing-app/` |
|---|---|
| Schema and rules | `supabase/migrations/*.sql`, `docs/DATABASE.md` (start with seats, holds, orders, tickets, scans, audit log and protection triggers; skip the zone booking tables) |
| Database tests | `supabase/tests/booking.test.mjs` (extend) |
| Payment callback and gateway adapter pattern | `lib/finance.ts`, `lib/payments.ts`, `app/api/pay/*` |
| Clearance connector | `lib/clearance.ts`, `app/api/clearance/webhook/route.ts` |
| Tickets, QR, sharing | `lib/tickets.ts`, `components/TicketCard.tsx`, `TicketWallet.tsx`, `ShareSheet.tsx`, `ticketImage.ts`, `app/t/[token]/page.tsx` |
| Scanner and live feed | `components/Scanner.tsx`, `LiveFeed.tsx`, `app/checkin/page.tsx`, `app/api/checkin/route.ts` |
| Sign-in | `components/SignIn.tsx`, `lib/session.ts`, `lib/supabase/*` (wrap behind `lib/auth/`) |
| Staff tools and roster import | `components/AdminTools.tsx`, `app/api/admin/roster/route.ts`, `lib/csv.ts` |
| Accessibility | `components/A11yMenu.tsx` |
| Container and CI | `Dockerfile`, `.github/workflows/*` |

The prototype `reference/prototype/graduation-portal-online-final.html` is the reference for every screen in section 11, including wording, menu order, tabs, table columns and demo data.
