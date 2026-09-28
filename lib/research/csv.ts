/**
 * Shared loaders for the research data (nflverse, sportsdataverse): a
 * streaming, column-projected CSV reader and a small in-memory cache.
 */

const TTL_MS = 60 * 60 * 1000; // re-pull at most hourly per server instance

const cache = new Map<string, { at: number; data: Promise<unknown> }>();

/** Memoize a load for an hour; a failed load is dropped so the next call retries. */
export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as Promise<T>;
  const data = load().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Large files (late-season NFL play-by-play is ~140 MB, NBA player box ~16 MB)
// are streamed and only the needed columns are kept.
export async function streamCsv(
  url: string,
  columns: string[],
  onRow: (row: Record<string, string>) => void,
): Promise<void> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`${url.split('/download/')[1] ?? url}: HTTP ${res.status}`);
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

