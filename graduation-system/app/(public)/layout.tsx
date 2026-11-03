import Link from 'next/link';
import A11yMenu from '@/components/A11yMenu';
import { getAppSettings } from '@/lib/settings';
import { getStudent } from '@/lib/auth/student';

export const dynamic = 'force-dynamic';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings();
  const student = settings.maintenance_mode ? null : await getStudent();
  return (
    <>
      <header className="site-header">
        <div className="in">
          <Link className="brand" href="/">
            <span className="crest" aria-hidden="true">MDX</span>
            <span>
              Graduation Tickets
              <small>Middlesex University Dubai</small>
            </span>
          </Link>
          <nav className="site-nav" aria-label="Main">
            {!settings.maintenance_mode && (
              <>
                <Link href="/">Home</Link>
                <Link href="/tickets">My E-Tickets</Link>
                <Link href="/shop">Merchandise</Link>
              </>
            )}
            <A11yMenu />
            {student && (
              <form action="/api/auth/signout?kind=student" method="post">
                <button className="link" type="submit">Sign out ({student.misis})</button>
              </form>
            )}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {settings.maintenance_mode ? (
          <div className="narrow">
            <div className="card center">
              <h1>Back soon</h1>
              <p>{settings.maintenance_message}</p>
              <p className="small muted">Staff can still sign in to the back office.</p>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
      <footer className="site-footer">
        <p>
          Middlesex University Dubai · Graduation. Times are Dubai time (GST). Prices in AED. Children under 4 do not need a ticket.{' '}
          <Link href="/staff/login">Staff sign-in</Link>
        </p>
      </footer>
    </>
  );
}
