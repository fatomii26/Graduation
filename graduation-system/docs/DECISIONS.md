# Decisions and deviations from the build specification

The build specification (`docs/SYSTEM.md`, v1.0, 3 November 2026) remains the reference. This file records where the
built system differs, and why. Decisions 1–5 were made by the project owner on 3 November 2026.

## A. Zones instead of seat numbers (project owner)

Students choose the **zone** where their guests sit. There are no seat numbers. Every person (graduate and each guest)
still gets their **own ticket with a unique QR code and their name**.

| # | Decision | Where it is enforced |
|---|---|---|
| 1 | **One zone per group.** If the chosen zone cannot take the whole group, the student sees a message that the guests cannot all sit together and the rest will be placed in another zone they choose. A split is refused when the first zone has room for everyone. | `check_group()` (`keep_together`), `components/ZonePicker.tsx` |
| 2 | **Students see places left per zone** (overrides spec rule 9 "students never see counts"). Counts refresh every 3 seconds. | `zone_availability()`, `/api/zones` |
| 3 | **Each zone has its own door.** Door 1 is the venue entrance; Door 2 is the zone's own door. The ticket shows it and the scanner refuses the wrong door. | `scan_ticket()` (`wrong_door`) |
| 4 | **Hold time is a setting in Admin Access** (Hall Layout and Venue; also on the Hall Layout tab). Default 10 minutes. | `season_settings.hold_minutes` |
| 5 | **Guest name changes are requested by the student in the system** and decided case by case by Marketing; approval voids the old QR code and reissues with the new name in the same zone. | `request_name_change()`, `decide_name_change()`, `reissue_ticket()` |

What this replaces in the spec: §5 rules 6–9 (seat hold, seat changes, hidden counts), §6.2–6.3 (rows/seats per row and the
seat map — now zones with capacity, door, colour and wheelchair spaces), §6.5 seat lighting (Live Seating now shows each
zone's guests in the hall), §9 `seats`/`seat_holds` tables (places are held by the unpaid order's guests until `expires_at`),
and acceptance checks 2, 5 and 8 (now: two people can never overfill a zone; a transfer keeps the same zone; a zone can
never be made smaller than the places sold or held).

## B. Defaults accepted by the project owner

- **Paid before choosing a zone** (counter, Graduation Day, paid by someone else): the payment becomes a **receipt** for the
  places owed. The student signs in, enters the receipt number, chooses the zone and names, and the named tickets are issued
  at once. A receipt works once.
- **Extra tickets:** an approved request creates a code (72 hours by default) and the student buys the extra guests as a
  separate linked order with its own payment. The guest limit is raised only by such a code (or a personal limit set by a super admin).
- **Missed Door 1:** a guest scanned at their zone door without a Door 1 scan is admitted and the scan is flagged.
- **Guest ticket at the Graduate entrance:** refused ("Guest ticket: use Door 1").

## C. Open decisions (spec §20) — built as settings with these defaults

| # | Default | Where to change |
|---|---|---|
| 1 | Technical Super Admin does **not** see revenue | Technical Settings → Feature Switches |
| 2 | Guest name correction allowed, through the reissue step | Feature Switches (name change requests); staff correction on E-Tickets |
| 3 | No offline scanning: every scan is checked by the server (dedicated venue network recommended) | — |
| 4 | Entry Check-In manual override **off** | Feature Switches |
| 5 | Microsoft sign-in; one-time-link password fallback available but **off** | Feature Switches |
| 6 | Demo venue, dates, prices (AED 325 / 375) and zones are placeholders | Admin Access |
| 7 | Email: `log` in testing, SMTP for real | Environment / Technical Settings |
| 8 | Retention: Data Clean-Up tool for closed seasons; legal review still required | Technical Settings → Data Clean-Up |
| 9 | Registry: CSV upload of the Master List | Master List |

## D. Other implementation choices

- **Database only on Supabase.** No Supabase Auth, Realtime, Storage or Data API: sign-in is in `lib/auth/` (own sessions,
  student codes, Microsoft OIDC with PKCE), live screens poll every 3 seconds. This keeps the move to Azure to configuration only.
- **Connection secrets in Technical Settings** are write-only and stored as AES-256-GCM ciphertext, with the key derived from
  `APP_SECRET` (environment), never stored in the database. A database dump alone cannot reveal them. Environment values are used when none is saved.
- **Backups:** the page offers a JSON export of a season and the platform's point-in-time restore instructions. Restores are
  done at database level because orders, tickets, payments and logs are protected against deletion and rewriting.
- **Lost Ticket to a mobile number:** there is no SMS provider in scope, so staff send a WhatsApp link (and log the send). Email sends are automatic.
- **Receipt redemption requires the student to sign in** (MISIS + code) before entering the receipt number, so a receipt number alone never reveals tickets.
- **Sign-in privacy:** the code form gives the same answer whether or not a MISIS is on the Master List.
- **Master List import** can place a financial hold but never removes one (only Finance removes holds), and applies a ceremony only when rule 2 allows it; otherwise it reports a note.
- **Finance can record a missed online payment** (verified in the CCAvenue dashboard) with the same amount and capacity checks as the gateway callback.
- **Late payment after the hold, zone now full:** the graduate ticket is issued and the order goes to Needs Attention; Finance converts it to a receipt so the student can choose another zone, or refunds.
- **PDF tickets** use the built-in Latin font; names in other scripts appear on screen, in shared images and on the ticket page, but may show `?` in the PDF.
- **Permissions:** two keys were added to the starting list: `extra_tickets_approve` (the Intern role can view Extra Tickets but not approve) and the existing `transfer_approve` also covers name changes.
- **Transfers** do not check the receiving graduate's guest limit; Marketing decides each request.
