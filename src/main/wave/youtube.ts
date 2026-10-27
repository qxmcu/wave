import { Innertube, UniversalCache, YTMusic, YTNodes } from 'youtubei.js';

import { getDataDir } from './persist';
import type {
  AccountProfile,
  WaveAlbum,
  WaveArtist,
  WaveArtistDetail,
  WavePlaylist,
  WaveTrack,
  WaveVideo
} from './types';

/**
 * YouTube Music provider (InnerTube via youtubei.js).
 *
 * Works signed out; when the user signs in with Google the cookie jar from the
 * sign-in window is passed in and library/likes/playlists become available.
 * youtubei.js node types are deep unions, so parsing here is deliberately
 * duck-typed and defensive.
 */

type AnyNode = any;

let client: Innertube | null = null;
let clientPromise: Promise<Innertube> | null = null;
let currentCookie = '';

export function setYouTubeCookie(cookie: string) {
  if (cookie === currentCookie) return;
  currentCookie = cookie;
  client = null;
  clientPromise = null;
}

export function isYouTubeSignedIn() {
  return Boolean(currentCookie);
}

export async function yt(): Promise<Innertube> {
  if (client) return client;
  if (!clientPromise) {
    clientPromise = Innertube.create({
      cookie: currentCookie || undefined,
      retrieve_player: true,
      generate_session_locally: !currentCookie,
      lang: 'en',
      cache: getDataDir() ? new UniversalCache(true, `${getDataDir()}/yt-cache`) : undefined
    })
      .then((instance) => {
        client = instance;
        return instance;
      })
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

// ─── node helpers ───────────────────────────────────────────────────────

const text = (value: AnyNode): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.toString === 'function') {
    const s = value.toString();
    return s === '[object Object]' ? '' : s;
  }
  return '';
};

export const bestThumb = (thumbs: AnyNode): string => {
  const list: AnyNode[] = Array.isArray(thumbs)
    ? thumbs
    : Array.isArray(thumbs?.contents)
      ? thumbs.contents
      : [];
  if (!list.length) return '';
  const sorted = [...list].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || '';
};

const parseDurationText = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parts = value.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
};

const mapArtists = (list?: AnyNode[]): WaveArtist[] =>
  (list || [])
    .filter((a) => a?.name)
    .map((a) => ({
      name: a.name,
      key: a.channel_id ? `yt:ar:${a.channel_id}` : undefined
    }));

/** Converts any song-ish node (list item, two-row item, queue item) into a track. */
export function nodeToTrack(node: AnyNode): WaveTrack | null {
  if (!node) return null;
  const type = node.type || node.constructor?.type;
  let videoId: string | undefined =
    node.video_id ||
    node.endpoint?.payload?.videoId ||
    (node.item_type !== 'album' ? node.id : undefined);
  if (type === 'PlaylistPanelVideoWrapper') return nodeToTrack(node.primary);
  if (!videoId || typeof videoId !== 'string' || videoId.length !== 11) return null;

  const title = text(node.title) || text(node.name);
  if (!title) return null;

  let artists = mapArtists(node.artists || node.authors);
  if (!artists.length && node.author) {
    artists = typeof node.author === 'string' ? [{ name: node.author }] : mapArtists([node.author]);
  }
  if (!artists.length && node.subtitle) {
    // Two-row items: "Song • Artist • 3.2M plays"
    const runs: AnyNode[] = node.subtitle.runs || [];
    const fromRuns = runs
      .filter((r) => r.endpoint?.payload?.browseId?.startsWith?.('UC'))
      .map((r) => ({ name: r.text, key: `yt:ar:${r.endpoint.payload.browseId}` }));
    if (fromRuns.length) artists = fromRuns;
    else {
      const parts = text(node.subtitle)
        .split(' • ')
        .filter((p) => p && !/^(Song|Video|Single|EP|Album)$/i.test(p) && !/views|plays/i.test(p));
      if (parts[0]) artists = [{ name: parts[0] }];
    }
  }

  const cover = bestThumb(node.thumbnail?.contents || node.thumbnail || node.thumbnails);
  const duration =
    (node.duration?.seconds ? node.duration.seconds * 1000 : undefined) ||
    parseDurationText(node.duration?.text);

  const album = node.album?.name
    ? {
        name: node.album.name,
        key: node.album.id ? `yt:al:${node.album.id}` : undefined,
        cover
      }
    : undefined;

  videoId = String(videoId);
  return {
    key: `yt:v:${videoId}`,
    videoId,
    title,
    artists,
    album,
    cover,
    duration,
    isVideo: node.item_type === 'video' || node.item_type === 'non_music_track'
  };
}

