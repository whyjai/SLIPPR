import type { ReactNode } from 'react';
import type { PropEdge, PropEdgesResult } from './prop-edges';
import { BOARD_TZ, todayEtLabel } from './slate';

/**
 * Daily promo slip: the highest-probability standard pick'em plays from the
 * latest Prop Edges scan (one per game), rendered in SLIPPR's theme by
 * /api/og/daily-slip via next/og.
 */

export const SLIP_SIZE = 6;
const MIN_SLIP = 2;

/** Standard Power Play payouts (all picks must hit). Confirm in-app — tables change. */
const POWER_PAYOUTS: Record<string, Record<number, number>> = {
  PrizePicks: { 2: 3, 3: 5, 4: 10, 5: 20, 6: 37.5 },
};

export type DailySlip = {
  dateLabel: string;
  sports: string[];
  picks: PropEdge[];
  platform: string;
  payout: number | null;
  hitAll: number; // %
  randomHitAll: number; // %
  ev: number | null; // % per $1
  avgWin: number; // %
  asOf: string; // "3:06 PM ET"
  sharpOnly: boolean;
};

const etTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: BOARD_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export function buildDailySlip(result: PropEdgesResult): DailySlip | null {
  // Only flat-payout pick'em plays with a known matchup; the payout math and a
  // public post both depend on those. 0.5 lines are skipped: apps usually list
  // them as discounted (goblin) picks, so the standard payout wouldn't apply.
  const eligible = result.edges
    .filter((e) => e.breakevenBasis === 'entry' && e.lineMatch !== 'estimated' && e.event && e.line !== 0.5)
    .sort((a, b) => b.winProb - a.winProb || b.edge - a.edge);

  const picks: PropEdge[] = [];
  const games = new Set<string>();
  for (const e of eligible) {
    if (games.has(e.event)) continue; // one per game keeps legs ~independent
    games.add(e.event);
    picks.push(e);
    if (picks.length === SLIP_SIZE) break;
  }
  if (picks.length < MIN_SLIP) return null;

  // Most common platform among the picks (all PrizePicks in sharp-only mode).
  const counts = new Map<string, number>();
  picks.forEach((p) => counts.set(p.platform, (counts.get(p.platform) ?? 0) + 1));
  const platform = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const payout = POWER_PAYOUTS[platform]?.[picks.length] ?? null;

  const hitAll = picks.reduce((acc, p) => acc * (p.winProb / 100), 1);
  return {
    dateLabel: todayEtLabel().toUpperCase().replace(/,/g, ' ·'),
    sports: [...new Set(picks.map((p) => p.sport))],
    picks,
    platform,
    payout,
    hitAll: hitAll * 100,
    randomHitAll: 0.5 ** picks.length * 100,
    ev: payout != null ? (payout * hitAll - 1) * 100 : null,
    avgWin: picks.reduce((s, p) => s + p.winProb, 0) / picks.length,
    asOf: `${etTime(result.generatedAt)} ET`,
    sharpOnly: result.source === 'sharp-only',
  };
}

// ---------------------------------------------------------------------------
// Graphic (Satori: every multi-child div needs display:flex)
// ---------------------------------------------------------------------------

// SLIPPR theme tokens (app/globals.css)
const BG = '#070709';
const SURFACE = '#0c0c0f';
const ACCENT = '#10b981';
const BRIGHT = '#34d399';
const MINT = '#a7f3d0';
const FG = '#fafafa';
const MUTED = '#a1a1aa';
const DIM = '#71717a';
const BORDER = 'rgba(255,255,255,0.07)';

const TWO_WORD_NICKNAMES = new Set(['Red Sox', 'White Sox', 'Blue Jays', 'Golden Knights', 'Maple Leafs', 'Trail Blazers']);

/** "Los Angeles Angels @ Athletics" → "Angels @ Athletics" */
function shortMatchup(event: string): string {
  return event
    .split(' @ ')
    .map((team) => {
      const words = team.split(' ');
      const lastTwo = words.slice(-2).join(' ');
      return TWO_WORD_NICKNAMES.has(lastTwo) ? lastTwo : words[words.length - 1];
    })
    .join(' @ ');
}

