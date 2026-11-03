import 'server-only';
import { one, sql } from './db';
import { decryptSecret } from './crypto';
import { paymentMode, testShortcutsConfigured } from './config';

export type AppSettings = {
  test_mode: boolean;
  maintenance_mode: boolean;
  maintenance_message: string;
  tech_admin_sees_revenue: boolean;
  manual_checkin_override: boolean;
  staff_password_login: boolean;
  student_email_domains: string;
  otp_minutes: number;
  email_from: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  upload_rules: Record<string, string[]>;
};

export type Season = { id: string; name: string; status: 'open' | 'closed'; sort: number; cleaned_at: Date | null };

export type SeasonSettings = {
  season_id: string;
  graduate_price_aed: number;
  guest_price_aed: number;
  guest_limit: number;
  hold_minutes: number;
  extra_code_hours: number;
  sales_open: boolean;
  zone_selection_enabled: boolean;
  transfers_enabled: boolean;
  extra_requests_enabled: boolean;
  name_changes_enabled: boolean;
  merch_enabled: boolean;
  shop_close_date: string | null;
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_last_sent_on: string | null;
  venue_name: string;
  venue_area: string;
  graduate_capacity: number;
  sales_window_text: string;
  public_notice: string;
};

export type Ceremony = {
  id: number;
  season_id: string;
  number: number;
  name: string;
  starts_at: Date | null;
  doors_open_at: Date | null;
  graduate_entrance: string;
};

export type Zone = {
  id: number;
  season_id: string;
  code: string;
  name: string;
  door: string;
  color: string;
  capacity: number;
  wheelchair_capacity: number;
  sort: number;
  active: boolean;
};

export type ZoneAvailability = {
  id: number;
  code: string;
  name: string;
  door: string;
  color: string;
  capacity: number;
  taken: number;
  left: number;
  wheelchair_capacity: number;
  wheelchair_left: number;
};

export async function getAppSettings(): Promise<AppSettings> {
  const s = await one<AppSettings>('select * from app_settings');
  if (!s) throw new Error('app_settings row missing — run the migrations');
  return s;
}

export const getSeasons = () => sql<Season>('select * from seasons order by sort desc, id desc');

export const getSeason = (id: string) => one<Season>('select * from seasons where id = $1', [id]);

export const getSeasonSettings = (id: string) =>
  one<SeasonSettings>(`select *, to_char(shop_close_date, 'YYYY-MM-DD') as shop_close_date,
                              to_char(reminder_last_sent_on, 'YYYY-MM-DD') as reminder_last_sent_on
                         from season_settings where season_id = $1`, [id]);

export const getCeremonies = (seasonId: string) =>
  sql<Ceremony>('select * from ceremonies where season_id = $1 order by number', [seasonId]);

export const getZones = (seasonId: string, activeOnly = false) =>
  sql<Zone>(`select * from zones where season_id = $1 ${activeOnly ? 'and active' : ''} order by sort, code`, [seasonId]);

/** The latest open season — the public site's working season */
export async function currentPublicSeason(): Promise<Season | null> {
  return one<Season>(`select * from seasons where status = 'open' and cleaned_at is null order by sort desc limit 1`);
}

export const SECRET_KEYS = ['CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'SMTP_PASSWORD'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** A connection secret: the value replaced in Technical Settings if any, otherwise the environment. Server use only. */
export async function getSecret(key: SecretKey): Promise<string | null> {
  const row = await one<{ ciphertext: string }>('select ciphertext from app_secrets where key = $1', [key]);
  if (row) {
    const v = decryptSecret(row.ciphertext);
    if (v) return v;
  }
  return process.env[key] || null;
}

export async function secretStatus(): Promise<Record<SecretKey, { set: boolean; source: string; updated_at: Date | null }>> {
  const rows = await sql<{ key: SecretKey; updated_at: Date }>('select key, updated_at from app_secrets');
  const out = {} as Record<SecretKey, { set: boolean; source: string; updated_at: Date | null }>;
  for (const k of SECRET_KEYS) {
    const r = rows.find((x) => x.key === k);
    out[k] = r ? { set: true, source: 'Technical Settings', updated_at: r.updated_at } : { set: !!process.env[k], source: process.env[k] ? 'Environment' : '—', updated_at: null };
  }
  return out;
}

/** Simulated payments run only in Test mode with PAYMENT_MODE=simulate; they switch themselves off in Live mode. */
export async function simulateAllowed(): Promise<boolean> {
  if (paymentMode() !== 'simulate') return false;
  return (await getAppSettings()).test_mode;
}

/** Test-only shortcuts (Staff View, quick staff sign-in, code shown on screen): Test mode AND ALLOW_TEST_SHORTCUTS=true */
export async function testShortcutsAllowed(): Promise<boolean> {
  if (!testShortcutsConfigured()) return false;
  return (await getAppSettings()).test_mode;
}
