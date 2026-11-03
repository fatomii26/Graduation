'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Re-renders the page from the server every few seconds (live screens poll; no vendor realtime feature). */
export default function AutoRefresh({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [at, setAt] = useState<string>('');
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') {
        router.refresh();
        setAt(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai' }));
      }
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [on, seconds, router]);
  return (
    <span className="small muted noprint" aria-live="off">
      <label className="inline">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Live (every {seconds}s)
      </label>
      {at ? ` · updated ${at}` : ''}
    </span>
  );
}
