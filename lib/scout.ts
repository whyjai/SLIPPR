import axios from 'axios';
import type { BoardLeg } from './leg-board';

/**
 * SLIPPR Scout — a single research agent that studies today's real odds slate
 * and shortlists the best legs for the 10-model council to vote on.
 *
 * Flow: quant odds scan (hundreds of lines) → Scout (game-level research +
 * shortlist) → Council (independent votes on Scout's picks).
 *
 * Requires OPENROUTER_API_KEY. Optional TAVILY_API_KEY adds live injury/lineup
 * context for the top events on the slate.
 */

export type ScoutBrief = {
  conviction: number;
  thesis: string;
  factors: string[];
  riskFlags: string[];
  rank: number;
};

export type ScoutMeta = {
  enabled: boolean;
  responded: boolean;
  model: string;
  eventsResearched: number;
  slateSummary: string;
  shortlisted: number;
};

export type ScoutResult = {
  meta: ScoutMeta;
  briefs: Record<string, ScoutBrief>;
  /** Leg ids in research rank order (best first). */
  shortlistedIds: string[];
};

const SCOUT_SHORTLIST = 50;
const SCOUT_INPUT_CAP = 90;
const SCOUT_DEADLINE_MS = 55_000;

const DEFAULT_SCOUT_MODEL = 'google/gemini-2.5-flash';

const SCOUT_SYSTEM = `You are SLIPPR Scout — a professional sports betting researcher preparing today's board.
You receive TODAY's real sportsbook lines (devigged multi-book consensus, best available price, edge vs market).
Your job is NOT to pick every line — find the ACTUAL best angles for parlay builders:
- High win-probability anchors (moneyline favorites with structural edge: pitching, rest, matchup)
- Plus-EV prices vs consensus (positive edge points)
- Totals/spreads where market looks miscalibrated
- Avoid correlated duplicates (don't rank both sides of the same game highly)
- Flag trap lines (public favorites with negative edge, juice tax)

Use your sports knowledge for today's date and matchups. If live context is provided, weigh injuries and lineups.
Respond with ONLY JSON, no markdown:
{
  "slateSummary": "<1-2 sentences on today's slate>",
  "picks": [
    {
      "id": "<leg id from input>",
      "rank": 1,
      "conviction": <0-100>,
      "thesis": "<one sentence actionable thesis>",
      "factors": ["<factor>", "..."],
      "riskFlags": ["<risk or empty>"]
    }
  ]
}
Return exactly the top ${SCOUT_SHORTLIST} legs by rank (1 = best). Only use ids from the input.`;

type SlateEvent = {
  event: string;
  sport: string;
  startTime: string;
  legs: Array<{
    id: string;
    pick: string;
    market: string;
    book: string;
    americanOdds: number;
    fairProb: number;
    impliedProb: number;
    edge: number;
  }>;
};

function scoutModel(): string {
  return process.env.SCOUT_MODEL?.trim() || DEFAULT_SCOUT_MODEL;
}

function legQuantRank(leg: BoardLeg): number {
  return (
    leg.fairProb * 0.35 +
    Math.max(0, leg.edge) * 4 +
    leg.confidence * 0.25 +
    (leg.market === 'moneyline' ? 3 : leg.market === 'total' ? 1 : 0)
  );
}

/** Quant-only shortlist when Scout LLM is offline. */
export function quantShortlist(legs: BoardLeg[], limit = SCOUT_SHORTLIST): string[] {
  const byEvent = new Map<string, BoardLeg[]>();
  for (const leg of legs) {
    const key = `${leg.sport}|${leg.event}`;
    const group = byEvent.get(key) ?? [];
    group.push(leg);
    byEvent.set(key, group);
  }

  const chosen: BoardLeg[] = [];
  for (const group of byEvent.values()) {
    const sorted = [...group].sort((a, b) => legQuantRank(b) - legQuantRank(a));
    chosen.push(...sorted.slice(0, 2));
  }

  return [...chosen]
    .sort((a, b) => legQuantRank(b) - legQuantRank(a))
    .slice(0, limit)
    .map((l) => l.id);
}

function buildSlatePayload(legs: BoardLeg[]): { date: string; events: SlateEvent[] } {
  const ranked = [...legs].sort((a, b) => legQuantRank(b) - legQuantRank(a)).slice(0, SCOUT_INPUT_CAP);
  const events = new Map<string, SlateEvent>();

  for (const leg of ranked) {
    const key = `${leg.sport}|${leg.event}`;
    let entry = events.get(key);
    if (!entry) {
      entry = { event: leg.event, sport: leg.sport, startTime: leg.startTime, legs: [] };
      events.set(key, entry);
    }
    entry.legs.push({
      id: leg.id,
      pick: leg.pick,
      market: leg.market,
      book: leg.book,
      americanOdds: leg.americanOdds,
      fairProb: leg.fairProb,
      impliedProb: leg.impliedProb,
      edge: leg.edge,
    });
  }

  return {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
    events: [...events.values()],
  };
}

