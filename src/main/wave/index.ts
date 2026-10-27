import type { Server } from 'http';

import { initAccounts, type SecretBox } from './accounts';
import { flushAll, setDataDir } from './persist';
import { createApp, setApiPort } from './routes';

export interface StartOptions {
  port: number;
  host?: string;
  dataDir: string;
  secretBox?: SecretBox;
}

let server: Server | null = null;

/** Starts the Wave music API (YouTube Music / Spotify / Apple Music backend). */
export async function startWaveApi(options: StartOptions): Promise<Server> {
  setDataDir(options.dataDir);
  initAccounts(options.secretBox);
  setApiPort(options.port);
  const app = createApp();
  const listening = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(options.port, options.host || '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  server = listening;
  process.once('exit', flushAll);
  return listening;
}

export function stopWaveApi() {
  flushAll();
  server?.close();
  server = null;
}
