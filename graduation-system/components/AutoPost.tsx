'use client';
import { useEffect, useRef } from 'react';

/** Hands the browser to the payment gateway with a POST form (encrypted request fields only). */
export default function AutoPost({ action, fields }: { action: string; fields: Record<string, string> }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.submit(), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <form ref={ref} method="post" action={action}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className="btn block" type="submit">Continue to secure payment</button>
    </form>
  );
}
