import { Link, useLocation } from 'react-router-dom';
import { Compass, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-6">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-control bg-navy">
            <ShieldCheck aria-hidden className="h-5 w-5 text-sky" />
          </span>
          <p className="text-support font-semibold text-ink">Secure examination platform</p>
        </div>

        <div className="surface mt-6 p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-panel text-muted">
            <Compass aria-hidden className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-section-lg font-semibold text-ink">This page could not be found</h1>
          <p className="mt-2 text-body text-muted">
            No page matches <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-meta">{location.pathname}</code>.
            The link may be out of date, or the item may have been removed.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/admin">
              <Button variant="primary">Go to the dashboard</Button>
            </Link>
            <Link to="/exam">
              <Button variant="secondary">Open the candidate application</Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
