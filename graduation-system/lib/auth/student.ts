import 'server-only';
import { redirect } from 'next/navigation';
import { one } from '../db';
import { readSession } from './session';

export type Graduate = {
  id: number;
  season_id: string;
  misis: string;
  email: string;
  private_email: string | null;
  mobile: string | null;
  full_name: string;
  programme: string;
  potential_graduate: boolean;
  confirmed_graduate: boolean;
  financial_hold: boolean;
  finance_request_sent_at: Date | null;
  ceremony_id: number | null;
  max_guests: number | null;
  grad_seat_label: string | null;
};

export type StudentCtx = { misis: string; season_id: string; graduate: Graduate };

export async function getStudent(): Promise<StudentCtx | null> {
  const s = await readSession('student');
  if (!s?.season_id) return null;
  const g = await one<Graduate>('select * from graduates where season_id = $1 and misis = $2', [s.season_id, s.subject]);
  if (!g) return null;
  return { misis: g.misis, season_id: g.season_id, graduate: g };
}

export async function requireStudent(next: string): Promise<StudentCtx> {
  const s = await getStudent();
  if (!s) redirect(`/signin?next=${encodeURIComponent(next)}`);
  return s;
}
