import { Loader2, ShieldCheck } from 'lucide-react';

export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-6">
      <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
        <span className="flex h-12 w-12 items-center justify-center rounded-panel bg-navy">
          <ShieldCheck aria-hidden className="h-6 w-6 text-sky" />
        </span>
        <p className="flex items-center gap-2 text-support text-muted">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          {label}…
        </p>
      </div>
    </div>
  );
}
