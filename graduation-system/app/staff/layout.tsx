import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="in">
          <Link className="brand" href="/">
            <span className="crest" aria-hidden="true">MDX</span>
            <span>Graduation · Staff<small>Middlesex University Dubai</small></span>
          </Link>
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
