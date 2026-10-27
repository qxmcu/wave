import { decodeHtml, fetchText, parseIsoDuration } from './http';
import type { ImportedList, ImportedTrack } from './types';

/**
 * Importers for services without a public API (Amazon Music, Deezer, Tidal,
 * SoundCloud…) and for plain text / CSV exports.
 *
 * Shared Amazon Music pages expose their track list as schema.org JSON-LD for
 * search engines; that, or an exported CSV/text list, is what we can read.
 */

export function parseJsonLd(html: string): ImportedList | null {
  let name = '';
  let cover = '';
  const tracks: ImportedTrack[] = [];
  const blocks = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );
  for (const block of blocks) {
    let data: any;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : data['@graph'] || [data];
    for (const node of nodes) {
      const type = String(node['@type'] || '');
      if (!/MusicPlaylist|MusicAlbum|MusicRecording|ItemList/.test(type)) continue;
      name = name || node.name;
      cover = cover || (typeof node.image === 'string' ? node.image : node.image?.url || '');
      const list =
        node.track?.itemListElement ||
        node.track ||
        node.itemListElement ||
        (type === 'MusicRecording' ? [node] : []);
      for (const raw of list) {
        const t = raw.item || raw;
        if (!t?.name) continue;
        const byArtist = t.byArtist || node.byArtist;
        const artists = (Array.isArray(byArtist) ? byArtist : [byArtist])
          .map((a: any) => (typeof a === 'string' ? a : a?.name))
          .filter(Boolean);
        tracks.push({
          title: decodeHtml(t.name),
          artists,
          album: t.inAlbum?.name,
          duration: parseIsoDuration(t.duration),
          isrc: t.isrcCode
        });
      }
    }
  }
  if (!tracks.length) return null;
  return { name: decodeHtml(name || 'Imported playlist'), cover, tracks };
}

export async function importFromWebPage(url: URL): Promise<ImportedList> {
  const html = await fetchText(url.toString());
  const list = parseJsonLd(html);
  if (list) return list;
  const service = url.hostname.includes('amazon') ? 'Amazon Music' : url.hostname;
  throw new Error(
    `${service} did not expose a track list for this link. Export the playlist as CSV/text (e.g. with TuneMyMusic or Soundiiz) and use the text or file import instead.`
  );
}

const SEPARATORS = [' - ', ' – ', ' — ', '\t', ' by '];

/**
 * Parses "Title - Artist" lines (also "Artist - Title" when `artistFirst`),
 * plus CSV exports with a header row containing title/track and artist columns.
 */
export function parseTextList(text: string): ImportedTrack[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const csv = parseCsvWithHeader(lines);
  if (csv) return csv;

  const out: ImportedTrack[] = [];
  for (const line of lines) {
    const clean = line.replace(/^\d+[.)]\s*/, '');
    const sep = SEPARATORS.find((s) => clean.includes(s));
    if (!sep) {
      out.push({ title: clean, artists: [] });
      continue;
    }
    const [left, ...rest] = clean.split(sep);
    const right = rest.join(sep);
    out.push({ title: left.trim(), artists: splitArtists(right) });
  }
  return out;
}

const splitArtists = (value: string) =>
  value
    .split(/\s*(?:,|\/|;| feat\. | ft\. )\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsvWithHeader(lines: string[]): ImportedTrack[] | null {
  const delimiter = lines[0].includes('\t')
    ? '\t'
    : lines[0].includes(';') && !lines[0].includes(',')
      ? ';'
      : ',';
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase());
  const titleIdx = header.findIndex((h) =>
    /^(track name|track|title|song|song name|name)$/.test(h)
  );
  const artistIdx = header.findIndex((h) =>
    /^(artist name\(s\)|artist name|artists?|artist\(s\))$/.test(h)
  );
  if (titleIdx < 0 || artistIdx < 0) return null;
  const albumIdx = header.findIndex((h) => /^(album name|album)$/.test(h));
  const durIdx = header.findIndex((h) => /duration/.test(h));
  const isrcIdx = header.findIndex((h) => h === 'isrc');
  return lines.slice(1).flatMap((line) => {
    const cols = splitCsvLine(line, delimiter);
    const title = cols[titleIdx];
    if (!title) return [];
    const durRaw = durIdx >= 0 ? cols[durIdx] : '';
    const duration = /^\d+$/.test(durRaw)
      ? Number(durRaw)
      : /^\d+:\d{2}$/.test(durRaw)
        ? (Number(durRaw.split(':')[0]) * 60 + Number(durRaw.split(':')[1])) * 1000
        : undefined;
    return [
      {
        title,
        artists: splitArtists(cols[artistIdx] || ''),
        album: albumIdx >= 0 ? cols[albumIdx] : undefined,
        duration,
        isrc: isrcIdx >= 0 ? cols[isrcIdx] : undefined
      }
    ];
  });
}
