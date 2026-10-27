import crypto from 'crypto';

import { decodeHtml, fetchJson, fetchText } from './http';
import type { AccountProfile, ImportedList, ImportedTrack, WavePlaylist, WaveTrack } from './types';

/**
 * Spotify provider.
 *
 * Spotify does not allow third-party apps to stream audio outside its own SDK
 * (which needs Premium + Widevine), so Spotify is used for library, playlists
 * and metadata; playback resolves each track to its YouTube Music equivalent.
 *
 * Signed in: Web API with an Authorization Code + PKCE token (no client secret).
 * Signed out: public playlist/album links are read from the embed page.
 */

export const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8898/callback';
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify',
  'user-top-read',
  'user-follow-read'
];

export interface SpotifyTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let tokens: SpotifyTokens | null = null;
let onTokensChanged: (t: SpotifyTokens | null) => void = () => {};

export function setSpotifyTokens(next: SpotifyTokens | null, notify = false) {
  tokens = next;
  if (notify) onTokensChanged(next);
}

export function onSpotifyTokens(listener: (t: SpotifyTokens | null) => void) {
  onTokensChanged = listener;
}

export function isSpotifySignedIn() {
  return Boolean(tokens?.refreshToken);
}

// ─── PKCE ───────────────────────────────────────────────────────────────

const base64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

export function buildAuthorizeUrl(clientId: string, challenge: string, state: string) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES.join(' ')
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  return fetchJson<any>('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
}

export async function exchangeCode(clientId: string, code: string, verifier: string) {
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier
  });
  setSpotifyTokens(
    {
      clientId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000
    },
    true
  );
}

async function accessToken(): Promise<string> {
  if (!tokens) throw new Error('Spotify is not signed in');
  if (tokens.expiresAt > Date.now() + 30_000) return tokens.accessToken;
  const data = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: tokens.clientId
  });
  setSpotifyTokens(
    {
      clientId: tokens.clientId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000
    },
    true
  );
  return tokens!.accessToken;
}

async function api<T = any>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const token = await accessToken();
  const url = path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`;
  return fetchJson<T>(url, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
}

async function paged<T = any>(path: string, max = 2000): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next && out.length < max) {
    const page: any = await api(next);
    out.push(...(page.items || []));
    next = page.next;
  }
  return out;
}

// ─── mapping ────────────────────────────────────────────────────────────

const bestImage = (images?: { url: string; width?: number }[]) =>
  images?.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;

export function spotifyTrackToWave(track: any): WaveTrack | null {
  if (!track?.id || track.type === 'episode') return null;
  const cover = bestImage(track.album?.images);
  return {
    key: `sp:t:${track.id}`,
    title: track.name,
    artists: (track.artists || []).map((a: any) => ({
      name: a.name,
      key: a.id ? `sp:ar:${a.id}` : undefined
    })),
    album: track.album
      ? { key: `sp:al:${track.album.id}`, name: track.album.name, cover }
      : undefined,
    cover,
    duration: track.duration_ms,
    isrc: track.external_ids?.isrc,
    explicit: track.explicit
  };
}

const playlistToWave = (p: any, meId?: string): WavePlaylist => ({
  key: `sp:pl:${p.id}`,
  name: p.name,
  cover: bestImage(p.images),
  description: decodeHtml(p.description || ''),
  ownerName: p.owner?.display_name || 'Spotify',
  owned: Boolean(meId && p.owner?.id === meId),
  trackCount: p.tracks?.total ?? p.items?.total ?? 0,
  service: 'sp'
});

// ─── signed-in API ──────────────────────────────────────────────────────

let me: any = null;

export async function getAccount(): Promise<AccountProfile | null> {
  if (!isSpotifySignedIn()) return null;
  me = await api('/me');
  return {
    service: 'sp',
    name: me.display_name || me.id,
    avatar: bestImage(me.images),
    email: me.email
  };
}

export async function getUserPlaylists(): Promise<WavePlaylist[]> {
  if (!isSpotifySignedIn()) return [];
  if (!me) me = await api('/me');
  const items = await paged('/me/playlists?limit=50', 1000);
  const playlists = items.filter(Boolean).map((p) => playlistToWave(p, me.id));
  const saved = await api('/me/tracks?limit=1');
  playlists.unshift({
    key: 'sp:pl:liked',
    name: 'Spotify Liked Songs',
    ownerName: me.display_name,
    owned: true,
    trackCount: saved.total || 0,
    cover: 'https://misc.scdn.co/liked-songs/liked-songs-640.png',
    service: 'sp'
  });
  return playlists;
}

export async function getPlaylist(id: string): Promise<WavePlaylist> {
  if (!isSpotifySignedIn()) return embedPlaylist('playlist', id);
  if (id === 'liked') {
    const items = await paged('/me/tracks?limit=50', 5000);
    return {
      key: 'sp:pl:liked',
      name: 'Spotify Liked Songs',
      owned: true,
      cover: 'https://misc.scdn.co/liked-songs/liked-songs-640.png',
      tracks: items.map((i) => spotifyTrackToWave(i.track)).filter(Boolean) as WaveTrack[],
      service: 'sp'
    };
  }
  try {
    const p = await api(`/playlists/${id}`);
    // Newer apps use /items, older ones /tracks; accept either.
    const items = await paged(`/playlists/${id}/items?limit=100`, 10000).catch(() =>
      paged(`/playlists/${id}/tracks?limit=100`, 10000)
    );
    const tracks = items
      .map((i) => spotifyTrackToWave(i.track || i.item))
      .filter(Boolean) as WaveTrack[];
    return { ...playlistToWave(p, me?.id), tracks, trackCount: tracks.length };
  } catch (error) {
    // Editorial/algorithmic playlists are not available to third-party apps; the embed still works.
    if ((error as any).status === 404 || (error as any).status === 403)
      return embedPlaylist('playlist', id);
    throw error;
  }
}

export async function getAlbum(id: string) {
  const album = isSpotifySignedIn() ? await api(`/albums/${id}`) : null;
  if (!album) {
    const embed = await embedPlaylist('album', id);
    return {
      key: `sp:al:${id}`,
      name: embed.name,
      cover: embed.cover,
      artists: embed.tracks?.[0]?.artists || [],
      tracks: embed.tracks
    };
  }
  const cover = bestImage(album.images);
  const tracks = (album.tracks?.items || [])
    .map((t: any) => spotifyTrackToWave({ ...t, album }))
    .filter(Boolean) as WaveTrack[];
  return {
    key: `sp:al:${id}`,
    name: album.name,
    cover,
    artists: album.artists.map((a: any) => ({ name: a.name, key: `sp:ar:${a.id}` })),
    year: album.release_date?.slice(0, 4),
    tracks,
    trackCount: tracks.length
  };
}

export async function getTrack(id: string): Promise<WaveTrack | null> {
  if (isSpotifySignedIn()) return spotifyTrackToWave(await api(`/tracks/${id}`));
  const list = await embedPlaylist('track', id);
  return list.tracks?.[0] || null;
}

export async function setSaved(trackId: string, saved: boolean) {
  if (!isSpotifySignedIn()) return;
  await api(`/me/tracks?ids=${trackId}`, { method: saved ? 'PUT' : 'DELETE' });
}

export async function getSavedTrackIds(): Promise<string[]> {
  if (!isSpotifySignedIn()) return [];
  const items = await paged('/me/tracks?limit=50', 5000);
  return items.map((i) => i.track?.id).filter(Boolean);
}

export async function createPlaylist(name: string) {
  if (!me) me = await api('/me');
  const p = await api(`/users/${me.id}/playlists`, {
    method: 'POST',
    body: { name, public: false }
  });
  return p.id as string;
}

export async function addTracks(playlistId: string, trackIds: string[]) {
  const body = { uris: trackIds.map((id) => `spotify:track:${id}`) };
  await api(`/playlists/${playlistId}/items`, { method: 'POST', body }).catch(() =>
    api(`/playlists/${playlistId}/tracks`, { method: 'POST', body })
  );
}

export async function removeTracks(playlistId: string, trackIds: string[]) {
  const uris = trackIds.map((id) => ({ uri: `spotify:track:${id}` }));
  await api(`/playlists/${playlistId}/items`, { method: 'DELETE', body: { items: uris } }).catch(
    () => api(`/playlists/${playlistId}/tracks`, { method: 'DELETE', body: { tracks: uris } })
  );
}

// ─── signed-out embed scraping ──────────────────────────────────────────

/**
 * Reads the public embed page (open.spotify.com/embed/...), which carries the
 * track list in its Next.js data blob. Used for link imports without sign-in.
 */
export async function embedPlaylist(
  kind: 'playlist' | 'album' | 'track',
  id: string
): Promise<WavePlaylist> {
  const html = await fetchText(`https://open.spotify.com/embed/${kind}/${id}`);
  return parseEmbedHtml(html, kind, id);
}

