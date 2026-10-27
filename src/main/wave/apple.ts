import { decodeHtml, fetchText, parseIsoDuration } from './http';
import type { ImportedList, ImportedTrack } from './types';

/**
 * Apple Music link import. Public playlist and album pages are server-rendered
 * with their track list embedded, so no Apple account or API key is needed.
 */

/** Walks arbitrary JSON collecting objects that look like songs. */
function collectSongs(node: any, out: ImportedTrack[], seen: Set<string>) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectSongs(n, out, seen));
    return;
  }
  const title = node.title || node.name;
  const artist = node.artistName || node.subtitleLinks?.[0]?.title || node.artist?.name;
  const duration = node.duration ?? node.durationInMillis;
  const looksLikeSong =
    typeof title === 'string' &&
    typeof artist === 'string' &&
    (typeof duration === 'number' ||
      node.contentDescriptor?.kind === 'song' ||
      node.type === 'songs');
  if (looksLikeSong) {
    const key = `${title}::${artist}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        title,
        artists: [artist],
        album: node.albumName || node.tertiaryLinks?.[0]?.title,
        duration: typeof duration === 'number' ? duration : undefined,
        isrc: node.isrc
      });
    }
    return;
  }
  for (const value of Object.values(node)) collectSongs(value, out, seen);
}

export function parseApplePage(html: string): ImportedList {
  const tracks: ImportedTrack[] = [];
  const seen = new Set<string>();

  const serialized = /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (serialized) {
    try {
      collectSongs(JSON.parse(serialized[1]), tracks, seen);
    } catch (error) {
      console.warn('[wave:apple] serialized data parse failed:', error);
    }
  }

  let name = '';
  let cover = '';
  const ldBlocks = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );
  for (const block of ldBlocks) {
    try {
      const ld = JSON.parse(block[1]);
      name = name || ld.name;
      cover = cover || (typeof ld.image === 'string' ? ld.image : ld.image?.url);
      if (!tracks.length) {
        const list = ld.track?.itemListElement || ld.track || ld.tracks || [];
        for (const raw of list) {
          const t = raw.item || raw;
          if (!t?.name) continue;
          const artists = [t.byArtist?.name || t.byArtist?.[0]?.name || ld.byArtist?.name].filter(
            Boolean
          );
          tracks.push({
            title: t.name,
            artists,
            duration: parseIsoDuration(t.duration),
            album: t.inAlbum?.name
          });
        }
      }
    } catch {
      /* ignore malformed block */
    }
  }
  if (!name) {
    const og = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/.exec(html);
    name = og ? decodeHtml(og[1]).replace(/ (on|by) Apple Music$/i, '') : 'Apple Music';
  }
  if (!cover) {
    const og = /<meta[^>]+property="og:image"[^>]+content="([^"]*)"/.exec(html);
    cover = og ? og[1] : '';
  }
  return { name: decodeHtml(name), cover, tracks };
}

export async function importFromUrl(url: URL): Promise<ImportedList> {
  const html = await fetchText(url.toString());
  const list = parseApplePage(html);
  if (!list.tracks.length) throw new Error('No tracks found on the Apple Music page');
  return list;
}
