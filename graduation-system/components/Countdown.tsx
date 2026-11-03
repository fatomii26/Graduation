'use client';
import { useEffect, useState } from 'react';

export default function Countdown({ until }: { until: string }) {
  const end = new Date(until).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="timer">…</span>;
  const left = Math.max(0, Math.floor((end - now) / 1000));
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, '0');
  return <span className="timer" role="timer" aria-live="off">{left ? `${m}:${s}` : 'expired'}</span>;
}