// Satori drops whitespace next to inline separators; non-breaking spaces survive.
const sep = (...parts: string[]) => parts.join(' · ');

function Shield() {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={BRIGHT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function Mono({ children, size, color, weight = 600 }: { children: ReactNode; size: number; color: string; weight?: number }) {
  return <span style={{ fontFamily: 'Geist Mono', fontSize: size, color, fontWeight: weight }}>{children}</span>;
}

function PickRow({ p, i }: { p: PropEdge; i: number }) {
  // Bar spans 50%→70% so differences between 63% and 66% are visible.
  const pct = Math.max(0, Math.min(1, (p.winProb - 50) / 20));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        padding: '13px 26px',
        borderRadius: 20,
        border: `1px solid ${BORDER}`,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: 44,
          height: 44,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(16,185,129,0.12)',
          border: '1px solid rgba(16,185,129,0.3)',
        }}
      >
        <Mono size={20} color={BRIGHT} weight={700}>
          {i + 1}
        </Mono>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: FG, letterSpacing: -0.5 }}>{p.player}</span>
          <span style={{ fontSize: 24, fontWeight: 600, color: p.side === 'over' ? BRIGHT : '#7dd3fc' }}>
            {`${p.side === 'over' ? 'O' : 'U'} ${p.line}`}
          </span>
          <span style={{ fontSize: 22, fontWeight: 500, color: MUTED }}>{p.market}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Mono size={17} color={DIM} weight={500}>
            {sep(shortMatchup(p.event), `${etTime(p.startTime)} ET`)}
          </Mono>
          <div style={{ display: 'flex', width: 180, height: 6, borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}>
            <div
              style={{
                display: 'flex',
                width: `${pct * 100}%`,
                height: 6,
                borderRadius: 6,
                background: `linear-gradient(90deg, #059669, ${BRIGHT})`,
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <Mono size={32} color={BRIGHT} weight={700}>
          {`${p.winProb.toFixed(1)}%`}
        </Mono>
        <span style={{ fontSize: 15, fontWeight: 600, color: DIM, letterSpacing: 1.5 }}>TO HIT</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: 4,
        padding: '16px 22px',
        borderRadius: 20,
        border: `1px solid ${BORDER}`,
        background: SURFACE,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: DIM, letterSpacing: 2 }}>{label}</span>
      <span style={{ fontSize: 30, fontWeight: 800, color: FG, letterSpacing: -1 }}>{value}</span>
      <span style={{ fontSize: 16, fontWeight: 500, color: MUTED }}>{sub}</span>
    </div>
  );
}

function Frame({ chip, children }: { chip: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '50px 60px 40px',
        background: BG,
        backgroundImage:
          'radial-gradient(900px 520px at 85% -8%, rgba(16,185,129,0.22), transparent 70%), radial-gradient(700px 500px at -10% 105%, rgba(16,185,129,0.10), transparent 70%)',
        fontFamily: 'Geist',
        color: FG,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              width: 58,
              height: 58,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(16,185,129,0.12)',
              border: '1.5px solid rgba(16,185,129,0.35)',
            }}
          >
            <Shield />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>SLIPPR</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: DIM, letterSpacing: 3 }}>AI PARLAY INTELLIGENCE</span>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 18px',
            borderRadius: 999,
            border: '1px solid rgba(16,185,129,0.3)',
            background: 'rgba(16,185,129,0.08)',
          }}
        >
          <div style={{ display: 'flex', width: 9, height: 9, borderRadius: 9, background: BRIGHT }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: MINT, letterSpacing: 2 }}>{chip}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function Headline({ sub }: { sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 36, gap: 14 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: ACCENT, letterSpacing: 3 }}>PICK&apos;EM VS SHARP</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
        <span style={{ fontSize: 72, fontWeight: 800, letterSpacing: -3, lineHeight: 1 }}>Tonight&apos;s</span>
        <span
          style={{
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: -3,
            lineHeight: 1,
            backgroundImage: `linear-gradient(135deg, ${BRIGHT} 0%, #6ee7b7 45%, ${MINT} 100%)`,
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Sharp Slip.
        </span>
      </div>
      <span style={{ fontSize: 22, fontWeight: 500, color: MUTED, lineHeight: 1.4 }}>{sub}</span>
    </div>
  );
}