async function fetchLiveContext(events: SlateEvent[]): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey || events.length === 0) return '';

  const top = events.slice(0, 6);
  const snippets: string[] = [];

  await Promise.all(
    top.map(async (ev) => {
      try {
        const { data } = await axios.post(
          'https://api.tavily.com/search',
          {
            api_key: apiKey,
            query: `${ev.event} ${ev.sport} injury report lineup odds today`,
            search_depth: 'basic',
            max_results: 3,
            include_answer: true,
          },
          { timeout: 12_000 },
        );
        const answer = typeof data?.answer === 'string' ? data.answer : '';
        const hits = Array.isArray(data?.results)
          ? data.results
              .slice(0, 2)
              .map((r: { content?: string }) => r.content?.slice(0, 200))
              .filter(Boolean)
              .join(' ')
          : '';
        const text = [answer, hits].filter(Boolean).join(' ').trim();
        if (text) snippets.push(`${ev.event}: ${text.slice(0, 400)}`);
      } catch {
        // optional enrichment
      }
    }),
  );

  return snippets.length ? `Live context:\n${snippets.join('\n')}` : '';
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

async function askScout(
  apiKey: string,
  model: string,
  legs: BoardLeg[],
): Promise<{ slateSummary: string; picks: ScoutPick[] } | null> {
  const payload = buildSlatePayload(legs);
  const context = await fetchLiveContext(payload.events);
  const validIds = new Set(
    payload.events.flatMap((e) => e.legs.map((l) => l.id)),
  );

  try {
    const { data } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        temperature: 0.35,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: SCOUT_SYSTEM },
          {
            role: 'user',
            content: [
              context,
              JSON.stringify(payload),
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
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
  };
}

/** Research today's slate and shortlist legs for council review. */
export async function runScout(legs: BoardLeg[]): Promise<ScoutResult> {
  const model = scoutModel();
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey || legs.length === 0) {
    const ids = quantShortlist(legs);
    return { meta: emptyScoutMeta(model), briefs: {}, shortlistedIds: ids };
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
        slateSummary: 'Scout offline — quant shortlist sent to council.',
        shortlisted: ids.length,
      },
      briefs: {},
      shortlistedIds: ids,
    };
  }

  const briefs: Record<string, ScoutBrief> = {};
  const shortlistedIds: string[] = [];

  for (const pick of response.picks) {
    if (shortlistedIds.includes(pick.id)) continue;
    shortlistedIds.push(pick.id);
    briefs[pick.id] = {
      conviction: pick.conviction,
      thesis: pick.thesis,
      factors: pick.factors,
      riskFlags: pick.riskFlags,
      rank: pick.rank,
    };
    if (shortlistedIds.length >= SCOUT_SHORTLIST) break;
  }

  if (shortlistedIds.length < SCOUT_SHORTLIST) {
    for (const id of quantShortlist(legs)) {
      if (!shortlistedIds.includes(id)) shortlistedIds.push(id);
      if (shortlistedIds.length >= SCOUT_SHORTLIST) break;
    }
  }

  return {
    meta: {
      enabled: true,
      responded: true,
      model,
      eventsResearched: payload.events.length,
      slateSummary: response.slateSummary || `Scout shortlisted ${shortlistedIds.length} legs for council.`,
      shortlisted: shortlistedIds.length,
    },
    briefs,
    shortlistedIds,
  };
}

/** Apply Scout research to leg copy and confidence before council votes. */
export function enrichLegsWithScout(legs: BoardLeg[], scout: ScoutResult): BoardLeg[] {
  return legs.map((leg) => {
    const brief = scout.briefs[leg.id];
    if (!brief) return leg;

    const factorText = brief.factors.length ? ` ${brief.factors.join('; ')}.` : '';
    const riskText = brief.riskFlags.length ? ` Risks: ${brief.riskFlags.join(', ')}.` : '';
    const thesis = brief.thesis || leg.reasoning;

    return {
      ...leg,
      confidence: Math.round(leg.confidence * 0.35 + brief.conviction * 0.65),
      reasoning: `${thesis}${factorText}${riskText}`.trim(),
    };
  });
}
