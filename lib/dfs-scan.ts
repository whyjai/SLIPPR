import axios from 'axios';

/**
 * DFS pick'em scanner: pulls public projection feeds from PrizePicks and
 * Underdog, cross-matches player+stat lines between the two sites, and
 * surfaces two things:
 *
 * 1. Line-shopping legs — when the two sites post different lines for the
 *    same player+stat, taking the Over at the softer (lower) line or the
 *    Under at the harder (higher) line carries measurable edge.
 * 2. Predatory warnings — boosted/discounted "demon & goblin" style entries
 *    (non-standard payout multipliers), combo props with elevated house
 *    edge, and large cross-site line discrepancies.
 *
 * Both feeds are unofficial public JSON endpoints and can be geo/bot
 * blocked; every fetch fails soft and returns empty results.
 */

export type DfsProjection = {
  site: 'PrizePicks' | 'Underdog';
  player: string;
  statType: string;
  line: number;
  league: string;
  oddsType: string; // 'standard' | 'demon' | 'goblin' | 'boosted' | etc.
};

export type DfsEdgeLeg = {
  id: string;
  player: string;
  statType: string;
  league: string;
  pick: string; // e.g. "Aaron Judge Over 1.5 Total Bases"
  site: 'PrizePicks' | 'Underdog';
  line: number;
  otherSite: string;
  otherLine: number;
  gapPct: number;
};

export type DfsScanResult = {
  projections: DfsProjection[];
  edgeLegs: DfsEdgeLeg[];
  warnings: string[];
  sitesReached: string[];
};

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  Accept: 'application/json',
};

const COMBO_STATS = /(\+|pts\s*\+|rebs?\s*\+|asts?\s*\+|fantasy)/i;

// ---------------------------------------------------------------------------
// PrizePicks — JSON:API format: data[] projections, included[] players
// ---------------------------------------------------------------------------

type PrizePicksResponse = {
  data?: Array<{
    id: string;
    attributes?: {
      line_score?: number;
      stat_type?: string;
      odds_type?: string;
    };
    relationships?: {
      new_player?: { data?: { id?: string } };
      league?: { data?: { id?: string } };
    };
  }>;
  included?: Array<{
    id: string;
    type: string;
    attributes?: { name?: string; display_name?: string; league?: string };
  }>;
};

