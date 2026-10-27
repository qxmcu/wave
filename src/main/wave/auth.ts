import { BrowserWindow, ipcMain, safeStorage, session } from 'electron';

import * as accounts from './accounts';
import * as apple from './apple';
import { onAccountsChanged } from './routes';
import * as spotify from './spotify';

/**
 * Sign-in windows for Google (YouTube Music), Spotify and Apple ID.
 * Results are stored by `accounts` and announced to the renderer with
 * the `wave-auth-changed` event so playlists re-sync immediately.
 */

const GOOGLE_PARTITION = 'persist:wave-google';
// Google refuses sign-in from user agents it identifies as embedded browsers;
// a regular desktop Firefox UA is accepted.
const GOOGLE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const GOOGLE_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=' +
  encodeURIComponent(
    'https://www.youtube.com/signin?action_handle_signin=true&next=https%3A%2F%2Fmusic.youtube.com%2F'
  );

export const secretBox: accounts.SecretBox = {
  encrypt: (plain) =>
    safeStorage.isEncryptionAvailable()
      ? `enc:${safeStorage.encryptString(plain).toString('base64')}`
      : plain,
  decrypt: (cipher) =>
    cipher.startsWith('enc:')
      ? safeStorage.decryptString(Buffer.from(cipher.slice(4), 'base64'))
      : cipher
};

let apiPort = 30488;
const notify = (service: string) => {
  onAccountsChanged();
  BrowserWindow.getAllWindows().forEach((w) =>
    w.webContents.send('wave-auth-changed', { service, signedIn: accounts.signedInServices() })
  );
};

// ─── Google / YouTube Music ─────────────────────────────────────────────

async function readYouTubeCookie(): Promise<string | null> {
  const cookies = await session
    .fromPartition(GOOGLE_PARTITION)
    .cookies.get({ domain: '.youtube.com' });
  const hasAuth = cookies.some((c) =>
    ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'].includes(c.name)
  );
  if (!hasAuth) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Picks up an existing Google session (and rotated cookies) on startup: auto-sync without asking again. */
export async function restoreGoogleSession() {
  try {
    const cookie = await readYouTubeCookie();
    if (cookie) {
      accounts.setGoogleCookie(cookie);
      notify('yt');
    }
  } catch (error) {
    console.warn('[wave:auth] restore google session failed:', error);
  }
}

function googleSignIn(parent?: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent,
      width: 480,
      height: 720,
      title: 'Sign in with Google',
      autoHideMenuBar: true,
      webPreferences: { partition: GOOGLE_PARTITION, sandbox: true, contextIsolation: true }
    });
    win.webContents.setUserAgent(GOOGLE_UA);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (!win.isDestroyed()) win.destroy();
      resolve(ok);
    };
    const check = async () => {
      const url = win.isDestroyed() ? '' : win.webContents.getURL();
      if (!/^https:\/\/(music|www)\.youtube\.com\//.test(url)) return;
      const cookie = await readYouTubeCookie();
      if (cookie) {
        accounts.setGoogleCookie(cookie);
        notify('yt');
        finish(true);
      }
    };
    const timer = setInterval(() => void check(), 800);
    win.on('closed', () => finish(false));
    win.webContents.setWindowOpenHandler(({ url }) => {
      win.loadURL(url);
      return { action: 'deny' };
    });
    win.loadURL(GOOGLE_LOGIN_URL);
  });
}

// ─── Spotify ────────────────────────────────────────────────────────────

function spotifySignIn(clientId: string, parent?: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const { verifier, challenge, state } = spotify.createPkce();
    const win = new BrowserWindow({
      parent,
      width: 480,
      height: 760,
      title: 'Sign in with Spotify',
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:wave-spotify', sandbox: true, contextIsolation: true }
    });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (!win.isDestroyed()) win.destroy();
      resolve(ok);
    };
    // The redirect URI is never loaded: the code is taken from the navigation.
    const intercept = (event: Electron.Event, url: string) => {
      if (!url.startsWith(spotify.SPOTIFY_REDIRECT_URI)) return;
      event.preventDefault();
      const params = new URL(url).searchParams;
      const code = params.get('code');
      if (!code || params.get('state') !== state) {
        finish(false);
        return;
      }
      spotify
        .exchangeCode(clientId, code, verifier)
        .then(() => {
          accounts.setSpotifyClientId(clientId);
          notify('sp');
          finish(true);
        })
        .catch((error) => {
          console.error('[wave:auth] spotify token exchange failed:', error);
          finish(false);
        });
    };
    win.webContents.on('will-redirect', intercept);
    win.webContents.on('will-navigate', intercept);
    win.on('closed', () => finish(false));
    win.loadURL(spotify.buildAuthorizeUrl(clientId, challenge, state));
  });
}

// ─── Apple ID (MusicKit) ────────────────────────────────────────────────

function appleSignIn(parent?: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const token = apple.developerToken();
    if (!token) {
      resolve(false);
      return;
    }
    const win = new BrowserWindow({
      parent,
      width: 520,
      height: 720,
      title: 'Sign in with Apple ID',
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:wave-apple', sandbox: true, contextIsolation: true }
    });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (!win.isDestroyed()) win.destroy();
      resolve(ok);
    };
    // MusicKit opens the Apple ID page as a popup and talks back via postMessage
    win.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, parent: win }
    }));
    win.on('page-title-updated', (event, title) => {
      event.preventDefault();
      if (title.startsWith('wave-token:')) {
        apple.setAppleCredentials(
          { ...apple.getAppleCredentials(), musicUserToken: title.slice(11) },
          true
        );
        notify('am');
        finish(true);
      } else if (title === 'wave-error') {
        finish(false);
      }
    });
    win.on('closed', () => finish(false));
    win.loadURL(`http://127.0.0.1:${apiPort}/wave/auth/apple/page`);
  });
}

// ─── IPC ────────────────────────────────────────────────────────────────

export function initializeWaveAuth(port: number) {
  apiPort = port;
  ipcMain.handle('wave-auth-status', () => ({
    signedIn: accounts.signedInServices(),
    spotifyClientId: accounts.getSpotifyClientId(),
    appleConfigured: Boolean(apple.developerToken())
  }));
  ipcMain.handle('wave-google-login', (event) =>
    googleSignIn(BrowserWindow.fromWebContents(event.sender) || undefined)
  );
  ipcMain.handle('wave-spotify-login', (event, clientId?: string) => {
    const id = (clientId || accounts.getSpotifyClientId()).trim();
    if (!id) return false;
    return spotifySignIn(id, BrowserWindow.fromWebContents(event.sender) || undefined);
  });
  ipcMain.handle('wave-apple-login', (event, creds?: apple.AppleCredentials) => {
    if (creds && (creds.developerToken || creds.privateKey)) {
      apple.setAppleCredentials({ ...apple.getAppleCredentials(), ...creds }, true);
    }
    return appleSignIn(BrowserWindow.fromWebContents(event.sender) || undefined);
  });
  ipcMain.handle('wave-signout', async (_event, service: 'yt' | 'sp' | 'am' | 'all') => {
    if (service === 'yt' || service === 'all') {
      await session.fromPartition(GOOGLE_PARTITION).clearStorageData();
    }
    accounts.signOut(service);
    notify(service);
    return accounts.signedInServices();
  });
  void restoreGoogleSession();
}
