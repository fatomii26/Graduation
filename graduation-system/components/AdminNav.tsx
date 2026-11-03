'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { NavGroup } from '@/lib/menu';

export default function AdminNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const best = groups
    .flatMap((g) => g.items.map((i) => i.path))
    .filter((p) => path === p || path.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  const active = (p: string) => p === best;
  return (
    <div className={`side ${open ? 'open' : ''}`}>
      <div className="row between">
        <Link className="brand" href="/admin">
          <span className="crest" aria-hidden="true">MDX</span>
          <span>Graduation<small>Staff back office</small></span>
        </Link>
        <button className="btn ghost sm menu-toggle" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Menu</button>
      </div>
      <nav aria-label="Back office">
        {groups.map((g, i) => (
          <div key={i}>
            {g.head ? <h4>{g.head}</h4> : null}
            {g.items.map((it) => (
              <Link key={it.path} className="nav" href={it.path} aria-current={active(it.path) ? 'page' : undefined} onClick={() => setOpen(false)}>
                {it.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}
