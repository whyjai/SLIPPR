/**
 * Play-level NFL research: team tendencies and how players perform against
 * specific defensive looks. Sources (all free, nflverse):
 *  - play-by-play: down, distance, field position, shotgun/no-huddle, pass
 *    rate over expected, who was targeted / carried, yards, EPA
 *  - FTN charting: defenders in the box, blitzers, pass rushers,
 *    play-action, motion, screens, RPOs
 *  - participation (published after a season, not live): man vs. zone
 *    coverage and coverage shell
 *
 * Everything is kept as additive counts so a stored past season and the
 * live current season can simply be summed for "since last season" splits.
 */

const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';

// ---------------------------------------------------------------------------
// Streaming, column-projected CSV: late-season play-by-play is ~140 MB of
// CSV with ~370 columns; we need ~30 of them and never hold the whole file.
// ---------------------------------------------------------------------------

export async function streamCsv(
  url: string,
  columns: string[],
  onRow: (row: Record<string, string>) => void,
): Promise<void> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`nflverse ${url.split('/download/')[1]}: HTTP ${res.status}`);
  let body: ReadableStream<Uint8Array> = res.body;
  if (url.endsWith('.gz')) body = body.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();

  let header: string[] | null = null;
  const headerRow: string[] = [];
  let slot: number[] = []; // column index -> position in `columns`, or -1
  let values: string[] = new Array(columns.length).fill('');
  let col = 0;
  let field = '';
  let quoted = false;
  let pendingQuote = false; // saw a quote inside a quoted field; next char decides

  const endField = () => {
    if (!header) headerRow.push(field);
    else {
      const s = slot[col];
      if (s !== undefined && s >= 0) values[s] = field;
    }
    col++;
    field = '';
  };
  const endRow = () => {
    endField();
    if (!header) {
      header = headerRow;
      slot = header.map((h) => columns.indexOf(h));
    } else if (col > 1) {
      const row: Record<string, string> = {};
      columns.forEach((c, i) => (row[c] = values[i]));
      onRow(row);
    }
    values = new Array(columns.length).fill('');
    col = 0;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      const keep = !header || (slot[col] ?? -1) >= 0;
      if (quoted) {
        if (pendingQuote) {
          pendingQuote = false;
          if (c === '"') {
            if (keep) field += '"';
            continue;
          }
          quoted = false; // the quote closed the field; fall through to handle c unquoted
        } else if (c === '"') {
          pendingQuote = true;
          continue;
        } else {
          if (keep) field += c;
          continue;
        }
      }
      if (c === '"') quoted = true;
      else if (c === ',') endField();
      else if (c === '\n') endRow();
      else if (c !== '\r' && keep) field += c;
    }
  }
  if (field !== '' || col > 0) endRow();
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type Play = {
  gameId: string;
  playId: string;
  week: number;
  offense: string;
  defense: string;
  type: 'pass' | 'run';
  down: number;
  ydstogo: number;
  yardline: number; // yards from opponent end zone
  halfSecondsLeft: number;
  gameSecondsLeft: number;
  drive: string;
  wp: number;
  shotgun: boolean;
  noHuddle: boolean;
  dropback: boolean;
  scramble: boolean;
  sack: boolean;
  passOe: number | null; // percentage points (nflverse scales pass_oe 0–100)
  receiverId: string;
  receiver: string;
  rusherId: string;
  rusher: string;
  passerId: string;
  passer: string;
  yards: number;
  complete: boolean;
  attempt: boolean; // a real pass attempt (not a sack or scramble)
  epa: number;
};

const PBP_COLS = [
  'game_id', 'play_id', 'season_type', 'week', 'posteam', 'defteam', 'play_type', 'down', 'ydstogo', 'yardline_100',
  'half_seconds_remaining', 'game_seconds_remaining', 'drive', 'wp', 'shotgun', 'no_huddle', 'qb_dropback', 'qb_scramble',
  'sack', 'pass_oe', 'receiver_player_id', 'receiver_player_name', 'rusher_player_id', 'rusher_player_name',
  'passer_player_id', 'passer_player_name', 'yards_gained', 'complete_pass', 'pass_attempt', 'epa', 'two_point_attempt',
  'qb_kneel', 'qb_spike',
];

