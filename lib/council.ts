import axios from 'axios';

/**
 * The real AI council: 10 of the strongest models available at $0 on
 * OpenRouter, each independently grading the candidate legs surfaced by the
 * quantitative scan. A leg makes the board only when >= 70% of responding
 * models approve it.
 *
 * Requires OPENROUTER_API_KEY. Free-model rate limits are ~50 req/day on a
 * $0 account and 1,000/day once a one-time $10 credit sits on the account
 * (the models themselves remain free). Override the seat list with a
 * comma-separated COUNCIL_MODELS env var if any free model id rotates.
 */

// Hybrid council: 7 cheap paid models across 7 vendors (reliable structured
// output, ~$1/mo at 8 boards/day) + 3 reliable free models. OpenRouter's `:free`
// endpoints are chronically flaky and the capable ones (nemotron etc.) are
// reasoning models that break the JSON grading format — verified 2026-07 that
// only these produce clean votes. Slugs rotate; override with COUNCIL_MODELS.
// All-paid, 9-vendor council chosen for RELIABILITY (each verified to answer +
// return parseable JSON across repeated pings). Free OpenRouter models were
// dropped — they error too often to sustain a full council. Cost is ~$1-2/mo at
// 8 sessions/day. Slugs rotate; override with COUNCIL_MODELS.
const DEFAULT_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4.1-mini',
  'anthropic/claude-3-haiku',
  'amazon/nova-lite-v1',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'meta-llama/llama-3.3-70b-instruct',
  'mistralai/mistral-small-24b-instruct-2501',
  'cohere/command-r-08-2024',
  'qwen/qwen-2.5-72b-instruct',
];

export type CouncilCandidate = {
  id: string;
  sport: string;
  market: string;
  event: string;
  pick: string;
  americanOdds: number;
  impliedProb: number;
  fairProb: number;
  edge: number;
  /** Scout research thesis — council should weigh this alongside market data. */
  scoutNote?: string;
  conviction?: number;
  factors?: string[];
  /** Scout blended EV research score — higher = stronger pre-council signal. */
  scoutQuality?: number;
};

export type CouncilSeat = {
  model: string;
  responded: boolean;
};

export type CouncilLegVerdict = {
  approvals: number;
  votes: number;
  avgConfidence: number;
};

export type CouncilResult = {
  enabled: boolean;
  responded: number;
  seats: CouncilSeat[];
  byLeg: Record<string, CouncilLegVerdict>;
};

const SYSTEM_PROMPT = `You are one independent seat on a 10-model council of SHARP professional sports bettors.
You live and die by EXPECTED VALUE, not by picking favorites. A -2000 favorite with no edge is a bad bet; a +140 underdog priced too long is a great one.

You receive candidate legs from today's real sportsbook lines. Each includes: the devigged multi-book consensus win probability (fairProb %), the best available price (americanOdds) and its implied probability, the edge (fairProb minus implied, in points), and optional Scout research (thesis, conviction, scoutQuality).

Scout has already pre-filtered for +EV angles. Trust scoutQuality and edge together — low scoutQuality with negative edge should be rejected even if it "feels" like a safe favorite.
- Reward legs where the offered price pays MORE than the true probability warrants (positive edge / +EV). Punish no-payout favorites and lottery longshots.
- Player props and totals are noisier than moneylines/spreads — demand more edge before approving them.
- Be suspicious of edges that look too good (>6-7 points usually means stale or bad data) and of legs with thin book consensus.

Respond with ONLY a JSON array, no prose, one entry per leg:
[{"id":"<leg id>","confidence":<0-100 integer>,"approve":<true|false>}]
confidence = your estimate of the leg's true win probability (0-100).
approve = true ONLY if you believe the leg is +EV at the offered price. Approve SPARINGLY — most legs are not +EV.`;

function getModels(): string[] {
  const env = process.env.COUNCIL_MODELS;
  if (env) {
    const models = env.split(',').map((m) => m.trim()).filter(Boolean);
    if (models.length > 0) return models.slice(0, 10);
  }
  return DEFAULT_MODELS;
}

