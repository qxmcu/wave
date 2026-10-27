import { fetchJson } from './http';
import type { WaveTrack } from './types';
import { getLyricsText } from './youtube';

/**
 * Lyrics: time-synced LRC from LRCLIB (open lyrics database) when available,
 * otherwise the plain lyrics YouTube Music shows, without timestamps.
 */

interface LrcLibEntry {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  duration?: number;
}

export async function getLyrics(track: WaveTrack, videoId?: string | null): Promise<string> {
  const artist = track.artists[0]?.name || '';
  try {
    const params = new URLSearchParams({ track_name: track.title, artist_name: artist });
    if (track.album?.name) params.set('album_name', track.album.name);
    if (track.duration) params.set('duration', String(Math.round(track.duration / 1000)));
    const entry = await fetchJson<LrcLibEntry>(`https://lrclib.net/api/get?${params}`, {
      headers: { 'Lrclib-Client': 'Wave Music Player' },
      timeout: 8000
    }).catch(async () => {
      const results = await fetchJson<LrcLibEntry[]>(
        `https://lrclib.net/api/search?${new URLSearchParams({ track_name: track.title, artist_name: artist })}`,
        { timeout: 8000 }
      );
      return results.find((r) => r.syncedLyrics) || results[0];
    });
    if (entry?.syncedLyrics) return entry.syncedLyrics;
    if (entry?.plainLyrics) return toUntimedLrc(entry.plainLyrics);
  } catch (error) {
    console.warn('[wave:lyrics] lrclib failed:', (error as Error).message);
  }

  if (videoId) {
    try {
      const plain = await getLyricsText(videoId);
      if (plain) return toUntimedLrc(plain);
    } catch (error) {
      console.warn('[wave:lyrics] youtube lyrics failed:', (error as Error).message);
    }
  }
  return '';
}

/** Plain lyrics as LRC lines spaced 4s apart, so the lyric view still renders them. */
export function toUntimedLrc(plain: string): string {
  return plain
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, i) => {
      const t = i * 4;
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = String(t % 60).padStart(2, '0');
      return `[${mm}:${ss}.00]${line}`;
    })
    .join('\n');
}