const num = (s: string) => (s === '' || s === 'NA' ? 0 : Number(s) || 0);

export async function loadPlays(season: number): Promise<Play[]> {
  const plays: Play[] = [];
  await streamCsv(`${RELEASES}/pbp/play_by_play_${season}.csv.gz`, PBP_COLS, (r) => {
    if (r.season_type !== 'REG' || (r.play_type !== 'pass' && r.play_type !== 'run')) return;
    if (r.two_point_attempt === '1' || r.qb_kneel === '1' || r.qb_spike === '1' || !r.posteam) return;
    const scramble = r.qb_scramble === '1';
    const sack = r.sack === '1';
    plays.push({
      gameId: r.game_id,
      playId: r.play_id,
      week: num(r.week),
      offense: r.posteam,
      defense: r.defteam,
      type: r.play_type as 'pass' | 'run',
      down: num(r.down),
      ydstogo: num(r.ydstogo),
      yardline: num(r.yardline_100),
      halfSecondsLeft: num(r.half_seconds_remaining),
      gameSecondsLeft: num(r.game_seconds_remaining),
      drive: r.drive,
      wp: num(r.wp),
      shotgun: r.shotgun === '1',
      noHuddle: r.no_huddle === '1',
      dropback: r.qb_dropback === '1',
      scramble,
      sack,
      passOe: r.pass_oe === '' || r.pass_oe === 'NA' ? null : Number(r.pass_oe),
      receiverId: r.receiver_player_id === 'NA' ? '' : r.receiver_player_id,
      receiver: r.receiver_player_name === 'NA' ? '' : r.receiver_player_name,
      rusherId: r.rusher_player_id === 'NA' ? '' : r.rusher_player_id,
      rusher: r.rusher_player_name === 'NA' ? '' : r.rusher_player_name,
      passerId: r.passer_player_id === 'NA' ? '' : r.passer_player_id,
      passer: r.passer_player_name === 'NA' ? '' : r.passer_player_name,
      yards: num(r.yards_gained),
      complete: r.complete_pass === '1',
      attempt: r.pass_attempt === '1' && !sack && !scramble,
      epa: num(r.epa),
    });
  });
  return plays;
}

export type Charting = {
  box: number | null; // defenders in the box
  blitzers: number;
  rushers: number | null;
  playAction: boolean;
  motion: boolean;
  screen: boolean;
  rpo: boolean;
};

export async function loadCharting(season: number): Promise<Map<string, Charting>> {
  const out = new Map<string, Charting>();
  await streamCsv(
    `${RELEASES}/ftn_charting/ftn_charting_${season}.csv`,
    ['nflverse_game_id', 'nflverse_play_id', 'n_defense_box', 'n_blitzers', 'n_pass_rushers', 'is_play_action', 'is_motion', 'is_screen_pass', 'is_rpo'],
    (r) => {
      const box = num(r.n_defense_box);
      const rushers = num(r.n_pass_rushers);
      out.set(`${r.nflverse_game_id}|${r.nflverse_play_id}`, {
        box: box > 0 ? box : null, // 0 = not charted
        blitzers: num(r.n_blitzers),
        rushers: rushers > 0 ? rushers : null,
        playAction: r.is_play_action === 'TRUE',
        motion: r.is_motion === 'TRUE',
        screen: r.is_screen_pass === 'TRUE',
        rpo: r.is_rpo === 'TRUE',
      });
    },
  );
  return out;
}