async function fetchPrizePicks(): Promise<DfsProjection[]> {
  try {
    const { data } = await axios.get<PrizePicksResponse>(
      'https://api.prizepicks.com/projections',
      {
        params: { per_page: 250, single_stat: true },
        headers: BROWSER_HEADERS,
        timeout: 8000,
      },
    );

    const players = new Map<string, { name: string; league: string }>();
    for (const item of data.included ?? []) {
      if (item.type === 'new_player') {
        players.set(item.id, {
          name: item.attributes?.display_name ?? item.attributes?.name ?? 'Unknown',
          league: item.attributes?.league ?? '',
        });
      }
    }

    const projections: DfsProjection[] = [];
    for (const proj of data.data ?? []) {
      const line = proj.attributes?.line_score;
      const stat = proj.attributes?.stat_type;
      const playerId = proj.relationships?.new_player?.data?.id;
      if (line == null || !stat || !playerId) continue;
      const player = players.get(playerId);
      if (!player) continue;

      projections.push({
        site: 'PrizePicks',
        player: player.name,
        statType: stat,
        line,
        league: player.league,
        oddsType: proj.attributes?.odds_type ?? 'standard',
      });
    }
    return projections;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Underdog — over_under_lines[] with nested appearance/player data
// ---------------------------------------------------------------------------

type UnderdogResponse = {
  over_under_lines?: Array<{
    stat_value?: string;
    over_under?: {
      title?: string;
      appearance_stat?: { display_stat?: string; stat?: string };
    };
  }>;
  players?: Array<{ id?: string; first_name?: string; last_name?: string }>;
};

async function fetchUnderdog(): Promise<DfsProjection[]> {
  try {
    const { data } = await axios.get<UnderdogResponse>(
      'https://api.underdogfantasy.com/beta/v5/over_under_lines',
      { headers: BROWSER_HEADERS, timeout: 8000 },
    );

    const projections: DfsProjection[] = [];
    for (const entry of data.over_under_lines ?? []) {
      const line = Number(entry.stat_value);
      const title = entry.over_under?.title ?? '';
      const stat =
        entry.over_under?.appearance_stat?.display_stat ??
        entry.over_under?.appearance_stat?.stat ??
        '';
      if (!Number.isFinite(line) || !title || !stat) continue;

      // Title format: "Player Name Points" — strip the stat suffix for the name.
      const player = title.replace(new RegExp(`\\s*${escapeRegExp(stat)}\\s*$`, 'i'), '').trim();
      if (!player) continue;

      projections.push({
        site: 'Underdog',
        player,
        statType: stat,
        line,
        league: '',
        oddsType: 'standard',
      });
    }
    return projections;
  } catch {
    return [];
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Cross-site matching
// ---------------------------------------------------------------------------

function normKey(player: string, stat: string): string {
  return `${player.toLowerCase().replace(/[^a-z]/g, '')}|${stat
    .toLowerCase()
    .replace(/[^a-z]/g, '')}`;
}

export async function scanDfsSites(): Promise<DfsScanResult> {
  const [prizePicks, underdog] = await Promise.all([fetchPrizePicks(), fetchUnderdog()]);
  const projections = [...prizePicks, ...underdog];
  const warnings: string[] = [];
  const edgeLegs: DfsEdgeLeg[] = [];

  const sitesReached = [
    ...(prizePicks.length > 0 ? ['PrizePicks'] : []),
    ...(underdog.length > 0 ? ['Underdog'] : []),
  ];

  // Predatory: non-standard payout entries (demons/goblins) — the multiplier
  // discount is priced against the player far more than the line move implies.
  const nonStandard = prizePicks.filter((p) => p.oddsType !== 'standard');
  for (const p of nonStandard.slice(0, 5)) {
    warnings.push(
      `PrizePicks "${p.oddsType}" entry on ${p.player} ${p.statType} ${p.line} — non-standard payout entries carry a house edge well above the standard board. Avoid.`,
    );
  }

  // Predatory: combo/fantasy-score props are correlated bundles priced with
  // extra margin on both DFS sites and sportsbooks.
  const comboCount = projections.filter((p) => COMBO_STATS.test(p.statType)).length;
  if (comboCount > 0) {
    warnings.push(
      `${comboCount} combo props (Pts+Rebs+Asts / fantasy score style) live across DFS boards — bundled stats hide extra house edge vs single-stat lines.`,
    );
  }

  // Line shopping: same player+stat on both sites with a meaningful gap.
  const ppByKey = new Map(prizePicks.map((p) => [normKey(p.player, p.statType), p]));
  for (const ud of underdog) {
    const pp = ppByKey.get(normKey(ud.player, ud.statType));
    if (!pp || pp.line <= 0 || ud.line <= 0) continue;

    const gapPct = Math.abs(pp.line - ud.line) / Math.min(pp.line, ud.line);
    if (gapPct < 0.04) continue;

    const softer = pp.line < ud.line ? pp : ud;
    const harder = pp.line < ud.line ? ud : pp;

    edgeLegs.push({
      id: `dfs-${normKey(softer.player, softer.statType)}`,
      player: softer.player,
      statType: softer.statType,
      league: softer.league || harder.league,
      pick: `${softer.player} Over ${softer.line} ${softer.statType}`,
      site: softer.site,
      line: softer.line,
      otherSite: harder.site,
      otherLine: harder.line,
      gapPct: Math.round(gapPct * 1000) / 10,
    });

    if (gapPct >= 0.08) {
      warnings.push(
        `${softer.player} ${softer.statType}: ${softer.site} posts ${softer.line} while ${harder.site} posts ${harder.line} (${Math.round(gapPct * 100)}% apart) — one site is off market. Take the soft side, never the stale one.`,
      );
    }
  }

  return {
    projections,
    edgeLegs: edgeLegs.slice(0, 10),
    warnings: warnings.slice(0, 8),
    sitesReached,
  };
}
