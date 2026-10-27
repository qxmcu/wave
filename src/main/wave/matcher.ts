import { setTrackVideo } from './ids';
import { jsonFile } from './persist';
import type { ImportedTrack, WaveTrack } from './types';
import { searchYouTube } from './youtube';

/**
 * Finds the YouTube Music recording that corresponds to a track from another
 * service (Spotify, Apple Music, Amazon, text imports). Scoring prefers the
 * official audio ("song" results) with matching title, artist and duration.
 */

const cache = () =>
  jsonFile<{ matches: Record<string, string | null> }>('matches', { matches: {} });

export const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(
      /\s*[([].*?(remaster(ed)?|version|edit|mono|stereo|deluxe|bonus|explicit|clean).*?[)\]]/gi,
      ''
    )
    .replace(/\s+-\s+.*(remaster(ed)?|version|edit|mono|stereo).*$/i, '')
    .replace(/\b(feat|ft|featuring)\.?\b.*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const tokens = (value: string) => new Set(normalize(value).split(' ').filter(Boolean));

const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((t) => b.has(t) && shared++);
  return shared / Math.max(a.size, b.size);
};

export function scoreCandidate(wanted: ImportedTrack, candidate: WaveTrack): number {
  let score = 0;
  const wantedTitle = normalize(wanted.title);
  const candTitle = normalize(candidate.title);
  if (wantedTitle && wantedTitle === candTitle) score += 50;
  else score += 40 * overlap(tokens(wanted.title), tokens(candidate.title));

  const wantedArtists = tokens(wanted.artists.join(' '));
  const candArtists = tokens(candidate.artists.map((a) => a.name).join(' '));
  if (wantedArtists.size) score += 30 * overlap(wantedArtists, candArtists);
  else score += 10;

  if (wanted.duration && candidate.duration) {
    const diff = Math.abs(wanted.duration - candidate.duration) / 1000;
    if (diff <= 2) score += 20;
    else if (diff <= 5) score += 14;
    else if (diff <= 15) score += 6;
    else if (diff > 60) score -= 20;
  }
  // Penalise obvious non-originals unless they were asked for
  const flags = /\b(live|cover|karaoke|instrumental|remix|sped up|slowed|nightcore|8d)\b/i;
  if (flags.test(candidate.title) && !flags.test(wanted.title)) score -= 25;
  if (candidate.isVideo) score -= 5;
  return score;
}

export function pickBest(wanted: ImportedTrack, candidates: WaveTrack[]): WaveTrack | null {
  let best: WaveTrack | null = null;
  let bestScore = 45;
  for (const candidate of candidates) {
    const s = scoreCandidate(wanted, candidate);
    if (s > bestScore) {
      best = candidate;
      bestScore = s;
    }
  }
  return best;
}

const matchKey = (t: ImportedTrack) =>
  t.isrc
    ? `isrc:${t.isrc}`
    : `${normalize(t.title)}|${normalize(t.artists.join(' '))}|${Math.round((t.duration || 0) / 5000)}`;

const inflight = new Map<string, Promise<string | null>>();

/** Returns the YouTube video id for a track, or null when nothing plausible exists. */
export async function matchToYouTube(track: ImportedTrack): Promise<string | null> {
  const key = matchKey(track);
  const store = cache();
  if (key in store.data.matches) return store.data.matches[key];
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const query = `${track.title} ${track.artists.slice(0, 2).join(' ')}`.trim();
    let candidates = (await searchYouTube(query, 'song', 10)) as WaveTrack[];
    let best = pickBest(track, candidates);
    if (!best) {
      candidates = (await searchYouTube(query, 'video', 10).then((videos: any[]) =>
        videos.map((v) => ({
          key: `yt:v:${v.videoId}`,
          videoId: v.videoId,
          title: v.title,
          artists: [{ name: v.artistName }],
          duration: v.duration,
          isVideo: true
        }))
      )) as WaveTrack[];
      best = pickBest(track, candidates);
    }
    const videoId = best?.videoId || null;
    store.data.matches[key] = videoId;
    store.save();
    return videoId;
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

/** Resolves the playable video for any Wave track (YouTube ones are already playable). */
export async function resolveVideoId(track: WaveTrack): Promise<string | null> {
  if (track.videoId) return track.videoId;
  if (track.key.startsWith('yt:v:')) return track.key.slice(5);
  const videoId = await matchToYouTube({
    title: track.title,
    artists: track.artists.map((a) => a.name),
    album: track.album?.name,
    duration: track.duration,
    isrc: track.isrc
  });
  if (videoId) setTrackVideo(track.key, videoId);
  return videoId;
}