/** Man vs. zone per play. Only exists once a season's participation file is published. */
export async function loadCoverage(season: number): Promise<Map<string, 'man' | 'zone'>> {
  const out = new Map<string, 'man' | 'zone'>();
  await streamCsv(
    `${RELEASES}/pbp_participation/pbp_participation_${season}.csv`,
    ['nflverse_game_id', 'play_id', 'defense_man_zone_type'],
    (r) => {
      const t = r.defense_man_zone_type;
      if (t === 'MAN_COVERAGE' || t === 'ZONE_COVERAGE') out.set(`${r.nflverse_game_id}|${r.play_id}`, t === 'MAN_COVERAGE' ? 'man' : 'zone');
    },
  );
  return out;
}

// ---------------------------------------------------------------------------
// Aggregation (additive counts)
// ---------------------------------------------------------------------------

type Counter = Record<string, number>;

export type TeamCounts = {
  games: string[];
  offense: Counter;
  defense: Counter;
};

/** Split buckets: how the defense lined up against the play. */
export type Look = 'blitz' | 'noBlitz' | 'playAction' | 'noPlayAction' | 'man' | 'zone' | 'lightBox' | 'normalBox' | 'stackedBox';

export type SplitCounts = Record<Look, Counter>;

export type PlayerSplitCounts = {
  id: string;
  name: string;
  splits: Partial<SplitCounts>;
};

export type SeasonAggregate = {
  season: number;
  throughWeek: number;
  hasCharting: boolean;
  hasCoverage: boolean;
  teams: Record<string, TeamCounts>;
  players: Record<string, PlayerSplitCounts>;
};

const bump = (c: Counter, k: string, v = 1) => (c[k] = (c[k] ?? 0) + v);

function neutral(p: Play): boolean {
  return p.wp >= 0.2 && p.wp <= 0.8 && p.halfSecondsLeft > 120;
}

