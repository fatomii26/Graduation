import 'server-only';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { sql } from './db';
import { siteUrl } from './config';
import { fmtDate, fmtTime } from './format';
import type { TicketView } from './types';

export const ticketUrl = (token: string) => `${siteUrl()}/t/${token}`;

// QR images are generated on the server as SVG: no third party at runtime.
export const qrSvg = (text: string) =>
  QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1F1A1C', light: '#ffffff' } });

type Row = {
  id: string; token: string; kind: 'graduate' | 'guest'; holder_name: string; status: 'valid' | 'void'; access: 'none' | 'wheelchair' | 'companion';
  needs_assistance: boolean; door: string; misis: string; full_name: string; programme: string;
  ceremony: string; starts_at: Date | null; doors_open_at: Date | null; graduate_entrance: string;
  zone_name: string | null; zone_color: string | null; venue_name: string; venue_area: string; guest_no: number;
};

const BASE = `
  select t.id, t.token, t.kind, t.holder_name, t.status, t.access, t.needs_assistance, t.door, t.misis,
         g.full_name, g.programme, c.name as ceremony, c.starts_at, c.doors_open_at, c.graduate_entrance,
         z.name as zone_name, z.color as zone_color, ss.venue_name, ss.venue_area,
         (row_number() over (partition by t.misis, t.kind, t.status order by t.created_at, t.id))::int as guest_no
    from tickets t
    join graduates g on g.season_id = t.season_id and g.misis = t.misis
    join ceremonies c on c.id = t.ceremony_id
    join season_settings ss on ss.season_id = t.season_id
    left join zones z on z.id = t.zone_id`;

async function toView(r: Row): Promise<TicketView> {
  const url = ticketUrl(r.token);
  const guest = r.kind === 'guest';
  const accessText = r.access === 'wheelchair' ? ' · Wheelchair space' : r.access === 'companion' ? ' · Companion place' : '';
  return {
    id: r.id,
    token: r.token,
    url,
    kind: r.kind,
    label: guest ? `Guest ${r.guest_no}` : 'Graduate',
    holder: r.holder_name,
    graduateName: r.full_name,
    programme: r.programme,
    misis: r.misis,
    ceremony: r.ceremony,
    when: r.starts_at ? `${fmtDate(r.starts_at)} · ${fmtTime(r.starts_at)}` : 'Date to be announced',
    doorsOpen: r.doors_open_at ? fmtTime(r.doors_open_at) : '',
    venue: [r.venue_name, r.venue_area].filter(Boolean).join(', '),
    zone: guest ? `${r.zone_name ?? 'Zone'}${accessText}` : 'Graduate seating, seated on the day',
    zoneColor: guest ? r.zone_color ?? '#7A1128' : '#C9A227',
    door: r.door,
    doorText: guest
      ? `Show this QR code at Door 1 (venue entrance), then at ${r.door} for your zone.`
      : `Use the ${r.graduate_entrance}. Graduates are seated by the University on the day.`,
    access: r.access,
    needsAssistance: r.needs_assistance,
    status: r.status,
    qrSvg: await qrSvg(url),
  };
}

/** Valid tickets a graduate holds now (including guests' tickets) */
export async function ticketsForGraduate(seasonId: string, misis: string): Promise<TicketView[]> {
  const rows = await sql<Row>(`${BASE} where t.season_id = $1 and t.misis = $2 and t.status = 'valid' order by t.kind desc, t.created_at, t.id`, [seasonId, misis]);
  return Promise.all(rows.map(toView));
}

export async function ticketByToken(token: string): Promise<(TicketView & { replaced: boolean }) | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const rows = await sql<Row & { replaced_by: string | null }>(`${BASE.replace('t.misis,', 't.misis, t.replaced_by,')} where t.token = $1`, [token]);
  if (!rows[0]) return null;
  const view = await toView(rows[0]);
  return { ...view, label: view.kind === 'guest' ? 'Guest' : 'Graduate', replaced: !!rows[0].replaced_by };
}

// ---------------------------------------------------------------------------
// One PDF with all tickets (two per A4 page). QR drawn as vector squares.
// ---------------------------------------------------------------------------
const latin = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, '?');

function hexColor(h: string) {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawTicket(page: PDFPage, t: TicketView, top: number, font: PDFFont, bold: PDFFont) {
  const left = 40;
  const w = 515;
  const h = 360;
  const y0 = top - h;
  page.drawRectangle({ x: left, y: y0, width: w, height: h, borderColor: rgb(0.85, 0.82, 0.8), borderWidth: 1 });
  page.drawRectangle({ x: left, y: top - 46, width: w, height: 46, color: rgb(0.478, 0.067, 0.157) });
  page.drawText('Middlesex University Dubai · Graduation', { x: left + 16, y: top - 30, size: 13, font: bold, color: rgb(1, 1, 1) });
  page.drawText(latin(t.label.toUpperCase()), { x: left + w - 120, y: top - 30, size: 12, font: bold, color: rgb(1, 1, 1) });

  const lines: [string, string][] = [
    ['Name', t.holder],
    [t.kind === 'guest' ? 'Guest of' : 'Programme', t.kind === 'guest' ? `${t.graduateName} (${t.misis})` : t.programme],
    ['Ceremony', t.ceremony],
    ['Date and time', t.when + (t.doorsOpen ? ` · doors open ${t.doorsOpen}` : '')],
    ['Venue', t.venue],
    [t.kind === 'guest' ? 'Zone' : 'Seating', t.zone],
    ['Door', t.kind === 'guest' ? `Door 1, then ${t.door}` : t.door],
  ];
  let y = top - 80;
  for (const [k, v] of lines) {
    page.drawText(k, { x: left + 16, y, size: 9, font, color: rgb(0.4, 0.37, 0.38) });
    page.drawText(latin(v).slice(0, 60), { x: left + 16, y: y - 14, size: 12, font: bold, color: rgb(0.12, 0.1, 0.11) });
    y -= 36;
  }
  page.drawRectangle({ x: left + 16, y: y0 + 14, width: 6, height: 20, color: hexColor(t.zoneColor) });
  page.drawText(latin(t.doorText).slice(0, 95), { x: left + 28, y: y0 + 20, size: 8.5, font, color: rgb(0.33, 0.29, 0.3) });

  const qr = QRCode.create(t.url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const box = 190;
  const cell = box / n;
  const qx = left + w - box - 24;
  const qy = top - 70 - box;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) page.drawRectangle({ x: qx + c * cell, y: qy + (n - 1 - r) * cell, width: cell + 0.2, height: cell + 0.2, color: rgb(0.12, 0.1, 0.11) });
    }
  }
  page.drawText(`Ref ${t.id.slice(0, 8).toUpperCase()}`, { x: qx, y: qy - 16, size: 9, font, color: rgb(0.4, 0.37, 0.38) });
}

export async function ticketsPdf(tickets: TicketView[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Graduation e-tickets');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < tickets.length; i += 2) {
    const page = doc.addPage([595.28, 841.89]);
    drawTicket(page, tickets[i], 800, font, bold);
    if (tickets[i + 1]) drawTicket(page, tickets[i + 1], 410, font, bold);
  }
  return doc.save();
}
