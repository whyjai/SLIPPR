import axios from 'axios';
import type { BoardLeg } from './leg-board';
import { isAvoidMarker } from './leg-compliance';

/**
 * SLIPPR Scout — lead researcher that studies today's real odds slate and
 * shortlists only high-quality, +EV-leaning legs for the 10-model council.
 *
 * Pipeline: quant odds scan → EV pre-filter → live context (Tavily) →
 * deep research LLM → quality validation → council vote.
 */

export type ScoutBrief = {
  conviction: number;
  thesis: string;
  factors: string[];
  riskFlags: string[];
  rank: number;
  /** Blended quant + research quality score (internal ranking). */
  qualityScore: number;
};

export type ScoutMeta = {
  enabled: boolean;
  responded: boolean;
  model: string;
  eventsResearched: number;
  slateSummary: string;
  shortlisted: number;
  /** Candidates sent into deep research after EV pre-filter. */
  candidatesReviewed: number;
  /** Average edge (pts) across the final shortlist. */
  avgShortlistEdge: number;
  /** Picks dropped by post-research quality gates. */
  qualityFiltered: number;
};

export type ScoutResult = {
  meta: ScoutMeta;
  briefs: Record<string, ScoutBrief>;
  shortlistedIds: string[];
};

const SCOUT_SHORTLIST = 50;
const SCOUT_INPUT_CAP = 110;
const SCOUT_DEADLINE_MS = 60_000;
const LIVE_CONTEXT_EVENTS = 10;

const DEFAULT_SCOUT_MODEL = 'google/gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Research scoring — EV-first (matches leg-board researcher, not win-prob)
// ---------------------------------------------------------------------------

function americanToDecimal(odds: number): number {
  return odds < 0 ? 1 + 100 / -odds : 1 + odds / 100;
}

function evPerUnit(fairProbPct: number, americanOdds: number): number {
  const p = Math.min(1, Math.max(0, fairProbPct / 100));
  const dec = americanToDecimal(americanOdds);
  return p * (dec - 1) - (1 - p);
}

function oddsBandBonus(odds: number): number {
  if (odds >= -200 && odds <= 200) return 4;
  if (odds >= -280 && odds <= 280) return 2;
  return 0;
}

/** Primary ranking function for research — expected value beats raw favorites. */
export function legResearchScore(leg: BoardLeg): number {
  const evPct = evPerUnit(leg.fairProb, leg.americanOdds) * 100;
  const marketBonus =
    leg.market === 'moneyline' || leg.market === 'spread'
      ? 2
      : leg.market === 'total'
        ? 1.5
        : 0.5;
  return evPct * 8 + Math.max(0, leg.edge) * 3 + marketBonus + oddsBandBonus(leg.americanOdds);
}

function isResearchCandidate(leg: BoardLeg): boolean {
  const ev = evPerUnit(leg.fairProb, leg.americanOdds);
  return (
    leg.americanOdds >= -320 &&
    leg.americanOdds <= 320 &&
    leg.fairProb >= 32 &&
    leg.fairProb <= 85 &&
    leg.edge >= -2.5 &&
    ev > -0.06
  );
}

/** EV-first pre-filter before the LLM sees the slate. */
export function preFilterResearchCandidates(legs: BoardLeg[], limit = SCOUT_INPUT_CAP): BoardLeg[] {
  const eligible = legs.filter(isResearchCandidate);
  const pool = eligible.length >= 25 ? eligible : legs.filter((l) => l.edge >= -4);
  return [...pool].sort((a, b) => legResearchScore(b) - legResearchScore(a)).slice(0, limit);
}

