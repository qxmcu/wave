import { getUserDetail } from '@/api/login';
import { isElectron } from '@/utils';

/**
 * Renderer side of the Wave sign-in flows. The sign-in windows run in the main
 * process; afterwards the merged profile is read back through /user/account.
 */

export type WaveService = 'yt' | 'sp';

export const WAVE_SESSION_TOKEN = 'wave-session';

export interface WaveAuthStatus {
  signedIn: Record<WaveService, boolean>;
  spotifyClientId: string;
}

export const getWaveAuthStatus = async (): Promise<WaveAuthStatus | null> => {
  if (!isElectron) return null;
  return window.electron.ipcRenderer.invoke('wave-auth-status');
};

const signInChannel: Record<WaveService, string> = {
  yt: 'wave-google-login',
  sp: 'wave-spotify-login'
};

/**
 * Opens the sign-in window for a service and returns the user profile on success.
 * `arg` is the Spotify client id.
 */
export const waveSignIn = async (service: WaveService, arg?: unknown): Promise<any | null> => {
  if (!isElectron) throw new Error('Sign-in is only available in the desktop app');
  const ok = await window.electron.ipcRenderer.invoke(signInChannel[service], arg);
  if (!ok) return null;
  localStorage.setItem('token', WAVE_SESSION_TOKEN);
  const { data } = await getUserDetail();
  return data?.profile || null;
};

export const waveSignOut = async (service: WaveService | 'all') => {
  if (!isElectron) return null;
  return window.electron.ipcRenderer.invoke('wave-signout', service);
};