const nodeToPlaylist = (node: AnyNode, owned = false): WavePlaylist | null => {
  let id: string | undefined = node.id || node.endpoint?.payload?.browseId;
  if (!id) return null;
  if (id.startsWith('VL')) id = id.slice(2);
  const subtitle = text(node.subtitle);
  return {
    key: `yt:pl:${id}`,
    name: text(node.title),
    cover: bestThumb(node.thumbnail?.contents || node.thumbnail || node.thumbnails),
    description: subtitle,
    ownerName: node.author?.name || subtitle.split(' • ')[0] || 'YouTube Music',
    trackCount:
      parseInt(
        (node.item_count || subtitle.match(/(\d[\d,]*) (songs|tracks|videos)/)?.[1] || '0').replace(
          /,/g,
          ''
        ),
        10
      ) || 0,
    owned,
    service: 'yt'
  };
};

const nodeToAlbum = (node: AnyNode): WaveAlbum | null => {
  const id = node.id || node.endpoint?.payload?.browseId;
  if (!id) return null;
  return {
    key: `yt:al:${id}`,
    name: text(node.title),
    cover: bestThumb(node.thumbnail?.contents || node.thumbnail || node.thumbnails),
    artists: mapArtists(node.artists || (node.author ? [node.author] : [])),
    year: node.year
  };
};

const nodeToArtist = (node: AnyNode) => {
  const id = node.id || node.endpoint?.payload?.browseId;
  if (!id) return null;
  return {
    key: `yt:ar:${id}`,
    name: text(node.name) || text(node.title),
    cover: bestThumb(node.thumbnail?.contents || node.thumbnail || node.thumbnails)
  };
};