export function parseEmbedHtml(html: string, kind: string, id: string): WavePlaylist {
  const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(
    html
  );
  if (!match) throw new Error('Spotify embed data not found');
  const data = JSON.parse(match[1]);
  const entity = data?.props?.pageProps?.state?.data?.entity || data?.props?.pageProps?.entity;
  if (!entity) throw new Error('Spotify embed entity missing');
  const cover =
    bestImage(entity.coverArt?.sources || entity.visualIdentity?.image) || entity.images?.[0]?.url;
  const list: any[] = entity.trackList || (kind === 'track' ? [entity] : []);
  const tracks: WaveTrack[] = list.map((t: any) => {
    const trackId = (t.uri || '').split(':').pop() || t.id;
    const artists: string[] =
      t.artists?.map((a: any) => a.name) || (t.subtitle || '').split(/,\s*/).filter(Boolean);
    return {
      key: `sp:t:${trackId}`,
      title: t.title || t.name,
      artists: artists.map((name) => ({ name })),
      album:
        kind === 'album'
          ? { key: `sp:al:${id}`, name: entity.name || entity.title, cover }
          : undefined,
      cover: kind === 'album' || kind === 'track' ? cover : undefined,
      duration: t.duration || t.duration_ms
    };
  });
  return {
    key: `sp:${kind === 'album' ? 'al' : 'pl'}:${id}`,
    name: entity.name || entity.title || 'Spotify',
    cover,
    description: entity.subtitle || '',
    ownerName: entity.subtitle || 'Spotify',
    tracks,
    trackCount: tracks.length,
    service: 'sp'
  };
}

export async function importFromUrl(url: URL): Promise<ImportedList> {
  const m = /\/(playlist|album|track)\/([A-Za-z0-9]+)/.exec(url.pathname);
  if (!m) throw new Error('Unsupported Spotify link');
  const [, kind, id] = m;
  const list =
    kind === 'playlist'
      ? await getPlaylist(id)
      : kind === 'album'
        ? await getAlbum(id).then((a) => ({ name: a.name, cover: a.cover, tracks: a.tracks }))
        : await getTrack(id).then((t) => ({
            name: t?.title || 'Spotify',
            cover: t?.cover,
            tracks: t ? [t] : []
          }));
  return {
    name: list.name,
    cover: list.cover,
    tracks: (list.tracks || []).map((t): ImportedTrack => ({
      title: t.title,
      artists: t.artists.map((a) => a.name),
      album: t.album?.name,
      duration: t.duration,
      isrc: t.isrc,
      cover: t.cover
    }))
  };
}
