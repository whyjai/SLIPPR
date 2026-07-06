import { Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';
import HomePage from './HomePage';

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/25">
              <ShieldCheck className="h-6 w-6 text-emerald-950" />
            </div>
            <p className="text-sm text-zinc-500">Loading SLIPPR…</p>
          </div>
        </div>
      }
    >
      <HomePage />
    </Suspense>
  );
}
