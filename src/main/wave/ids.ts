import { jsonFile } from './persist';
import type { WaveTrack } from './types';

/**
 * The UI treats every id as a positive safe integer (NetEase heritage), so each
 * service key (`yt:v:dQw4w9WgXcQ`, `sp:pl:37i9...`) gets a deterministic 52-bit
 * number. The reverse map and the last-seen track metadata are persisted so ids
 * stay resolvable across restarts.
 */

const MAX_TRACK_CACHE = 60000;

interface IdStore {
  keys: Record<string, string>;
  tracks: Record<string, WaveTrack>;
  order: string[];
}

let store: ReturnType<typeof jsonFile<IdStore>> | null = null;
const getStore = () => {
  if (!store) store = jsonFile<IdStore>('ids', { keys: {}, tracks: {}, order: [] });
  return store;
};

/** FNV-1a 64-bit folded into 52 bits; never 0. */
export function hashKey(key: string): number {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  // 20 bits from h2 + 32 bits from h1 = 52 bits
  const high = h2 & 0xfffff;
  const id = high * 0x100000000 + h1;
  return id === 0 ? 1 : id;
}

export function toId(key: string): number {
  const id = hashKey(key);
  const s = getStore();
  if (s.data.keys[id] !== key) {
    s.data.keys[id] = key;
    s.save();
  }
  return id;
}

export function fromId(id: number | string): string | undefined {
  const s = getStore();
  const str = String(id).trim();
  // Accept raw keys too (useful for deep links and tests)
  if (str.includes(':')) return str;
  return s.data.keys[str];
}

export function rememberTrack(track: WaveTrack): number {
  const id = toId(track.key);
  const s = getStore();
  const prev = s.data.tracks[id];
  if (!prev) {
    s.data.order.push(String(id));
    if (s.data.order.length > MAX_TRACK_CACHE) {
      const drop = s.data.order.splice(0, s.data.order.length - MAX_TRACK_CACHE);
      drop.forEach((old) => delete s.data.tracks[old]);
    }
  }
  // Keep the richest version (imports may know the ISRC, YouTube knows the video id)
  s.data.tracks[id] = { ...prev, ...track, videoId: track.videoId || prev?.videoId };
  s.save();
  return id;
}

export function getTrack(id: number | string): WaveTrack | undefined {
  const s = getStore();
  const key = fromId(id);
  if (!key) return undefined;
  return s.data.tracks[hashKey(key)];
}

export function setTrackVideo(key: string, videoId: string) {
  const s = getStore();
  const id = hashKey(key);
  const track = s.data.tracks[id];
  if (track && track.videoId !== videoId) {
    track.videoId = videoId;
    s.save();
  }
}

export function parseKey(key: string): { service: string; kind: string; value: string } {
  const [service, kind, ...rest] = key.split(':');
  return { service, kind, value: rest.join(':') };
}
