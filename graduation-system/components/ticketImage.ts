'use client';
import QRCode from 'qrcode';
import type { TicketView } from '@/lib/types';

/** Draws a ticket as a PNG in the browser (for "Save image" and phone sharing). */
export async function ticketBlob(t: TicketView): Promise<Blob> {
  const W = 720;
  const H = 1160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#7A1128';
  g.fillRect(0, 0, W, 96);
  g.fillStyle = t.zoneColor;
  g.fillRect(0, 96, W, 12);
  g.fillStyle = '#ffffff';
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillText('MDX Dubai · Graduation', 32, 60);
  g.textAlign = 'right';
  g.fillText(t.label, W - 32, 60);
  g.textAlign = 'left';
  g.fillStyle = '#1F1A1C';
  g.font = 'bold 40px system-ui, sans-serif';
  g.fillText(t.holder.slice(0, 32), 32, 170);
  g.font = '24px system-ui, sans-serif';
  g.fillStyle = '#5B5347';
  g.fillText(t.kind === 'guest' ? `Guest of ${t.graduateName}`.slice(0, 48) : `MISIS ${t.misis}`, 32, 208);
  const rows: [string, string][] = [
    ['Ceremony', t.ceremony],
    ['When', t.when],
    ['Venue', t.venue],
    [t.kind === 'guest' ? 'Zone' : 'Seating', t.zone],
    ['Door', t.kind === 'guest' ? `Door 1, then ${t.door}` : t.door],
  ];
  let y = 262;
  for (const [k, v] of rows) {
    g.fillStyle = '#7A7072';
    g.font = '20px system-ui, sans-serif';
    g.fillText(k, 32, y);
    g.fillStyle = '#1F1A1C';
    g.font = 'bold 26px system-ui, sans-serif';
    g.fillText(v.slice(0, 44), 32, y + 32);
    y += 74;
  }
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, t.url, { width: 420, margin: 1, errorCorrectionLevel: 'M' });
  g.drawImage(qr, (W - 420) / 2, 640);
  g.fillStyle = '#7A7072';
  g.font = '20px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(`Ref ${t.id.slice(0, 8).toUpperCase()}`, W / 2, 1100);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

export async function saveTicketImage(t: TicketView) {
  const b = await ticketBlob(t);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `ticket-${t.holder.replace(/[^A-Za-z0-9]+/g, '-')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function ticketFile(t: TicketView) {
  return new File([await ticketBlob(t)], `ticket-${t.id.slice(0, 8)}.png`, { type: 'image/png' });
}
