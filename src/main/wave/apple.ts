import crypto from 'crypto';

import { decodeHtml, fetchJson, fetchText, parseIsoDuration } from './http';
import type { AccountProfile, ImportedList, ImportedTrack, WavePlaylist, WaveTrack } from './types';

/**
 * Apple Music provider.
 *
 * - Public playlist/album links are imported by reading the server-rendered
 *   page data (no account needed).
 * - "Sign in with Apple ID" uses MusicKit JS, which needs a MusicKit developer
 *   token. Users can paste a token or provide Team ID + Key ID + .p8 key, from
 *   which a token is signed locally. Once authorised, the Music User Token gives
 *   access to the user's library playlists, which are synced like other services.
 */

export interface AppleCredentials {
  developerToken?: string;
  teamId?: string;
  keyId?: string;
  privateKey?: string;
  musicUserToken?: string;
  storefront?: string;
}

let creds: AppleCredentials = {};
let onChange: (c: AppleCredentials) => void = () => {};

export function setAppleCredentials(next: AppleCredentials, notify = false) {
  creds = { ...next };
  if (notify) onChange(creds);
}

export function getAppleCredentials() {
  return creds;
}

export function onAppleCredentials(listener: (c: AppleCredentials) => void) {
  onChange = listener;
}

export function isAppleSignedIn() {
  return Boolean(creds.musicUserToken && developerToken());
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let generated: { token: string; exp: number } | null = null;

/** Returns a usable MusicKit developer token (pasted or signed from a .p8 key). */
export function developerToken(): string | undefined {
  if (creds.developerToken) return creds.developerToken.trim();
  if (!creds.teamId || !creds.keyId || !creds.privateKey) return undefined;
  const now = Math.floor(Date.now() / 1000);
  if (generated && generated.exp - 3600 > now) return generated.token;
  const exp = now + 60 * 60 * 24 * 150;
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: creds.keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: creds.teamId, iat: now, exp }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: creds.privateKey,
    dsaEncoding: 'ieee-p1363'
  });
  generated = { token: `${header}.${payload}.${b64url(signature)}`, exp };
  return generated.token;
}

async function api<T = any>(path: string): Promise<T> {
  const token = developerToken();
  if (!token) throw new Error('Apple Music developer token is not configured');
  return fetchJson<T>(`https://api.music.apple.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(creds.musicUserToken ? { 'Music-User-Token': creds.musicUserToken } : {}),
      Origin: 'https://music.apple.com'
    }
  });
}

const artwork = (art?: { url?: string }) =>
  art?.url ? art.url.replace('{w}', '600').replace('{h}', '600') : undefined;

const songToWave = (song: any): WaveTrack | null => {
  const a = song?.attributes;
  if (!a?.name) return null;
  return {
    key: `am:t:${song.id}`,
    title: a.name,
    artists: [{ name: a.artistName || '' }],
    album: a.albumName ? { name: a.albumName, cover: artwork(a.artwork) } : undefined,
    cover: artwork(a.artwork),
    duration: a.durationInMillis,
    isrc: a.isrc
  };
};

export async function getAccount(): Promise<AccountProfile | null> {
  if (!isAppleSignedIn()) return null;
  try {
    const sf = await api('/v1/me/storefront');
    creds.storefront = sf?.data?.[0]?.id || creds.storefront;
  } catch (error) {
    console.warn('[wave:apple] storefront lookup failed:', (error as Error).message);
  }
  return { service: 'am', name: 'Apple Music' };
}

export async function getLibraryPlaylists(): Promise<WavePlaylist[]> {
  if (!isAppleSignedIn()) return [];
  const out: WavePlaylist[] = [];
  let next: string | undefined = '/v1/me/library/playlists?limit=100';
  while (next && out.length < 1000) {
    const page: any = await api(next);
    for (const p of page.data || []) {
      out.push({
        key: `am:pl:${p.id}`,
        name: p.attributes?.name || 'Playlist',
        cover: artwork(p.attributes?.artwork),
        description: p.attributes?.description?.standard || '',
        ownerName: 'Apple Music',
        owned: Boolean(p.attributes?.canEdit),
        service: 'am'
      });
    }
    next = page.next;
  }
  return out;
}

export async function getLibraryPlaylist(id: string): Promise<WavePlaylist> {
  const meta: any = await api(`/v1/me/library/playlists/${id}`);
  const p = meta.data?.[0];
  const tracks: WaveTrack[] = [];
  let next: string | undefined = `/v1/me/library/playlists/${id}/tracks?limit=100&include=catalog`;
  while (next && tracks.length < 5000) {
    const page: any = await api(next).catch(() => ({ data: [] }));
    for (const s of page.data || []) {
      const catalog = s.relationships?.catalog?.data?.[0];
      const t = songToWave(catalog || s);
      if (t) tracks.push(t);
    }
    next = page.next;
  }
  return {
    key: `am:pl:${id}`,
    name: p?.attributes?.name || 'Playlist',
    cover: artwork(p?.attributes?.artwork) || tracks[0]?.cover,
    ownerName: 'Apple Music',
    owned: Boolean(p?.attributes?.canEdit),
    tracks,
    trackCount: tracks.length,
    service: 'am'
  };
}

/** Page served on 127.0.0.1 that runs MusicKit JS and reports the Music User Token via the title. */
export function authPageHtml(): string {
  const token = developerToken() || '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in with Apple ID</title>
<style>body{font-family:system-ui;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
<script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" data-web-components async></script></head>
<body><p id="s">Connecting to Apple Music…</p><script>
document.addEventListener('musickitloaded', async () => {
  try {
    const music = await MusicKit.configure({ developerToken: ${JSON.stringify(token)}, app: { name: 'Wave', build: '1.0.0' } });
    document.getElementById('s').textContent = 'Waiting for Apple ID sign-in…';
    const userToken = await music.authorize();
    document.title = 'wave-token:' + userToken;
  } catch (e) {
    document.getElementById('s').textContent = 'Apple sign-in failed: ' + (e && e.message || e);
    setTimeout(() => { document.title = 'wave-error'; }, 3000);
  }
});
</script></body></html>`;
}

// ─── public page import ─────────────────────────────────────────────────

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
  // Library playlist links (p.xxxx) need the signed-in API.
  const libMatch = /\/library\/playlist\/(p\.[A-Za-z0-9]+)/.exec(url.pathname);
  if (libMatch && isAppleSignedIn()) {
    const p = await getLibraryPlaylist(libMatch[1]);
    return {
      name: p.name,
      cover: p.cover,
      tracks: (p.tracks || []).map((t) => ({
        title: t.title,
        artists: t.artists.map((a) => a.name),
        album: t.album?.name,
        duration: t.duration,
        isrc: t.isrc
      }))
    };
  }
  const html = await fetchText(url.toString());
  const list = parseApplePage(html);
  if (!list.tracks.length) throw new Error('No tracks found on the Apple Music page');
  return list;
}
