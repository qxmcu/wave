import crypto from 'crypto';

import * as apple from './apple';
import { importFromWebPage, parseTextList } from './genericImport';
import { mapLimit } from './http';
import * as library from './library';
import { matchedTrack, matchToYouTube } from './matcher';
import * as spotify from './spotify';
import type { ImportedList, ImportedTrack, WaveTrack } from './types';
import * as youtube from './youtube';

/**
 * Playlist import: links (YouTube / YouTube Music, Spotify, Apple Music, Amazon
 * Music and any page with schema.org data), pasted text and CSV/metadata.
 * Every imported track is matched to a playable YouTube Music recording and the
 * result is saved as a local Wave playlist (or into Liked Songs).
 */

export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';

export interface ImportTask {
  id: string;
  status: TaskStatus;
  total: number;
  succCount: number;
  failed: string[];
  msg?: string;
  playlistKeys: string[];
}

const tasks = new Map<string, ImportTask>();

export function detectService(link: string): 'yt' | 'sp' | 'am' | 'amz' | 'web' | null {
  const trimmed = link.trim();
  if (/^spotify:(playlist|album|track):/.test(trimmed)) return 'sp';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return 'yt';
  if (/(^|\.)spotify\.com$|^spotify\.link$/.test(host)) return 'sp';
  if (/(^|\.)apple\.com$/.test(host)) return 'am';
  if (/amazon\./.test(host)) return 'amz';
  return 'web';
}

const spotifyUriToUrl = (link: string) => {
  const m = /^spotify:(playlist|album|track):([A-Za-z0-9]+)/.exec(link.trim());
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : link;
};

export async function readLink(link: string): Promise<ImportedList> {
  const service = detectService(link);
  if (!service) throw new Error(`Not a link: ${link}`);
  const url = new URL(spotifyUriToUrl(link.trim()));
  switch (service) {
    case 'yt': {
      const list = url.searchParams.get('list');
      if (list) {
        const p = await youtube.getPlaylist(list);
        return {
          name: p.name,
          cover: p.cover,
          tracks: (p.tracks || []).map((t) => ({
            title: t.title,
            artists: t.artists.map((a) => a.name),
            duration: t.duration,
            key: t.key
          }))
        };
      }
      const videoId =
        url.searchParams.get('v') || (url.hostname === 'youtu.be' ? url.pathname.slice(1) : '');
      const albumMatch = /\/browse\/(MPRE[\w-]+)/.exec(url.pathname);
      if (albumMatch) {
        const a = await youtube.getAlbum(albumMatch[1]);
        return {
          name: a.name,
          cover: a.cover,
          tracks: (a.tracks || []).map((t) => ({
            title: t.title,
            artists: t.artists.map((x) => x.name),
            key: t.key
          }))
        };
      }
      if (videoId) {
        const t = await youtube.getTrackInfo(videoId);
        return {
          name: t?.title || 'YouTube',
          tracks: t ? [{ title: t.title, artists: t.artists.map((a) => a.name), key: t.key }] : []
        };
      }
      throw new Error('Unsupported YouTube link');
    }
    case 'sp': {
      if (url.hostname === 'spotify.link') {
        // Short links redirect to open.spotify.com
        const res = await fetch(url.toString(), { redirect: 'follow' });
        return spotify.importFromUrl(new URL(res.url));
      }
      return spotify.importFromUrl(url);
    }
    case 'am':
      return apple.importFromUrl(url);
    case 'amz':
    case 'web':
      return importFromWebPage(url);
  }
}