const nodeToVideo = (node: AnyNode): WaveVideo | null => {
  const track = nodeToTrack(node);
  if (!track?.videoId) return null;
  const views = text(node.views || node.subtitle).match(/([\d.]+)([KMB]?) (views|plays)/i);
  const mult = { K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>;
  return {
    key: `yt:mv:${track.videoId}`,
    videoId: track.videoId,
    title: track.title,
    artistName: track.artists.map((a) => a.name).join(' / '),
    cover: `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`,
    duration: track.duration,
    views: views ? Math.round(parseFloat(views[1]) * (mult[views[2].toUpperCase()] || 1)) : 0
  };
};

const shelfItems = (shelf: AnyNode): AnyNode[] => shelf?.contents || shelf?.items || [];

// ─── search ─────────────────────────────────────────────────────────────

export type SearchKind = 'song' | 'album' | 'artist' | 'playlist' | 'video';

export async function searchYouTube(query: string, kind: SearchKind, limit = 30) {
  const api = await yt();
  let result: AnyNode = await api.music.search(query, { type: kind });
  const items: AnyNode[] = [];
  const collect = (res: AnyNode) => {
    for (const shelf of res?.contents || []) items.push(...shelfItems(shelf));
  };
  collect(result);
  let guard = 0;
  while (items.length < limit && result?.has_continuation && guard++ < 3) {
    try {
      result = await result.getContinuation();
      collect(result);
    } catch {
      break;
    }
  }
  const sliced = items.slice(0, limit);
  switch (kind) {
    case 'song':
      return sliced.map(nodeToTrack).filter(Boolean) as WaveTrack[];
    case 'video':
      return sliced.map(nodeToVideo).filter(Boolean) as WaveVideo[];
    case 'album':
      return sliced.map(nodeToAlbum).filter(Boolean) as WaveAlbum[];
    case 'artist':
      return sliced.map(nodeToArtist).filter(Boolean) as {
        key: string;
        name: string;
        cover: string;
      }[];
    case 'playlist':
      return sliced.map((n) => nodeToPlaylist(n)).filter(Boolean) as WavePlaylist[];
  }
}

export async function searchSuggestions(query: string): Promise<string[]> {
  const api = await yt();
  const sections: AnyNode[] = await api.music.getSearchSuggestions(query);
  const out: string[] = [];
  for (const section of sections || []) {
    for (const item of section.contents || []) {
      const value = text(item.suggestion) || text(item.title);
      if (value) out.push(value);
    }
  }
  return Array.from(new Set(out)).slice(0, 10);
}

// ─── entities ───────────────────────────────────────────────────────────

export async function getTrackInfo(videoId: string): Promise<WaveTrack | null> {
  const api = await yt();
  const info: AnyNode = await api.music.getInfo(videoId);
  const basic = info.basic_info || {};
  return {
    key: `yt:v:${videoId}`,
    videoId,
    title: basic.title || '',
    artists: basic.author
      ? [
          {
            name: basic.author.replace(/ - Topic$/, ''),
            key: basic.channel_id ? `yt:ar:${basic.channel_id}` : undefined
          }
        ]
      : [],
    cover: bestThumb(basic.thumbnail),
    duration: basic.duration ? basic.duration * 1000 : undefined
  };
}

export async function getPlaylist(playlistId: string, maxTracks = 1000): Promise<WavePlaylist> {
  const api = await yt();
  let page: AnyNode = await api.music.getPlaylist(playlistId);
  const header: AnyNode = page.header?.header || page.header;
  const tracks: WaveTrack[] = [];
  const push = (p: AnyNode) => {
    for (const item of p.items || p.contents || []) {
      const t = nodeToTrack(item);
      if (t) tracks.push(t);
    }
  };
  push(page);
  let guard = 0;
  while (page.has_continuation && tracks.length < maxTracks && guard++ < 50) {
    try {
      page = await page.getContinuation();
      push(page);
    } catch {
      break;
    }
  }
  const editable = (page.header || {}).type === 'MusicEditablePlaylistDetailHeader';
  return {
    key: `yt:pl:${playlistId}`,
    name: text(header?.title) || (playlistId === 'LM' ? 'Liked Music' : 'Playlist'),
    description: text(header?.description?.description) || text(header?.description),
    cover:
      bestThumb(header?.thumbnail?.contents || header?.thumbnail || header?.thumbnails) ||
      tracks[0]?.cover,
    ownerName: text(header?.strapline_text_one) || header?.author?.name || 'YouTube Music',
    owned: editable,
    tracks,
    trackCount: tracks.length,
    service: 'yt'
  };
}

export async function getAlbum(browseId: string): Promise<WaveAlbum> {
  const api = await yt();
  const page: AnyNode = await api.music.getAlbum(browseId);
  const header: AnyNode = page.header;
  const cover = bestThumb(header?.thumbnail?.contents || header?.thumbnails);
  const strapRuns: AnyNode[] = header?.strapline_text_one?.runs || header?.subtitle?.runs || [];
  const artists: WaveArtist[] = strapRuns
    .filter((r) => r.endpoint?.payload?.browseId?.startsWith?.('UC'))
    .map((r) => ({ name: r.text, key: `yt:ar:${r.endpoint.payload.browseId}` }));
  const name = text(header?.title);
  const tracks = (page.contents || [])
    .map((item: AnyNode) => nodeToTrack(item))
    .filter(Boolean)
    .map((t: WaveTrack) => ({
      ...t,
      artists: t.artists.length ? t.artists : artists,
      cover,
      album: { key: `yt:al:${browseId}`, name, cover }
    })) as WaveTrack[];
  const year = (text(header?.subtitle).match(/\b(19|20)\d{2}\b/) || [])[0];
  return {
    key: `yt:al:${browseId}`,
    name,
    cover,
    artists: artists.length ? artists : tracks[0]?.artists || [],
    year,
    description: text(header?.description?.description) || text(header?.description),
    tracks,
    trackCount: tracks.length
  };
}

export async function getArtist(channelId: string): Promise<WaveArtistDetail> {
  const api = await yt();
  const page: AnyNode = await api.music.getArtist(channelId);
  const header: AnyNode = page.header;
  const topTracks: WaveTrack[] = [];
  const albums: WaveAlbum[] = [];
  for (const section of page.sections || []) {
    for (const item of shelfItems(section)) {
      if (
        item.item_type === 'album' ||
        (item.type === 'MusicTwoRowItem' &&
          item.item_type !== 'playlist' &&
          item.item_type !== 'artist' &&
          !item.endpoint?.payload?.videoId)
      ) {
        const album = nodeToAlbum(item);
        if (album && album.key.startsWith('yt:al:MPRE')) albums.push(album);
      } else {
        const t = nodeToTrack(item);
        if (t && !t.isVideo) topTracks.push(t);
      }
    }
  }
  return {
    key: `yt:ar:${channelId}`,
    name: text(header?.title),
    cover: bestThumb(header?.thumbnail?.contents || header?.thumbnail),
    description: text(header?.description),
    topTracks,
    albums
  };
}

export async function getArtistAllSongs(channelId: string): Promise<WaveTrack[]> {
  const api = await yt();
  const page: AnyNode = await api.music.getArtist(channelId);
  try {
    const shelf: AnyNode = await page.getAllSongs();
    const tracks = (shelf?.contents || []).map(nodeToTrack).filter(Boolean) as WaveTrack[];
    if (tracks.length) return tracks;
  } catch {
    /* fall through to top tracks */
  }
  return (await getArtist(channelId)).topTracks;
}

/** Radio / up-next queue seeded from a track — used for "similar songs", FM and daily mixes. */
export async function getRadio(videoId: string, limit = 30): Promise<WaveTrack[]> {
  const api = await yt();
  const panel: AnyNode = await api.music.getUpNext(videoId, true);
  return ((panel?.contents || []).map(nodeToTrack).filter(Boolean) as WaveTrack[])
    .filter((t) => t.videoId !== videoId)
    .slice(0, limit);
}

export async function getLyricsText(videoId: string): Promise<string> {
  const api = await yt();
  const shelf: AnyNode = await api.music.getLyrics(videoId);
  return text(shelf?.description);
}

// ─── feeds ──────────────────────────────────────────────────────────────

export interface FeedSection {
  title: string;
  tracks: WaveTrack[];
  playlists: WavePlaylist[];
  albums: WaveAlbum[];
  artists: { key: string; name: string; cover: string }[];
  videos: WaveVideo[];
}

const splitShelf = (title: string, items: AnyNode[]): FeedSection => {
  const section: FeedSection = {
    title,
    tracks: [],
    playlists: [],
    albums: [],
    artists: [],
    videos: []
  };
  for (const item of items) {
    switch (item.item_type) {
      case 'playlist': {
        const p = nodeToPlaylist(item);
        if (p) section.playlists.push(p);
        break;
      }
      case 'album': {
        const a = nodeToAlbum(item);
        if (a) section.albums.push(a);
        break;
      }
      case 'artist':
      case 'library_artist': {
        const a = nodeToArtist(item);
        if (a) section.artists.push(a);
        break;
      }
      case 'video': {
        const v = nodeToVideo(item);
        if (v) section.videos.push(v);
        const t = nodeToTrack(item);
        if (t) section.tracks.push(t);
        break;
      }
      default: {
        const t = nodeToTrack(item);
        if (t) section.tracks.push(t);
      }
    }
  }
  return section;
};

export async function getHomeSections(): Promise<FeedSection[]> {
  const api = await yt();
  let feed: AnyNode = await api.music.getHomeFeed();
  const sections: FeedSection[] = [];
  const collect = (f: AnyNode) => {
    for (const shelf of f.sections || []) {
      sections.push(splitShelf(text(shelf.header?.title), shelfItems(shelf)));
    }
  };
  collect(feed);
  let guard = 0;
  while (feed.has_continuation && guard++ < 2) {
    try {
      feed = await feed.getContinuation();
      collect(feed);
    } catch {
      break;
    }
  }
  return sections;
}

export async function getExploreSections(): Promise<FeedSection[]> {
  const api = await yt();
  const explore: AnyNode = await api.music.getExplore();
  return (explore.sections || []).map((shelf: AnyNode) =>
    splitShelf(text(shelf.header?.title), shelfItems(shelf))
  );
}

/** Any carousel-based YouTube Music browse page (charts, new releases, moods). */
export async function getBrowseSections(browseId: string, params?: string): Promise<FeedSection[]> {
  const api = await yt();
  const endpoint = new YTNodes.NavigationEndpoint({ browseEndpoint: { browseId, params } });
  const response = await endpoint.call(api.actions, { client: 'YTMUSIC' });
  const page: AnyNode = new YTMusic.Explore(response as AnyNode);
  const sections: FeedSection[] = (page.sections || []).map((shelf: AnyNode) =>
    splitShelf(text(shelf.header?.title), shelfItems(shelf))
  );
  // Grid pages (e.g. new releases) are not carousels
  const grids: AnyNode[] = (response as AnyNode).contents_memo?.get('Grid') || [];
  for (const grid of grids) sections.push(splitShelf('', grid.items || []));
  return sections;
}

// ─── account / library ──────────────────────────────────────────────────

export async function getAccount(): Promise<AccountProfile | null> {
  if (!currentCookie) return null;
  const api = await yt();
  try {
    const accounts: AnyNode[] = await (api.account.getInfo as AnyNode)(true);
    const active = accounts.find((a) => a.is_selected) || accounts[0];
    if (active) {
      return {
        service: 'yt',
        name: text(active.account_name) || 'YouTube Music',
        avatar: bestThumb(active.account_photo),
        email: text(active.account_byline) || undefined
      };
    }
  } catch (error) {
    console.warn('[wave:yt] account info failed:', (error as Error).message);
  }
  return api.session.logged_in ? { service: 'yt', name: 'YouTube Music' } : null;
}

export async function getLibraryPlaylists(): Promise<WavePlaylist[]> {
  if (!currentCookie) return [];
  const api = await yt();
  const library: AnyNode = await api.music.getLibrary();
  const out: WavePlaylist[] = [];
  const seen = new Set<string>();
  const collect = (nodes: AnyNode[]) => {
    for (const node of nodes) {
      if (node.item_type && node.item_type !== 'playlist') continue;
      const p = nodeToPlaylist(node, true);
      if (!p || seen.has(p.key) || p.key === 'yt:pl:' || /^yt:pl:(FEmusic|SE)/.test(p.key))
        continue;
      seen.add(p.key);
      // Only playlists the user created are editable; others are saved ones.
      p.owned = !/^yt:pl:(RD|OLAK|PL[A-Za-z0-9_-]{30,})/.test(p.key) || p.ownerName === 'You';
      out.push(p);
    }
  };
  for (const section of library.contents || []) collect(section.items || section.contents || []);
  return out;
}

export async function likeVideo(videoId: string, like: boolean) {
  if (!currentCookie) return;
  const api = await yt();
  if (like) await api.interact.like(videoId);
  else await api.interact.removeRating(videoId);
}

export async function createPlaylist(name: string, videoIds: string[] = []) {
  const api = await yt();
  const res: AnyNode = await api.playlist.create(name, videoIds, 'PRIVATE');
  return res.playlist_id as string;
}

export async function addToPlaylist(playlistId: string, videoIds: string[]) {
  const api = await yt();
  await api.playlist.addVideos(playlistId, videoIds);
}

export async function removeFromPlaylist(playlistId: string, videoIds: string[]) {
  const api = await yt();
  await api.playlist.removeVideos(playlistId, videoIds);
}

// ─── streaming ──────────────────────────────────────────────────────────

export interface StreamInfo {
  url: string;
  mimeType: string;
  bitrate: number;
  contentLength?: number;
  expiresAt: number;
}

const STREAM_CLIENTS = ['YTMUSIC', 'ANDROID_VR', 'TV', 'IOS', 'WEB_EMBEDDED', 'MWEB'] as const;
const streamCache = new Map<string, StreamInfo>();

export async function getAudioStream(videoId: string, video = false): Promise<StreamInfo> {
  const cacheKey = `${videoId}:${video ? 'v' : 'a'}`;
  const cached = streamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const api = await yt();
  let lastError: unknown;
  for (const clientName of STREAM_CLIENTS) {
    try {
      const format: AnyNode = await api.getStreamingData(videoId, {
        client: clientName as AnyNode,
        type: video ? 'video+audio' : 'audio',
        quality: 'best',
        format: video ? 'mp4' : 'any'
      });
      if (!format?.url) continue;
      const expire = Number(new URL(format.url).searchParams.get('expire')) * 1000;
      const info: StreamInfo = {
        url: format.url,
        mimeType: (format.mime_type || 'audio/webm').split(';')[0],
        bitrate: format.bitrate || format.average_bitrate || 128000,
        contentLength: format.content_length,
        expiresAt: expire || Date.now() + 5 * 3600_000
      };
      streamCache.set(cacheKey, info);
      if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value!);
      return info;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No playable stream for ${videoId}`);
}

export function invalidateStream(videoId: string) {
  streamCache.delete(`${videoId}:a`);
  streamCache.delete(`${videoId}:v`);
}