type Vote = { confidence: number; approve: boolean };

function parseVotes(raw: string, validIds: Set<string>): Map<string, Vote> | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;

    const votes = new Map<string, Vote>();
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { id, confidence, approve } = entry as Record<string, unknown>;
      if (typeof id !== 'string' || !validIds.has(id)) continue;
      const conf = typeof confidence === 'number' ? Math.min(100, Math.max(0, confidence)) : 50;
      votes.set(id, { confidence: conf, approve: approve === true });
    }
    return votes.size > 0 ? votes : null;
  } catch {
    return null;
  }
}

async function askModelOnce(
  apiKey: string,
  model: string,
  candidates: CouncilCandidate[],
  validIds: Set<string>,
): Promise<Map<string, Vote> | null> {
  try {
    const { data } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        temperature: 0.2,
        max_tokens: 2500,
        // Let OpenRouter route around a failing upstream provider.
        provider: { allow_fallbacks: true },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(candidates) },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://slippr.vercel.app',
          'X-Title': 'SLIPPR Council',
        },
        timeout: 40000,
      },
    );

    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    return parseVotes(content, validIds);
  } catch {
    return null;
  }
}

/**
 * Ask a model for its votes, retrying once on a transient failure. OpenRouter's
 * "Provider returned error" is usually transient, so a single quick retry pushes
 * the council's response rate close to 100%.
 */
async function askModel(
  apiKey: string,
  model: string,
  candidates: CouncilCandidate[],
  validIds: Set<string>,
): Promise<Map<string, Vote> | null> {
  const first = await askModelOnce(apiKey, model, candidates, validIds);
  if (first) return first;
  await new Promise((r) => setTimeout(r, 600));
  return askModelOnce(apiKey, model, candidates, validIds);
}

export async function runCouncil(candidates: CouncilCandidate[]): Promise<CouncilResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const models = getModels();

  if (!apiKey || candidates.length === 0) {
    return {
      enabled: false,
      responded: 0,
      seats: models.map((model) => ({ model, responded: false })),
      byLeg: {},
    };
  }

  const validIds = new Set(candidates.map((c) => c.id));

  // Hard ceiling on the whole council step. Individual axios timeouts can fail
  // to fire on hung keep-alive connections (e.g. free-tier models with no
  // credit), which would otherwise block board generation for minutes. Any seat
  // that hasn't answered by the deadline is counted as a non-response.
  // Generous enough for a first attempt + one retry on the slow seats. Only the
  // cron pays this cost (maxDuration 300s); users read the cached board.
  const COUNCIL_DEADLINE_MS = 95000;
  const results = await Promise.all(
    models.map((model) =>
      Promise.race([
        askModel(apiKey, model, candidates, validIds),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), COUNCIL_DEADLINE_MS)),
      ]).then((votes) => ({ model, votes })),
    ),
  );

  const byLeg: Record<string, CouncilLegVerdict> = {};
  for (const candidate of candidates) {
    let approvals = 0;
    let votes = 0;
    let confidenceSum = 0;

    for (const { votes: modelVotes } of results) {
      const vote = modelVotes?.get(candidate.id);
      if (!vote) continue;
      votes += 1;
      confidenceSum += vote.confidence;
      if (vote.approve) approvals += 1;
    }

    byLeg[candidate.id] = {
      approvals,
      votes,
      avgConfidence: votes > 0 ? Math.round(confidenceSum / votes) : 0,
    };
  }

  return {
    enabled: true,
    responded: results.filter((r) => r.votes !== null).length,
    seats: results.map((r) => ({ model: r.model, responded: r.votes !== null })),
    byLeg,
  };
}

/** A leg passes council when at least 70% of seats that voted on it approve. */
export function passesCouncil(verdict: CouncilLegVerdict | undefined, responded: number): boolean {
  if (responded === 0) return true; // council offline -> quant board stands
  if (!verdict || verdict.votes === 0) return false;
  return verdict.approvals >= Math.ceil(verdict.votes * 0.7);
}