/** Quant-only shortlist when Scout LLM is offline. */
export function quantShortlist(legs: BoardLeg[], limit = SCOUT_SHORTLIST): string[] {
  const candidates = preFilterResearchCandidates(legs, limit * 2);
  const byEvent = new Map<string, BoardLeg[]>();

  for (const leg of candidates) {
    const key = `${leg.sport}|${leg.event}`;
    const group = byEvent.get(key) ?? [];
    group.push(leg);
    byEvent.set(key, group);
  }

  const chosen: BoardLeg[] = [];
  for (const group of byEvent.values()) {
    const sorted = [...group].sort((a, b) => legResearchScore(b) - legResearchScore(a));
    chosen.push(...sorted.slice(0, 2));
  }

  return [...chosen]
    .sort((a, b) => legResearchScore(b) - legResearchScore(a))
    .slice(0, limit)
    .map((l) => l.id);
}

// ---------------------------------------------------------------------------
// Scout LLM prompt — sharp researcher, not a picks tout
// ---------------------------------------------------------------------------

const SCOUT_SYSTEM = `You are SLIPPR Scout — an elite sports betting RESEARCHER preparing today's council board.
You receive TODAY's real sportsbook lines with devigged multi-book consensus (fairProb %), best available price (americanOdds), implied probability, edge (fair minus implied, in points), and evPct (expected value per unit staked).

YOUR JOB: find the highest-QUALITY +EV and fairly-priced angles for serious bettors — NOT the most popular favorites.

NON-NEGOTIABLE RESEARCH RULES:
1. VALUE OVER WIN RATE: A -180 favorite with negative edge is a BAD pick. A +140 dog with +2 pts edge can rank higher.
2. TOP 20 RANKS: strongly prefer legs with edge >= 0 OR evPct > 0. Do not rank juice-tax favorites (-200 or shorter) unless edge >= +1.5.
3. PLAYER PROPS: require edge >= +1.0 or a clear matchup reason; flag thin markets with WARNING:.
4. CORRELATION: do not rank both sides of the same game in the top 15.
5. TRAPS: any public favorite with impliedProb >= 70% and edge < 0 gets riskFlags "AVOID:" — never top-25 rank.
6. THESIS QUALITY: each thesis must cite the NUMBERS (fair % vs implied %, edge, or evPct) plus one matchup/usage factor.
7. FACTORS: provide 2-4 specific, falsifiable factors (pitching, rest, pace, injury, line movement) — no generic "good matchup" fluff.
8. CONVICTION: 0-100 = your confidence the leg is +EV at THIS price, not raw win probability.

Use live context when provided (injuries, lineups, line movement). Use today's date for schedule awareness.

Respond with ONLY JSON, no markdown:
{
  "slateSummary": "<1-2 sentences: slate quality, where edges cluster>",
  "picks": [
    {
      "id": "<leg id from input>",
      "rank": 1,
      "conviction": <0-100>,
      "thesis": "<one sentence citing edge/ev + matchup>",
      "factors": ["<specific factor>", "..."],
      "riskFlags": ["AVOID: ..." | "WARNING: ..." | ""]
    }
  ]
}
Return exactly the top ${SCOUT_SHORTLIST} legs by research quality. Only use ids from the input.`;

type SlateEvent = {
  event: string;
  sport: string;
  startTime: string;
  bestEdge: number;
  legs: Array<{
    id: string;
    pick: string;
    market: string;
    book: string;
    americanOdds: number;
    fairProb: number;
    impliedProb: number;
    edge: number;
    evPct: number;
    researchScore: number;
  }>;
};

function scoutModel(): string {
  return process.env.SCOUT_MODEL?.trim() || DEFAULT_SCOUT_MODEL;
}