function Footer({ fine }: { fine: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 19, fontWeight: 600, color: FG }}>
          Every prop, checked against the sharpest line. Every refresh.
        </span>
        <Mono size={19} color={BRIGHT} weight={600}>
          slippr.vercel.app
        </Mono>
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 500, color: DIM, lineHeight: 1.45 }}>{fine}</span>
    </div>
  );
}

const RESPONSIBLE = '21+. Research only. Gambling problem? Call 1-800-GAMBLER.';

export function SlipGraphic({ slip }: { slip: DailySlip }) {
  const lo = Math.floor(Math.min(...slip.picks.map((p) => p.winProb)));
  const hi = Math.ceil(Math.max(...slip.picks.map((p) => p.winProb)));
  const n = slip.picks.length;
  const lineWord = slip.sharpOnly ? 'confirm each pick is a standard line in your app' : 'lines move — confirm in your app';

  return (
    <Frame chip={sep(slip.dateLabel, slip.sports.join(' + '))}>
      <Headline sub={`The sharpest book prices these at ${lo}–${hi}%. Pick'em apps pay them like coin flips.`} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 28 }}>
        {slip.picks.map((p, i) => (
          <PickRow key={p.id} p={p} i={i} />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          padding: '18px 28px',
          borderRadius: 20,
          border: '1.5px solid rgba(16,185,129,0.4)',
          background: 'linear-gradient(90deg, rgba(16,185,129,0.16), rgba(16,185,129,0.04))',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: BRIGHT, letterSpacing: 2.5 }}>BEST PAYOUT TONIGHT</span>
          <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>
            {slip.payout != null ? sep(slip.platform, `${n}-Pick Power`) : slip.platform}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <Mono size={46} color={BRIGHT} weight={700}>
            {slip.payout != null ? `${slip.payout}x` : 'Flat'}
          </Mono>
          <span style={{ fontSize: 15, fontWeight: 500, color: MUTED }}>{sep('flat payout', 'no juice')}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <Stat
          label={`HIT ALL ${n}`}
          value={`${slip.hitAll.toFixed(1)}%`}
          sub={`vs ${slip.randomHitAll.toFixed(1)}% for a random slip`}
        />
        {slip.ev != null && (
          <Stat
            label="EXPECTED VALUE"
            value={`${slip.ev >= 0 ? '+' : ''}${Math.round(slip.ev)}%`}
            sub={`at ${slip.payout}x, per $1 entered`}
          />
        )}
        <Stat label="AVG WIN %" value={`${slip.avgWin.toFixed(1)}%`} sub="Pinnacle no-vig" />
      </div>

      <Footer
        fine={`Lines as of ${slip.asOf} — ${lineWord}. Win % is a market estimate, not a guarantee. ${RESPONSIBLE}`}
      />
    </Frame>
  );
}

export function EmptySlipGraphic() {
  return (
    <Frame chip={todayEtLabel().toUpperCase().replace(/,/g, ' ·')}>
      <Headline sub="Today's slate is still loading. The sharp slip drops once props are posted." />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          marginTop: 60,
          height: 520,
          borderRadius: 24,
          border: `1px solid ${BORDER}`,
          background: SURFACE,
        }}
      >
        <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>Slip incoming.</span>
        <span style={{ fontSize: 22, fontWeight: 500, color: MUTED }}>Check back before first pitch.</span>
      </div>
      <Footer fine={RESPONSIBLE} />
    </Frame>
  );
}
