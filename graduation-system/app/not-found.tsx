import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="narrow">
      <div className="card center">
        <h1>Page not found</h1>
        <p>The page or link may have changed.</p>
        <Link className="btn" href="/">Go to the graduation home page</Link>
      </div>
    </main>
  );
}