function buildSlatePayload(legs: BoardLeg[]): { date: string; events: SlateEvent[] } {
  const ranked = preFilterResearchCandidates(legs, SCOUT_INPUT_CAP);
  const events = new Map<string, SlateEvent>();

  for (const leg of ranked) {
    const key = `${leg.sport}|${leg.event}`;
    let entry = events.get(key);
    if (!entry) {
      entry = {
        event: leg.event,
        sport: leg.sport,
        startTime: leg.startTime,
        bestEdge: leg.edge,
        legs: [],
      };
      events.set(key, entry);
    }
    entry.bestEdge = Math.max(entry.bestEdge, leg.edge);
    entry.legs.push({
      id: leg.id,
      pick: leg.pick,
      market: leg.market,
      book: leg.book,
      americanOdds: leg.americanOdds,
      fairProb: leg.fairProb,
      impliedProb: leg.impliedProb,
      edge: leg.edge,
      evPct: Math.round(evPerUnit(leg.fairProb, leg.americanOdds) * 1000) / 10,
      researchScore: Math.round(legResearchScore(leg) * 10) / 10,
    });
  }

  const sortedEvents = [...events.values()].sort((a, b) => b.bestEdge - a.bestEdge);

  return {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
    events: sortedEvents,
  };
}

async function fetchLiveContext(events: SlateEvent[]): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey || events.length === 0) return '';

  const dateEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  );
  const top = events.slice(0, LIVE_CONTEXT_EVENTS);
  const snippets: string[] = [];

  await Promise.all(
    top.map(async (ev) => {
      try {
        const { data } = await axios.post(
          'https://api.tavily.com/search',
          {
            api_key: apiKey,
            query: `${ev.event} ${ev.sport} injury report probable starters lineup news betting odds line movement ${dateEt}`,
            search_depth: 'advanced',
            max_results: 4,
            include_answer: true,
          },
          { timeout: 14_000 },
        );
        const answer = typeof data?.answer === 'string' ? data.answer : '';
        const hits = Array.isArray(data?.results)
          ? data.results
              .slice(0, 3)
              .map((r: { content?: string; title?: string }) =>
                [r.title, r.content?.slice(0, 220)].filter(Boolean).join(': '),
              )
              .filter(Boolean)
              .join(' | ')
          : '';
        const text = [answer, hits].filter(Boolean).join(' ').trim();
        if (text) snippets.push(`[${ev.sport}] ${ev.event}: ${text.slice(0, 500)}`);
      } catch {
        // optional enrichment
      }
    }),
  );

  return snippets.length
    ? `LIVE RESEARCH CONTEXT (injuries, lineups, news — weigh heavily):\n${snippets.join('\n')}`
    : '';
}

type ScoutPick = {
  id: string;
  rank: number;
  conviction: number;
  thesis: string;
  factors: string[];
  riskFlags: string[];
};

function parseScoutResponse(raw: string, validIds: Set<string>): {
  slateSummary: string;
  picks: ScoutPick[];
} | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      slateSummary?: string;
      picks?: unknown[];
    };
    if (!Array.isArray(parsed.picks)) return null;

    const picks: ScoutPick[] = [];
    for (const entry of parsed.picks) {
      if (typeof entry !== 'object' || entry === null) continue;
      const row = entry as Record<string, unknown>;
      const id = row.id;
      if (typeof id !== 'string' || !validIds.has(id)) continue;
      picks.push({
        id,
        rank: typeof row.rank === 'number' ? row.rank : picks.length + 1,
        conviction:
          typeof row.conviction === 'number'
            ? Math.min(100, Math.max(0, Math.round(row.conviction)))
            : 55,
        thesis: typeof row.thesis === 'string' ? row.thesis.trim() : '',
        factors: Array.isArray(row.factors)
          ? row.factors.filter((f): f is string => typeof f === 'string').slice(0, 5)
          : [],
        riskFlags: Array.isArray(row.riskFlags)
          ? row.riskFlags.filter((f): f is string => typeof f === 'string').slice(0, 4)
          : [],
      });
    }

    picks.sort((a, b) => a.rank - b.rank);
    return {
      slateSummary: typeof parsed.slateSummary === 'string' ? parsed.slateSummary.trim() : '',
      picks,
    };
  } catch {
    return null;
  }
}

