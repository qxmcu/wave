import fs from 'fs';
import path from 'path';

/**
 * Tiny JSON file store with debounced writes.
 * The base directory is injected so the backend can run outside Electron (tests).
 */
let baseDir = '';

export function setDataDir(dir: string) {
  baseDir = dir;
  fs.mkdirSync(baseDir, { recursive: true });
}

export function getDataDir() {
  return baseDir;
}

export interface JsonFile<T> {
  data: T;
  save: () => void;
  flush: () => void;
}

const openFiles = new Map<string, JsonFile<any>>();

export function jsonFile<T>(name: string, defaults: T): JsonFile<T> {
  const existing = openFiles.get(name);
  if (existing) return existing as JsonFile<T>;

  const file = baseDir ? path.join(baseDir, `${name}.json`) : '';
  let data = defaults;
  if (file && fs.existsSync(file)) {
    try {
      data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf-8')) };
    } catch (error) {
      console.error(`[wave] failed to read ${file}, starting fresh:`, error);
    }
  }

  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!file) return;
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(handle.data));
      fs.renameSync(tmp, file);
    } catch (error) {
      console.error(`[wave] failed to write ${file}:`, error);
    }
  };
  const save = () => {
    if (timer) return;
    timer = setTimeout(flush, 1000);
  };

  const handle: JsonFile<T> = { data, save, flush };
  openFiles.set(name, handle);
  return handle;
}

export function flushAll() {
  openFiles.forEach((file) => file.flush());
}

/** Test helper: forget open handles so a new data dir is picked up. */
export function resetPersistForTests() {
  openFiles.clear();
}
