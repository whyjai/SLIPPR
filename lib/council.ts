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

// Verified against OpenRouter's live free-model list (slugs rotate; these were
// current as of 2026-07). Free variants need a small credit balance on the
// account to be reliable — with $0 credits most return "Provider returned
// error". Override with a comma-separated COUNCIL_MODELS env var if any rotate.
const DEFAULT_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
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

const SYSTEM_PROMPT = `You are one independent seat on a 10-model sports betting analysis council.
You receive candidate parlay legs with market-derived probabilities (devigged multi-book consensus).
For each leg, judge whether it belongs on a board of the day's highest-probability, highest-value picks.
Consider: the market consensus probability, the edge vs the best available price, market type risk
(player props are noisier than moneylines), and whether the implied probability looks miscalibrated.
Respond with ONLY a JSON array, no prose, one entry per leg:
[{"id":"<leg id>","confidence":<0-100 integer>,"approve":<true|false>}]
Approve a leg only if you believe its true win probability is at least its stated fair probability minus 3 points.`;

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

async function askModel(
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
        max_tokens: 4000,
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
        timeout: 20000,
      },
    );

    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    return parseVotes(content, validIds);
  } catch {
    return null;
  }
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
  const COUNCIL_DEADLINE_MS = 25000;
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

/** A leg passes council when at least 70% of responding seats approve. */
export function passesCouncil(verdict: CouncilLegVerdict | undefined, responded: number): boolean {
  if (!verdict || responded === 0) return true; // council offline -> quant board stands
  if (verdict.votes === 0) return false;
  return verdict.approvals >= Math.ceil(verdict.votes * 0.7);
}
