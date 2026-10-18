/**
 * Who is on which team today and who is hurt: ESPN's public team rosters and
 * league injury report, joined to nflverse (GSIS) player ids through the
 * nflverse players table's ESPN ids. Box scores alone miss trades made this
 * week and players ruled out.
 */
import { cached } from './csv';
import { parseCsv } from './nflverse';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
/** ESPN abbreviations that differ from nflverse's. */
const ESPN_TO_NFLVERSE: Record<string, string> = { WSH: 'WAS', LAR: 'LA' };
const team = (abbr: string) => ESPN_TO_NFLVERSE[abbr] ?? abbr;

export type InjuryStatus = 'Out' | 'Doubtful' | 'Questionable' | 'Injured Reserve' | 'Suspended' | 'Active' | string;
export type PlayerStatus = { team: string | null; injury: { status: InjuryStatus; note: string; date: string } | null };

/** ESPN id → GSIS id. */
function espnToGsis(): Promise<Map<string, string>> {
  return cached('nfl-espn-xwalk', async () => {
    const res = await fetch('https://github.com/nflverse/nflverse-data/releases/download/players/players.csv', { cache: 'no-store' });
    if (!res.ok) throw new Error(`nflverse players: HTTP ${res.status}`);
    const out = new Map<string, string>();
    for (const r of parseCsv(await res.text())) if (r.espn_id && r.espn_id !== 'NA' && r.gsis_id && r.gsis_id !== 'NA') out.set(r.espn_id, r.gsis_id);
    return out;
  });
}

const idFromLink = (href: string | undefined) => href?.match(/\/id\/(\d+)/)?.[1] ?? null;

/** Current team and injury designation for every player ESPN lists, keyed by GSIS id. */
export function nflPlayerStatus(): Promise<Map<string, PlayerStatus>> {
  return cached('nfl-status', async () => {
    const xwalk = await espnToGsis();
    const out = new Map<string, PlayerStatus>();

    type TeamsJson = { sports: Array<{ leagues: Array<{ teams: Array<{ team: { id: string; abbreviation: string } }> }> }> };
    const teams = ((await fetch(`${ESPN}/teams`, { cache: 'no-store' }).then((r) => r.json())) as TeamsJson).sports[0].leagues[0].teams.map((t) => t.team);
    type RosterJson = { athletes?: Array<{ items?: Array<{ id: string }> }> };
    const rosters = await Promise.all(
      teams.map(async (t) => ({ abbr: team(t.abbreviation), json: (await fetch(`${ESPN}/teams/${t.id}/roster`, { cache: 'no-store' }).then((r) => r.json())) as RosterJson })),
    );
    for (const { abbr, json } of rosters) {
      for (const group of json.athletes ?? []) {
        for (const a of group.items ?? []) {
          const gsis = xwalk.get(a.id);
          if (gsis) out.set(gsis, { team: abbr, injury: null });
        }
      }
    }

    type InjuryJson = {
      injuries: Array<{
        displayName: string;
        injuries: Array<{ status: string; shortComment?: string; date?: string; athlete: { links?: Array<{ href: string }>; team?: { abbreviation?: string } } }>;
      }>;
    };
    const inj = (await fetch(`${ESPN}/injuries`, { cache: 'no-store' }).then((r) => r.json())) as InjuryJson;
    for (const t of inj.injuries ?? []) {
      for (const i of t.injuries ?? []) {
        const espnId = idFromLink(i.athlete.links?.[0]?.href);
        const gsis = espnId ? xwalk.get(espnId) : undefined;
        if (!gsis) continue;
        const cur = out.get(gsis) ?? { team: i.athlete.team?.abbreviation ? team(i.athlete.team.abbreviation) : null, injury: null };
        cur.injury = { status: i.status, note: i.shortComment ?? '', date: (i.date ?? '').slice(0, 10) };
        out.set(gsis, cur);
      }
    }
    return out;
  });
}

/** Statuses that mean he won't play. */
export const isOut = (s: InjuryStatus | undefined) => s === 'Out' || s === 'Injured Reserve' || s === 'Suspended' || s === 'Doubtful';