export function aggregate(
  season: number,
  plays: Play[],
  charting: Map<string, Charting>,
  coverage: Map<string, 'man' | 'zone'>,
): SeasonAggregate {
  const teams: Record<string, TeamCounts> = {};
  const players: Record<string, PlayerSplitCounts> = {};
  const team = (t: string) => (teams[t] ??= { games: [], offense: {}, defense: {} });
  const player = (id: string, name: string) => (players[id] ??= { id, name, splits: {} });
  const split = (id: string, name: string, look: Look) => (player(id, name).splits[look] ??= {});
  const games = new Map<string, Set<string>>();

  const sorted = [...plays].sort((a, b) => a.gameId.localeCompare(b.gameId) || Number(a.playId) - Number(b.playId));
  let prev: Play | null = null;

  for (const p of sorted) {
    const key = `${p.gameId}|${p.playId}`;
    const ch = charting.get(key);
    const cov = coverage.get(key);
    const o = team(p.offense).offense;
    const d = team(p.defense).defense;
    for (const t of [p.offense, p.defense]) {
      if (!games.has(t)) games.set(t, new Set());
      games.get(t)!.add(p.gameId);
    }
    const pass = p.type === 'pass';

    // --- offense tendencies
    bump(o, 'plays');
    bump(o, pass ? 'passPlays' : 'runPlays');
    if (p.shotgun) bump(o, 'shotgun');
    if (p.noHuddle) bump(o, 'noHuddle');
    if (p.passOe != null) {
      bump(o, 'passOeSum', p.passOe);
      bump(o, 'passOeN');
    }
    if (neutral(p) && (p.down === 1 || p.down === 2)) {
      bump(o, 'neutralPlays');
      if (pass) bump(o, 'neutralPass');
    }
    if (p.yardline <= 20) {
      bump(o, 'rzPlays');
      if (pass) bump(o, 'rzPass');
    }
    // Pace: seconds between consecutive snaps on the same drive, neutral game state only.
    if (prev && prev.gameId === p.gameId && prev.drive === p.drive && prev.offense === p.offense && neutral(prev)) {
      const gap = prev.gameSecondsLeft - p.gameSecondsLeft;
      if (gap >= 5 && gap <= 60) {
        bump(o, 'paceSum', gap);
        bump(o, 'paceN');
      }
    }
    prev = p;

    // --- defense results
    bump(d, 'plays');
    bump(d, 'yards', p.yards);
    bump(d, pass ? 'passEpa' : 'rushEpa', p.epa);
    bump(d, pass ? 'passPlays' : 'runPlays');

    // --- charting (both sides)
    if (ch) {
      bump(o, 'charted');
      bump(d, 'charted');
      if (ch.motion) bump(o, 'motion');
      if (p.dropback) {
        bump(o, 'chartedDropbacks');
        bump(d, 'chartedDropbacks');
        if (ch.playAction) bump(o, 'playAction');
        if (ch.screen) bump(o, 'screens');
        if (ch.blitzers > 0) bump(d, 'blitzes');
        if (ch.rushers != null) {
          bump(d, 'rushersSum', ch.rushers);
          bump(d, 'rushersN');
        }
      }
      if (ch.rpo) bump(o, 'rpo');
      if (!pass && ch.box != null) {
        bump(d, 'boxRuns');
        if (ch.box >= 8) bump(d, 'stackedBox');
        if (ch.box <= 6) bump(d, 'lightBox');
      }
    }
    if (cov && p.dropback) {
      bump(d, 'coverageSnaps');
      if (cov === 'man') bump(d, 'man');
    }

    // --- player splits
    const looks: Look[] = [];
    if (ch && p.dropback) looks.push(ch.blitzers > 0 ? 'blitz' : 'noBlitz', ch.playAction ? 'playAction' : 'noPlayAction');
    if (cov && p.dropback) looks.push(cov);
    if (p.dropback && p.passerId) {
      for (const look of looks) {
        const s = split(p.passerId, p.passer, look);
        bump(s, 'dropbacks');
        bump(s, 'dbYards', p.sack ? p.yards : p.attempt ? (p.complete ? p.yards : 0) : p.yards);
        bump(s, 'epa', p.epa);
        if (p.attempt) {
          bump(s, 'att');
          if (p.complete) {
            bump(s, 'comp');
            bump(s, 'passYds', p.yards);
          }
        }
        if (p.sack) bump(s, 'sacks');
      }
    }
    if (p.attempt && p.receiverId) {
      for (const look of looks) {
        const s = split(p.receiverId, p.receiver, look);
        bump(s, 'targets');
        if (p.complete) {
          bump(s, 'rec');
          bump(s, 'recYds', p.yards);
        }
      }
    }
    if (!pass && p.rusherId && !p.scramble && ch?.box != null) {
      const look: Look = ch.box >= 8 ? 'stackedBox' : ch.box <= 6 ? 'lightBox' : 'normalBox';
      const s = split(p.rusherId, p.rusher, look);
      bump(s, 'carries');
      bump(s, 'rushYds', p.yards);
    }
  }
  for (const [t, g] of games) team(t).games = [...g];

  return {
    season,
    throughWeek: plays.reduce((m, p) => Math.max(m, p.week), 0),
    hasCharting: charting.size > 0,
    hasCoverage: coverage.size > 0,
    teams,
    players,
  };
}

/** Sum player split counts across seasons (e.g. stored last season + live current season). */
export function mergeSplits(...aggs: SeasonAggregate[]): Record<string, PlayerSplitCounts> {
  const out: Record<string, PlayerSplitCounts> = {};
  for (const a of aggs) {
    for (const p of Object.values(a.players)) {
      const target = (out[p.id] ??= { id: p.id, name: p.name, splits: {} });
      target.name = p.name;
      for (const [look, counts] of Object.entries(p.splits) as Array<[Look, Counter]>) {
        const t = (target.splits[look] ??= {});
        for (const [k, v] of Object.entries(counts)) t[k] = (t[k] ?? 0) + v;
      }
    }
  }
  return out;
}