function scoutPickQuality(pick: ScoutPick, leg: BoardLeg): number {
  let score = legResearchScore(leg);

  const evPct = evPerUnit(leg.fairProb, leg.americanOdds) * 100;
  if (evPct > 0) score += evPct * 2;
  if (leg.edge > 0) score += leg.edge * 2;

  if (pick.riskFlags.some(isAvoidMarker)) score -= 80;
  if (pick.thesis.length < 24) score -= 12;
  if (pick.factors.length < 2) score -= 8;
  if (evPct < -1 && pick.conviction > 65) score -= 20;
  if (leg.americanOdds <= -200 && leg.edge < 0) score -= 25;
  if (leg.market === 'player_prop' && leg.edge < 1) score -= 6;

  score += pick.conviction * (evPct > 0 ? 0.12 : 0.04);
  score -= pick.rank * 0.05;

  return score;
}

function validateAndRankScoutPicks(
  picks: ScoutPick[],
  legsById: Map<string, BoardLeg>,
): { briefs: Record<string, ScoutBrief>; shortlistedIds: string[]; qualityFiltered: number } {
  const scored: Array<{ pick: ScoutPick; leg: BoardLeg; qualityScore: number }> = [];

  for (const pick of picks) {
    const leg = legsById.get(pick.id);
    if (!leg) continue;

    if (pick.riskFlags.some(isAvoidMarker)) continue;

    const qualityScore = scoutPickQuality(pick, leg);
    if (qualityScore < 0) continue;

    // Hard gate: top research picks must not be clear juice traps
    if (leg.americanOdds <= -220 && leg.edge < -1 && pick.rank <= 25) continue;

    scored.push({ pick, leg, qualityScore });
  }

  const qualityFiltered = picks.length - scored.length;

  scored.sort(
    (a, b) => b.qualityScore - a.qualityScore || a.pick.rank - b.pick.rank,
  );

  const briefs: Record<string, ScoutBrief> = {};
  const shortlistedIds: string[] = [];

  for (const { pick, qualityScore } of scored) {
    if (shortlistedIds.includes(pick.id)) continue;
    shortlistedIds.push(pick.id);
    briefs[pick.id] = {
      conviction: pick.conviction,
      thesis: pick.thesis,
      factors: pick.factors,
      riskFlags: pick.riskFlags,
      rank: pick.rank,
      qualityScore: Math.round(qualityScore * 10) / 10,
    };
    if (shortlistedIds.length >= SCOUT_SHORTLIST) break;
  }

  return { briefs, shortlistedIds, qualityFiltered };
}

async function askScout(
  apiKey: string,
  model: string,
  legs: BoardLeg[],
): Promise<{ slateSummary: string; picks: ScoutPick[] } | null> {
  const payload = buildSlatePayload(legs);
  const context = await fetchLiveContext(payload.events);
  const validIds = new Set(payload.events.flatMap((e) => e.legs.map((l) => l.id)));

  const userContent = [
    context,
    'SLATE DATA (pre-sorted by research value — prioritize +edge and +evPct):',
    JSON.stringify(payload),
    `Research mandate: return the ${SCOUT_SHORTLIST} highest-quality legs. Top ranks must beat or match market price (edge >= 0 preferred).`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const { data } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        temperature: 0.2,
        max_tokens: 6000,
        messages: [
          { role: 'system', content: SCOUT_SYSTEM },
          { role: 'user', content: userContent },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://slippr.vercel.app',
          'X-Title': 'SLIPPR Scout',
        },
        timeout: SCOUT_DEADLINE_MS,
      },
    );

    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    return parseScoutResponse(content, validIds);
  } catch {
    return null;
  }
}

function emptyScoutMeta(model: string): ScoutMeta {
  return {
    enabled: false,
    responded: false,
    model,
    eventsResearched: 0,
    slateSummary: '',
    shortlisted: 0,
    candidatesReviewed: 0,
    avgShortlistEdge: 0,
    qualityFiltered: 0,
  };
}

