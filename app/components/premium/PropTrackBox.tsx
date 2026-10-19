'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';

type TrackSummary = {
  props: number;
  lines: number;
  overMedian: number | null;
  underAverage: number | null;
  insideMiddle50: number | null;
  brier: { sheet: number | null; ownHitRate: number | null; coinFlip: number | null };
  calibration: Array<{ from: number; to: number; said: number | null; happened: number | null; n: number }>;
};
type Track = {
  updatedAt: string;
  overall: TrackSummary;
  weeks?: Array<TrackSummary & { week: number; pending: number }>;
  days?: Array<TrackSummary & { date: string; pending: number }>;
  rebuilt?: { overall: TrackSummary; weeks: Array<TrackSummary & { week: number }> };
};

const p100 = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export default function PropTrackBox({ url }: { url: string }) {
  const [track, setTrack] = useState<Track | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && j && setTrack(j as Track))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!track) return null;
  const live = track.overall;
  const rebuilt = track.rebuilt?.overall;
  const row = (label: string, t: TrackSummary | undefined, weeks: string) =>
    t && t.props > 0 ? (
      <tr className="border-t border-white/[0.04]">
        <td className="py-1.5 pr-3 font-sans text-zinc-300">
          {label} <span className="text-zinc-500">{weeks}</span>
        </td>
        <td className="pr-3 text-right">{t.props}</td>
        <td className="pr-3 text-right">{p100(t.overMedian)}</td>
        <td className="pr-3 text-right">{p100(t.insideMiddle50)}</td>
        <td className="pr-3 text-right">{p100(t.underAverage)}</td>
        <td className="text-right">
          <span className="text-emerald-300">{t.brier.sheet?.toFixed(3)}</span>{' '}
          <span className="text-zinc-500">
            vs {t.brier.ownHitRate?.toFixed(3)} / {t.brier.coinFlip?.toFixed(3)}
          </span>
        </td>
      </tr>
    ) : null;
  const cal = (live.lines ? live : rebuilt)?.calibration ?? [];
  return (
    <Card className="mb-6 p-5">
      <h3 className="mb-1 text-sm font-semibold">How the sheet has done</h3>
      <p className="mb-3 text-xs text-zinc-500">
        Frozen before kickoff, graded against the box scores. Targets: 50% over the median, 50% inside the middle range;
        Brier score is the accuracy of the chance-over numbers (lower is better) against the player&apos;s own hit rate and a
        coin flip. Updated {track.updatedAt.slice(0, 10)}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] font-mono text-xs text-zinc-300">
          <thead className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Sheets</th>
              <th className="pr-3 text-right font-medium">Props</th>
              <th className="pr-3 text-right font-medium">Over median</th>
              <th className="pr-3 text-right font-medium">In middle 50%</th>
              <th className="pr-3 text-right font-medium">Under avg</th>
              <th className="text-right font-medium">Brier · own rate / coin</th>
            </tr>
          </thead>
          <tbody>
            {row(
              'Live',
              live,
              track.weeks
                ? track.weeks.map((w) => `W${w.week}${w.pending ? '*' : ''}`).join(' ')
                : `${(track.days ?? []).length} slates${(track.days ?? []).some((d) => d.pending) ? '*' : ''}`,
            )}
            {row('Rebuilt', rebuilt, (track.rebuilt?.weeks ?? []).map((w) => `W${w.week}`).join(' '))}
          </tbody>
        </table>
      </div>
      {cal.length > 0 && (
        <p className="mt-3 font-mono text-xs text-zinc-400">
          Said → happened:{' '}
          {cal
            .filter((c) => c.n > 0)
            .map((c) => `${c.said}% → ${p100(c.happened)}`)
            .join(' · ')}
        </p>
      )}
      {[...(track.weeks ?? []), ...(track.days ?? [])].some((w) => w.pending) && <p className="mt-1 text-[10px] text-zinc-600">* some games still to be graded</p>}
    </Card>
  );
}