async function resolveTracks(task: ImportTask, items: ImportedTrack[]): Promise<WaveTrack[]> {
  const resolved = await mapLimit(items, 4, async (item) => {
    try {
      if (item.key?.startsWith('yt:v:')) {
        return {
          key: item.key,
          videoId: item.key.slice(5),
          title: item.title,
          artists: item.artists.map((name) => ({ name })),
          duration: item.duration
        } as WaveTrack;
      }
      const videoId = await matchToYouTube(item);
      if (!videoId) {
        task.failed.push(`${item.title} - ${item.artists.join(', ')}`);
        return null;
      }
      // Free-text lines carry no reliable artist: use the matched recording's metadata
      const matched = matchedTrack(videoId);
      if (!item.artists.length && matched) return matched;
      // Keep the original metadata (title/album/cover) but play the matched recording.
      const track: WaveTrack = {
        key: `yt:v:${videoId}`,
        videoId,
        title: item.title,
        artists: item.artists.map((name) => ({ name })),
        album: item.album ? { name: item.album, cover: item.cover } : undefined,
        cover: item.cover,
        duration: item.duration,
        isrc: item.isrc
      };
      if (!track.cover) track.cover = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      return track;
    } catch (error) {
      task.failed.push(`${item.title} (${(error as Error).message})`);
      return null;
    } finally {
      task.succCount = task.total - task.failed.length;
    }
  });
  return resolved.filter(Boolean) as WaveTrack[];
}

export interface ImportParams {
  link?: string;
  text?: string;
  local?: string;
  importStarPlaylist?: boolean | string;
  playlistName?: string;
}

export function startImport(params: ImportParams): ImportTask {
  const task: ImportTask = {
    id: crypto.randomUUID(),
    status: 'PENDING',
    total: 0,
    succCount: 0,
    failed: [],
    playlistKeys: []
  };
  tasks.set(task.id, task);
  run(task, params).catch((error) => {
    task.status = 'FAILED';
    task.msg = (error as Error).message;
  });
  return task;
}

async function run(task: ImportTask, params: ImportParams) {
  task.status = 'PROCESSING';
  const lists: ImportedList[] = [];

  if (params.link) {
    let links: string[];
    try {
      links = JSON.parse(params.link);
    } catch {
      links = [params.link];
    }
    for (const link of links.filter(Boolean)) lists.push(await readLink(link));
  } else if (params.text) {
    let text = params.text;
    try {
      text = decodeURIComponent(text);
    } catch {
      /* already decoded */
    }
    // A pasted block of links is imported link by link
    const lines = text.split(/\s+/).filter(Boolean);
    if (lines.length && lines.every((l) => detectService(l))) {
      for (const link of lines) lists.push(await readLink(link));
    } else {
      lists.push({ name: 'Imported playlist', tracks: parseTextList(text) });
    }
  } else if (params.local) {
    const rows: { name: string; artist?: string; album?: string }[] = JSON.parse(params.local);
    lists.push({
      name: 'Imported playlist',
      tracks: rows
        .filter((r) => r.name?.trim())
        .map((r) => ({
          title: r.name.trim(),
          artists: (r.artist || '').split(/\s*[,/]\s*/).filter(Boolean),
          album: r.album || undefined
        }))
    });
  }

  task.total = lists.reduce((n, l) => n + l.tracks.length, 0);
  task.succCount = 0;
  if (!task.total) throw new Error('No songs found to import');

  const toLiked = params.importStarPlaylist === true || params.importStarPlaylist === 'true';
  for (const list of lists) {
    const tracks = await resolveTracks(task, list.tracks);
    if (!tracks.length) continue;
    if (toLiked) {
      tracks
        .slice()
        .reverse()
        .forEach((t) => library.setLiked(t, true));
    } else {
      const name = params.playlistName?.trim() || list.name || 'Imported playlist';
      const p = library.createPlaylist(name, tracks, {
        cover: list.cover,
        description: list.description,
        source: 'import'
      });
      task.playlistKeys.push(p.key);
    }
  }
  task.succCount = task.total - task.failed.length;
  task.status = task.succCount > 0 ? 'COMPLETE' : 'FAILED';
  if (task.status === 'FAILED') task.msg = 'None of the songs could be matched';
}

export function getTask(id: string) {
  return tasks.get(id);
}