function avgEdgeForIds(ids: string[], legsById: Map<string, BoardLeg>): number {
  if (ids.length === 0) return 0;
  const sum = ids.reduce((acc, id) => acc + (legsById.get(id)?.edge ?? 0), 0);
  return Math.round((sum / ids.length) * 10) / 10;
}

/** Research today's slate and shortlist legs for council review. */
export async function runScout(legs: BoardLeg[]): Promise<ScoutResult> {
  const model = scoutModel();
  const apiKey = process.env.OPENROUTER_API_KEY;
  const legsById = new Map(legs.map((l) => [l.id, l]));
  const candidates = preFilterResearchCandidates(legs, SCOUT_INPUT_CAP);

  if (!apiKey || legs.length === 0) {
    const ids = quantShortlist(legs);
    return {
      meta: {
        ...emptyScoutMeta(model),
        shortlisted: ids.length,
        candidatesReviewed: candidates.length,
        avgShortlistEdge: avgEdgeForIds(ids, legsById),
      },
      briefs: {},
      shortlistedIds: ids,
    };
  }

  const payload = buildSlatePayload(legs);
  const response = await Promise.race([
    askScout(apiKey, model, legs),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SCOUT_DEADLINE_MS)),
  ]);

  if (!response || response.picks.length === 0) {
    const ids = quantShortlist(legs);
    return {
      meta: {
        enabled: true,
        responded: false,
        model,
        eventsResearched: payload.events.length,
        slateSummary: 'Scout offline — EV-ranked quant shortlist sent to council.',
        shortlisted: ids.length,
        candidatesReviewed: candidates.length,
        avgShortlistEdge: avgEdgeForIds(ids, legsById),
        qualityFiltered: 0,
      },
      briefs: {},
      shortlistedIds: ids,
    };
  }

  const { briefs, shortlistedIds, qualityFiltered } = validateAndRankScoutPicks(
    response.picks,
    legsById,
  );

  const finalIds = [...shortlistedIds];
  if (finalIds.length < SCOUT_SHORTLIST) {
    for (const id of quantShortlist(legs)) {
      if (!finalIds.includes(id)) finalIds.push(id);
      if (finalIds.length >= SCOUT_SHORTLIST) break;
    }
  }

  return {
    meta: {
      enabled: true,
      responded: true,
      model,
      eventsResearched: payload.events.length,
      slateSummary:
        response.slateSummary ||
        `Scout researched ${candidates.length} candidates → ${finalIds.length} quality legs for council.`,
      shortlisted: finalIds.length,
      candidatesReviewed: candidates.length,
      avgShortlistEdge: avgEdgeForIds(finalIds, legsById),
      qualityFiltered,
    },
    briefs,
    shortlistedIds: finalIds,
  };
}

/** Apply Scout research to leg copy and confidence before council votes. */
export function enrichLegsWithScout(legs: BoardLeg[], scout: ScoutResult): BoardLeg[] {
  return legs.map((leg) => {
    const brief = scout.briefs[leg.id];
    if (!brief) return leg;

    const evPct = evPerUnit(leg.fairProb, leg.americanOdds) * 100;
    const factorText = brief.factors.length ? ` ${brief.factors.join('; ')}.` : '';
    const riskText = brief.riskFlags.length ? ` Risks: ${brief.riskFlags.join(', ')}.` : '';
    const thesis = brief.thesis || leg.reasoning;

    // Weight scout conviction higher only when quant agrees there's value
    const scoutWeight = evPct > 0 || leg.edge > 0 ? 0.55 : 0.25;

    return {
      ...leg,
      confidence: Math.round(leg.confidence * (1 - scoutWeight) + brief.conviction * scoutWeight),
      reasoning: `${thesis}${factorText}${riskText}`.trim(),
    };
  });
}
