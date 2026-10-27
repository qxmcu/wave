import { jsonFile } from './persist';
import * as spotify from './spotify';
import type { AccountProfile } from './types';
import * as youtube from './youtube';

/**
 * Persists service credentials (encrypted with the OS keychain when the host
 * provides an encryptor) and aggregates the signed-in accounts.
 */

export interface SecretBox {
  encrypt: (plain: string) => string;
  decrypt: (cipher: string) => string;
}

/** Values baked in at build time via .env (electron-vite exposes MAIN_VITE_* to the main process). */
const buildEnv: Record<string, string | undefined> = (import.meta as any).env || {};

let box: SecretBox = { encrypt: (s) => s, decrypt: (s) => s };

interface AccountFile {
  google?: string;
  spotify?: string;
  spotifyClientId?: string;
}

const file = () => jsonFile<AccountFile>('accounts', {});

const save = (field: keyof AccountFile, value: unknown) => {
  const f = file();
  if (value === null || value === undefined) delete f.data[field];
  else
    f.data[field] =
      typeof value === 'string' && field === 'spotifyClientId'
        ? value
        : box.encrypt(JSON.stringify(value));
  f.flush();
};

const load = <T>(field: keyof AccountFile): T | null => {
  const raw = file().data[field];
  if (!raw) return null;
  try {
    return JSON.parse(box.decrypt(raw)) as T;
  } catch {
    return null;
  }
};

export function initAccounts(secretBox?: SecretBox) {
  if (secretBox) box = secretBox;
  const google = load<{ cookie: string }>('google');
  if (google?.cookie) youtube.setYouTubeCookie(google.cookie);
  const sp = load<spotify.SpotifyTokens>('spotify');
  if (sp) spotify.setSpotifyTokens(sp);

  spotify.onSpotifyTokens((t) => save('spotify', t));
}

export function setGoogleCookie(cookie: string | null) {
  youtube.setYouTubeCookie(cookie || '');
  save('google', cookie ? { cookie } : null);
  profileCache = null;
}

export function getSpotifyClientId(): string {
  return file().data.spotifyClientId || buildEnv.MAIN_VITE_SPOTIFY_CLIENT_ID || '';
}

export function setSpotifyClientId(id: string) {
  save('spotifyClientId', id.trim());
}

export function signOut(service: 'yt' | 'sp' | 'all') {
  if (service === 'yt' || service === 'all') setGoogleCookie(null);
  if (service === 'sp' || service === 'all') {
    spotify.setSpotifyTokens(null);
    save('spotify', null);
  }
  profileCache = null;
}

export function signedInServices() {
  return {
    yt: youtube.isYouTubeSignedIn(),
    sp: spotify.isSpotifySignedIn()
  };
}

let profileCache: { at: number; list: AccountProfile[] } | null = null;

export function invalidateProfiles() {
  profileCache = null;
}

export async function getProfiles(): Promise<AccountProfile[]> {
  if (profileCache && Date.now() - profileCache.at < 10 * 60_000) return profileCache.list;
  const results = await Promise.allSettled([youtube.getAccount(), spotify.getAccount()]);
  const list = results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean) as AccountProfile[];
  results.forEach(
    (r) =>
      r.status === 'rejected' && console.warn('[wave] account lookup failed:', r.reason?.message)
  );
  profileCache = { at: Date.now(), list };
  return list;
}
