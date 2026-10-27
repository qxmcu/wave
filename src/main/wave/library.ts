import crypto from 'crypto';

import { getTrack, rememberTrack } from './ids';
import { jsonFile } from './persist';
import { LIKED_PLAYLIST_KEY } from './shapes';
import type { WavePlaylist, WaveTrack } from './types';

/**
 * The local Wave library: playlists created or imported in the app, liked
 * songs and listening history. Service libraries (YouTube Music, Spotify,
 * Apple Music) are read live and merged with this one in the API layer.
 */

interface LocalPlaylist {
  key: string;
  name: string;
  cover?: string;
  description?: string;
  source?: string;
  createdAt: number;
  updatedAt: number;
  trackKeys: string[];
}

interface LibraryData {
  playlists: LocalPlaylist[];
  liked: string[];
  history: { key: string; at: number; count: number }[];
  savedPlaylists: string[];
  savedAlbums: string[];
  /** Metadata for every track the library references (the id cache is size-capped). */
  tracks: Record<string, WaveTrack>;
}

const lib = () =>
  jsonFile<LibraryData>('library', {
    playlists: [],
    liked: [],
    history: [],
    savedPlaylists: [],
    savedAlbums: [],
    tracks: {}
  });

const trackFromKey = (key: string): WaveTrack | undefined =>
  lib().data.tracks[key] || getTrack(key);

/** Stores a track's metadata in the library and registers its id. */
const keep = (track: WaveTrack) => {
  rememberTrack(track);
  lib().data.tracks[track.key] = { ...lib().data.tracks[track.key], ...track };
};

const toWavePlaylist = (p: LocalPlaylist, withTracks: boolean): WavePlaylist => {
  const tracks = withTracks
    ? (p.trackKeys.map(trackFromKey).filter(Boolean) as WaveTrack[])
    : undefined;
  return {
    key: p.key,
    name: p.name,
    cover: p.cover || (withTracks ? tracks?.[0]?.cover : trackFromKey(p.trackKeys[0] || '')?.cover),
    description: p.description,
    ownerName: 'You',
    owned: true,
    trackCount: p.trackKeys.length,
    tracks,
    service: 'wave'
  };
};

export function listPlaylists(): WavePlaylist[] {
  return lib().data.playlists.map((p) => toWavePlaylist(p, false));
}

export function likedPlaylist(withTracks: boolean): WavePlaylist {
  const data = lib().data;
  const tracks = withTracks
    ? (data.liked.map(trackFromKey).filter(Boolean) as WaveTrack[])
    : undefined;
  return {
    key: LIKED_PLAYLIST_KEY,
    name: 'Liked Songs',
    ownerName: 'You',
    owned: true,
    trackCount: data.liked.length,
    tracks,
    cover: tracks?.[0]?.cover || trackFromKey(data.liked[0] || '')?.cover,
    service: 'wave'
  };
}

export function getPlaylist(key: string): WavePlaylist | undefined {
  if (key === LIKED_PLAYLIST_KEY) return likedPlaylist(true);
  const p = lib().data.playlists.find((x) => x.key === key);
  return p ? toWavePlaylist(p, true) : undefined;
}

export function createPlaylist(
  name: string,
  tracks: WaveTrack[] = [],
  extra: Partial<LocalPlaylist> = {}
) {
  const key = `wave:pl:${crypto.randomUUID()}`;
  tracks.forEach(keep);
  const playlist: LocalPlaylist = {
    key,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    trackKeys: tracks.map((t) => t.key),
    ...extra
  };
  const store = lib();
  store.data.playlists.unshift(playlist);
  store.save();
  return toWavePlaylist(playlist, false);
}

export function deletePlaylist(key: string) {
  const store = lib();
  store.data.playlists = store.data.playlists.filter((p) => p.key !== key);
  store.save();
}

export function addTracks(key: string, tracks: WaveTrack[]) {
  const store = lib();
  tracks.forEach(keep);
  if (key === LIKED_PLAYLIST_KEY) {
    tracks.forEach((t) => setLiked(t, true));
    return true;
  }
  const p = store.data.playlists.find((x) => x.key === key);
  if (!p) return false;
  for (const t of tracks) if (!p.trackKeys.includes(t.key)) p.trackKeys.unshift(t.key);
  p.updatedAt = Date.now();
  store.save();
  return true;
}

export function removeTracks(key: string, trackKeys: string[]) {
  const store = lib();
  if (key === LIKED_PLAYLIST_KEY) {
    store.data.liked = store.data.liked.filter((k) => !trackKeys.includes(k));
    store.save();
    return true;
  }
  const p = store.data.playlists.find((x) => x.key === key);
  if (!p) return false;
  p.trackKeys = p.trackKeys.filter((k) => !trackKeys.includes(k));
  p.updatedAt = Date.now();
  store.save();
  return true;
}

export function setLiked(track: WaveTrack, liked: boolean) {
  const store = lib();
  keep(track);
  store.data.liked = store.data.liked.filter((k) => k !== track.key);
  if (liked) store.data.liked.unshift(track.key);
  store.save();
}

export function likedKeys(): string[] {
  return lib().data.liked;
}

export function recordPlay(track: WaveTrack) {
  const store = lib();
  keep(track);
  const existing = store.data.history.find((h) => h.key === track.key);
  if (existing) {
    existing.at = Date.now();
    existing.count++;
  } else {
    store.data.history.unshift({ key: track.key, at: Date.now(), count: 1 });
  }
  store.data.history.sort((a, b) => b.at - a.at);
  store.data.history = store.data.history.slice(0, 1000);
  store.save();
}

export function history(limit = 100) {
  return lib()
    .data.history.slice(0, limit)
    .map((h) => ({ ...h, track: trackFromKey(h.key) }))
    .filter((h) => h.track) as { key: string; at: number; count: number; track: WaveTrack }[];
}

export function toggleSaved(kind: 'savedPlaylists' | 'savedAlbums', key: string, saved: boolean) {
  const store = lib();
  store.data[kind] = store.data[kind].filter((k) => k !== key);
  if (saved) store.data[kind].unshift(key);
  store.save();
}

export function savedKeys(kind: 'savedPlaylists' | 'savedAlbums') {
  return lib().data[kind];
}
