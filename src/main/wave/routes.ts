import express, { type Request, type Response } from 'express';
import { Readable } from 'stream';

import * as accounts from './accounts';
import { BROWSER_UA } from './http';
import { fromId, getTrack, parseKey, rememberTrack, toId } from './ids';
import * as importer from './importer';
import * as library from './library';
import { getLyrics } from './lyrics';
import { resolveVideoId } from './matcher';
import { jsonFile } from './persist';
import {
  albumDetailShape,
  albumShape,
  artistDetailShape,
  artistShape,
  LIKED_PLAYLIST_KEY,
  mvShape,
  playlistDetailShape,
  playlistSummaryShape,
  profileShape,
  songShape,
  userId
} from './shapes';
import * as spotify from './spotify';
import type { WaveAlbum, WavePlaylist, WaveTrack, WaveVideo } from './types';
import * as youtube from './youtube';

/**
 * HTTP API served on 127.0.0.1 for the renderer. Paths and response shapes
 * mirror the NetEase Cloud Music API the UI was built against, so the UI runs
 * unchanged on top of YouTube Music and Spotify.
 */

type Handler = (p: Record<string, any>, req: Request, res: Response) => Promise<unknown> | unknown;

let apiPort = 30488;
export const setApiPort = (port: number) => {
  apiPort = port;
};

// ─── small caches ───────────────────────────────────────────────────────

const MEMO_LIMIT = 300;
const memo = new Map<string, { at: number; value: Promise<any> }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = fn().catch((error) => {
    memo.delete(key);
    throw error;
  });
  memo.set(key, { at: Date.now(), value });
  // Bounded: drop the oldest entries instead of growing for the whole session
  while (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value!);
  return value;
}
export const clearCaches = () => memo.clear();

const home = () => cached('home', 30 * 60_000, () => youtube.getHomeSections());
const explore = () => cached('explore', 60 * 60_000, () => youtube.getExploreSections());
const charts = () =>
  cached('charts', 60 * 60_000, () =>
    youtube.getBrowseSections('FEmusic_charts').catch(() => explore())
  );
const newReleases = () =>
  cached('new', 60 * 60_000, () =>
    youtube.getBrowseSections('FEmusic_new_releases_albums').catch(async () => explore())
  );

const flat = <K extends 'tracks' | 'playlists' | 'albums' | 'artists' | 'videos'>(
  sections: youtube.FeedSection[],
  kind: K
) => {
  const seen = new Set<string>();
  return sections
    .flatMap((s) => s[kind] as any[])
    .filter((item) => !seen.has(item.key) && seen.add(item.key)) as youtube.FeedSection[K];
};

const saved = () =>
  jsonFile<{ playlists: Record<string, WavePlaylist>; albums: Record<string, WaveAlbum> }>(
    'saved',
    {
      playlists: {},
      albums: {}
    }
  );

// ─── entity resolution ──────────────────────────────────────────────────

const keyOf = (id: unknown): string => {
  const key = fromId(String(id ?? ''));
  if (!key) throw Object.assign(new Error(`Unknown id ${id}`), { status: 404 });
  return key;
};

async function loadTrack(id: unknown): Promise<WaveTrack> {
  const key = keyOf(id);
  const known = getTrack(key);
  if (known) return known;
  const { service, value } = parseKey(key);
  let track: WaveTrack | null = null;
  if (service === 'yt') track = await youtube.getTrackInfo(value);
  else if (service === 'sp') track = await spotify.getTrack(value);
  if (!track) throw Object.assign(new Error(`Track not found: ${key}`), { status: 404 });
  rememberTrack(track);
  return track;
}

async function loadPlaylist(key: string): Promise<WavePlaylist> {
  const { service, kind, value } = parseKey(key);
  if (service === 'wave') {
    const p = library.getPlaylist(key);
    if (!p) throw Object.assign(new Error('Playlist not found'), { status: 404 });
    return p;
  }
  if (service === 'yt' && kind === 'pl') return youtube.getPlaylist(value);
  if (service === 'sp' && kind === 'pl') return spotify.getPlaylist(value);
  if (service === 'sp' && kind === 'al') {
    const a = await spotify.getAlbum(value);
    return { key, name: a.name, cover: a.cover, tracks: a.tracks, service: 'sp' };
  }
  if (service === 'yt' && kind === 'al') {
    const a = await youtube.getAlbum(value);
    return { key, name: a.name, cover: a.cover, tracks: a.tracks, service: 'yt' };
  }
  throw Object.assign(new Error(`Unsupported playlist ${key}`), { status: 404 });
}

async function loadAlbum(key: string): Promise<WaveAlbum> {
  const { service, kind, value } = parseKey(key);
  if (service === 'yt' && kind === 'al') return youtube.getAlbum(value);
  if (service === 'sp' && kind === 'al') return spotify.getAlbum(value);
  if (service === 'q' && kind === 'al') {
    const [name, artist] = value.split('::');
    const results = (await youtube.searchYouTube(
      `${name} ${artist || ''}`.trim(),
      'album',
      5
    )) as WaveAlbum[];
    if (!results[0]) throw Object.assign(new Error('Album not found'), { status: 404 });
    return youtube.getAlbum(parseKey(results[0].key).value);
  }
  throw Object.assign(new Error(`Unsupported album ${key}`), { status: 404 });
}

async function ytArtistIdFor(key: string): Promise<string> {
  const { service, kind, value } = parseKey(key);
  if (service === 'yt' && kind === 'ar') return value;
  // Spotify / name-only artists: find the matching YouTube Music artist page
  let name = value;
  if (service === 'sp') {
    const t = Object.values(memoArtistNames).find((n) => n.key === key);
    name = t?.name || value;
  }
  const results = (await youtube.searchYouTube(name, 'artist', 3)) as { key: string }[];
  if (!results[0]) throw Object.assign(new Error('Artist not found'), { status: 404 });
  return parseKey(results[0].key).value;
}

// Spotify artist keys carry ids, not names; remember names as songs pass through.
const memoArtistNames: Record<string, { key: string; name: string }> = {};
const rememberArtists = (tracks: WaveTrack[]) => {
  for (const t of tracks)
    for (const a of t.artists)
      if (a.key?.startsWith('sp:ar:')) memoArtistNames[a.key] = { key: a.key, name: a.name };
};

const songs = (tracks: WaveTrack[]) => {
  rememberArtists(tracks);
  return tracks.map(songShape);
};

// ─── user library aggregation (auto-sync with signed-in services) ───────

async function userPlaylists(): Promise<WavePlaylist[]> {
  const local = [library.likedPlaylist(false), ...library.listPlaylists()];
  const remote = await cached('user-playlists', 5 * 60_000, async () => {
    const results = await Promise.allSettled([
      youtube.getLibraryPlaylists(),
      spotify.getUserPlaylists()
    ]);
    results.forEach(
      (r) =>
        r.status === 'rejected' && console.warn('[wave] playlist sync failed:', r.reason?.message)
    );
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  });
  const savedLists = Object.values(saved().data.playlists).map((p) => ({ ...p, owned: false }));
  return [...local, ...remote, ...savedLists];
}

// ─── routes ─────────────────────────────────────────────────────────────

const ok = (body: Record<string, unknown> = {}) => ({ code: 200, ...body });
const num = (v: unknown, d: number) => (v === undefined || v === '' ? d : Number(v) || d);

const SEARCH_KIND: Record<string, youtube.SearchKind> = {
  '1': 'song',
  '10': 'album',
  '100': 'artist',
  '1000': 'playlist',
  '1004': 'video',
  '1014': 'video'
};

const CATEGORIES = [
  ['Pop', 0],
  ['Hip-Hop', 0],
  ['Rock', 0],
  ['R&B', 0],
  ['Electronic', 0],
  ['Dance', 0],
  ['Indie', 0],
  ['Jazz', 0],
  ['Classical', 0],
  ['Country', 0],
  ['Latin', 0],
  ['K-Pop', 0],
  ['J-Pop', 0],
  ['Metal', 0],
  ['Chill', 1],
  ['Feel Good', 1],
  ['Sad', 1],
  ['Romance', 1],
  ['Energy', 1],
  ['Focus', 1],
  ['Sleep', 1],
  ['Workout', 2],
  ['Party', 2],
  ['Commute', 2],
  ['Gaming', 2],
  ['Study', 2],
  ['80s', 3],
  ['90s', 3],
  ['2000s', 3],
  ['2010s', 3]
] as const;

const routes: Record<string, Handler> = {
  // search
  '/cloudsearch': async (p) => {
    const kind = SEARCH_KIND[String(p.type || 1)];
    const limit = num(p.limit, 30);
    const offset = num(p.offset, 0);
    if (!kind || !p.keywords) return ok({ result: { songs: [], songCount: 0 } });
    const items = await cached(`search:${kind}:${p.keywords}:${limit + offset}`, 10 * 60_000, () =>
      youtube.searchYouTube(String(p.keywords), kind, limit + offset)
    );
    const page = (items as any[]).slice(offset, offset + limit);
    const more = (items as any[]).length >= limit + offset;
    switch (kind) {
      case 'song':
        return ok({
          result: {
            songs: songs(page),
            songCount: offset + page.length + (more ? limit : 0),
            hasMore: more
          }
        });
      case 'album':
        return ok({
          result: {
            albums: page.map(albumShape),
            albumCount: offset + page.length + (more ? limit : 0)
          }
        });
      case 'artist':
        return ok({
          result: {
            artists: page.map(artistShape),
            artistCount: offset + page.length + (more ? limit : 0)
          }
        });
      case 'playlist':
        return ok({
          result: {
            playlists: page.map(playlistSummaryShape),
            playlistCount: offset + page.length + (more ? limit : 0)
          }
        });
      case 'video': {
        const mvs = page.map(mvShape);
        return ok({
          result: {
            mvs,
            mvCount: offset + page.length + (more ? limit : 0),
            videos: mvs.map((m) => ({
              ...m,
              vid: m.id,
              title: m.name,
              coverUrl: m.cover,
              durationms: m.duration,
              playTime: m.playCount,
              type: 0,
              creator: [{ userName: m.artistName }]
            })),
            videoCount: offset + page.length
          }
        });
      }
    }
  },
  '/search/suggest': async (p) => {
    const names = await youtube.searchSuggestions(String(p.keywords || ''));
    return ok({ result: { songs: names.map((name) => ({ name })) } });
  },
  '/search/hot/detail': async () => {
    const tracks = flat(await charts(), 'tracks').slice(0, 20);
    return ok({
      data: tracks.map((t, i) => ({
        searchWord: t.title,
        score: 100000 - i * 1000,
        content: t.artists.map((a) => a.name).join(', '),
        source: 0,
        iconType: i < 3 ? 1 : 0,
        iconUrl: null,
        url: '',
        alg: 'wave'
      }))
    });
  },
  '/search/default': async () => {
    const tracks = flat(await home().catch(() => charts()), 'tracks');
    const t = tracks[Math.floor(Math.random() * Math.min(tracks.length, 10))];
    const word = t ? `${t.title} ${t.artists[0]?.name || ''}`.trim() : '';
    return ok({ data: { showKeyword: word, realkeyword: word, searchType: 1 } });
  },

  // home
  '/banner': async () => {
    const albums = flat(await newReleases(), 'albums').slice(0, 8);
    return ok({
      banners: albums.map((a) => ({
        imageUrl: albumShape(a).picUrl,
        pic: albumShape(a).picUrl,
        targetId: toId(a.key),
        targetType: 10,
        typeTitle: 'New',
        titleColor: 'red',
        url: '',
        exclusive: false
      }))
    });
  },
  '/personalized': async (p) => {
    const limit = num(p.limit, 30);
    const lists = flat(await home().catch(() => explore()), 'playlists');
    const more = lists.length < limit ? flat(await explore().catch(() => []), 'playlists') : [];
    return ok({
      hasTaste: false,
      category: 0,
      result: [...lists, ...more].slice(0, limit).map(playlistSummaryShape)
    });
  },
  '/personalized/newsong': async (p) => {
    const tracks = flat(await newReleases().catch(() => home()), 'tracks');
    const pool = tracks.length >= 6 ? tracks : [...tracks, ...flat(await home(), 'tracks')];
    return ok({
      category: 0,
      result: pool.slice(0, num(p.limit, 12)).map((t) => {
        const s = songShape(t);
        return {
          id: s.id,
          name: s.name,
          picUrl: s.picUrl,
          type: 4,
          song: { ...s, artists: s.ar, album: s.al, duration: s.dt }
        };
      })
    });
  },
  '/recommend/songs': async () => {
    const quick = flat(await home(), 'tracks').slice(0, 30);
    return ok({ data: { dailySongs: songs(quick), orderSongs: [], recommendReasons: [] } });
  },
  '/recommend/songs/dislike': async () => {
    const pool = flat(await home(), 'tracks');
    const t = pool[Math.floor(Math.random() * pool.length)];
    return ok({ data: t ? songShape(t) : null });
  },
  '/personal_fm': async () => {
    const seeds = [...library.likedKeys(), ...library.history(30).map((h) => h.key)].filter((k) =>
      k.startsWith('yt:v:')
    );
    const seed =
      seeds[Math.floor(Math.random() * seeds.length)] || flat(await home(), 'tracks')[0]?.key;
    const radio = seed ? await youtube.getRadio(seed.replace('yt:v:', ''), 10) : [];
    return ok({ popAdjust: false, data: songs(radio.sort(() => Math.random() - 0.5).slice(0, 3)) });
  },
  '/fm_trash': () => ok(),
  '/personalized/privatecontent': () => ok({ result: [] }),
  '/personalized/mv': async () => {
    const videos = flat(await charts(), 'videos').slice(0, 8);
    return ok({
      category: 5,
      result: videos.map((v) => ({ ...mvShape(v), type: 5, copywriter: v.artistName }))
    });
  },
  '/personalized/djprogram': () => ok({ result: [] }),
  '/top/artists': async (p) => {
    const artists = [
      ...flat(await charts(), 'artists'),
      ...flat(await home().catch(() => []), 'artists')
    ];
    const offset = num(p.offset, 0);
    const limit = num(p.limit, 30);
    return ok({
      artists: artists.slice(offset, offset + limit).map(artistShape),
      more: artists.length > offset + limit
    });
  },
  '/toplist': async () => {
    const lists = flat(await charts(), 'playlists');
    return ok({
      list: lists.map((pl) => ({
        ...playlistSummaryShape(pl),
        updateFrequency: 'Weekly',
        ToplistType: '',
        tracks: []
      }))
    });
  },
  '/playlist/catlist': () =>
    ok({
      all: { name: 'All', category: 0, hot: true },
      categories: { 0: 'Genres', 1: 'Moods', 2: 'Activities', 3: 'Decades' },
      sub: CATEGORIES.map(([name, category]) => ({
        name,
        category,
        hot: true,
        activity: false,
        type: 0
      }))
    }),
  '/top/playlist': async (p) => topPlaylists(p),
  '/top/playlist/highquality': async (p) => {
    const res = await topPlaylists({ ...p, cat: p.cat || 'All' });
    return { ...res, lasttime: 0 };
  },
  '/album/newest': async () => ok({ albums: flat(await newReleases(), 'albums').map(albumShape) }),
  '/album/new': async (p) => {
    const albums = flat(await newReleases(), 'albums');
    const offset = num(p.offset, 0);
    const limit = num(p.limit, 30);
    return ok({
      total: albums.length,
      albums: albums.slice(offset, offset + limit).map(albumShape)
    });
  },
  '/top/album': async (p) => {
    const albums = flat(await newReleases(), 'albums')
      .slice(0, num(p.limit, 30))
      .map(albumShape);
    return ok({ weekData: albums, monthData: albums, hasMore: false });
  },
  '/mv/all': async (p) => {
    const offset = num(p.offset, 0);
    const limit = num(p.limit, 30);
    let videos = flat(await charts(), 'videos');
    if (videos.length < offset + limit) {
      const more = (await cached(`mv-search:${p.area || ''}`, 60 * 60_000, () =>
        youtube.searchYouTube(
          `${p.area && p.area !== '全部' ? p.area : 'new'} music video`,
          'video',
          60
        )
      )) as WaveVideo[];
      videos = [...videos, ...more.filter((v) => !videos.some((x) => x.key === v.key))];
    }
    return ok({
      count: videos.length,
      hasMore: videos.length > offset + limit,
      data: videos.slice(offset, offset + limit).map(mvShape)
    });
  },
  '/mv/detail': async (p) => {
    const { value } = parseKey(keyOf(p.mvid ?? p.id));
    const info = await youtube.getTrackInfo(value);
    const video: WaveVideo = {
      key: `yt:mv:${value}`,
      videoId: value,
      title: info?.title || '',
      artistName: info?.artists.map((a) => a.name).join(' / ') || '',
      cover: `https://i.ytimg.com/vi/${value}/hqdefault.jpg`,
      duration: info?.duration
    };
    return ok({ data: { ...mvShape(video), brs: [{ size: 0, br: 720, point: 0 }] }, subed: false });
  },
  '/mv/url': async (p) => {
    const id = toId(keyOf(p.id));
    return ok({
      data: {
        id,
        url: `http://127.0.0.1:${apiPort}/wave/video/${id}`,
        r: 720,
        size: 0,
        code: 200,
        fee: 0
      }
    });
  },

  // songs
  '/song/detail': async (p) => {
    const ids = String(p.ids || p.id || '')
      .split(',')
      .filter(Boolean);
    const tracks = (await Promise.all(ids.map((id) => loadTrack(id).catch(() => null)))).filter(
      Boolean
    ) as WaveTrack[];
    const shaped = songs(tracks);
    return ok({ songs: shaped, privileges: shaped.map((s) => s.privilege) });
  },
  '/song/url/v1': async (p) => songUrl(p),
  '/song/url': async (p) => songUrl(p),
  '/song/download/url/v1': async (p) => {
    const res = await songUrl(p);
    return ok({ data: res.data[0] });
  },
  '/song/music/detail': () =>
    ok({ data: { h: { br: 160000 }, m: { br: 128000 }, l: { br: 96000 } } }),
  '/lyric/new': async (p) => lyric(p),
  '/lyric': async (p) => lyric(p),
  '/like': async (p) => {
    const track = await loadTrack(p.id);
    const like = String(p.like) !== 'false';
    library.setLiked(track, like);
    const { service, value } = parseKey(track.key);
    if (service === 'yt') youtube.likeVideo(value, like).catch(() => {});
    if (service === 'sp') spotify.setSaved(value, like).catch(() => {});
    return ok({ playlistId: toId(LIKED_PLAYLIST_KEY) });
  },
  '/likelist': () => ok({ ids: library.likedKeys().map(toId), checkPoint: Date.now() }),

  // playlists / albums / artists
  '/playlist/detail': async (p) => {
    const key = keyOf(p.id);
    const playlist = await cached(`pl:${key}`, key.startsWith('wave:') ? 0 : 5 * 60_000, () =>
      loadPlaylist(key)
    );
    rememberArtists(playlist.tracks || []);
    return playlistDetailShape(playlist);
  },
  '/playlist/track/all': async (p) => {
    const detail = (await routes['/playlist/detail'](p, undefined as any, undefined as any)) as any;
    const offset = num(p.offset, 0);
    const limit = num(p.limit, 1000);
    const list = detail.playlist.tracks.slice(offset, offset + limit);
    return ok({ songs: list, privileges: list.map((s: any) => s.privilege) });
  },
  '/playlist/create': async (p) => {
    const created = library.createPlaylist(String(p.name || 'New playlist'));
    clearUserCaches();
    const shaped = playlistSummaryShape(created);
    return ok({ id: shaped.id, playlist: shaped });
  },
  '/playlist/delete': async (p) => {
    library.deletePlaylist(keyOf(p.id));
    clearUserCaches();
    return ok();
  },
  '/playlist/tracks': async (p) => playlistTracks(p),
  '/playlist/subscribe': async (p) => {
    const key = keyOf(p.id);
    const store = saved();
    if (String(p.t) === '1') {
      const pl = await loadPlaylist(key);
      store.data.playlists[key] = {
        ...pl,
        tracks: undefined,
        trackCount: pl.tracks?.length ?? pl.trackCount
      };
    } else delete store.data.playlists[key];
    store.save();
    clearUserCaches();
    return ok();
  },
  '/album': async (p) => {
    const key = keyOf(p.id);
    const album = await cached(`al:${key}`, 30 * 60_000, () => loadAlbum(key));
    rememberArtists(album.tracks || []);
    return albumDetailShape(album);
  },
  '/album/detail/dynamic': async (p) =>
    ok({
      isSub: Boolean(saved().data.albums[keyOf(p.id)]),
      subCount: 0,
      commentCount: 0,
      shareCount: 0
    }),
  '/album/sub': async (p) => {
    const key = keyOf(p.id);
    const store = saved();
    if (String(p.t) === '1') {
      const album = await loadAlbum(key);
      store.data.albums[key] = { ...album, tracks: undefined, trackCount: album.tracks?.length };
    } else delete store.data.albums[key];
    store.save();
    return ok();
  },
  '/album/sublist': async (p) => {
    const albums = Object.values(saved().data.albums);
    const offset = num(p.offset, 0);
    const limit = num(p.limit, 25);
    return ok({
      count: albums.length,
      hasMore: albums.length > offset + limit,
      data: albums.slice(offset, offset + limit).map(albumShape)
    });
  },
  '/artist/detail': async (p) => {
    const channelId = await ytArtistIdFor(keyOf(p.id));
    const detail = await cached(`ar:${channelId}`, 30 * 60_000, () => youtube.getArtist(channelId));
    return artistDetailShape({ ...detail, key: keyOf(p.id) });
  },
  '/artists': async (p) => {
    const channelId = await ytArtistIdFor(keyOf(p.id));
    const detail = await youtube.getArtist(channelId);
    return ok({ artist: artistShape(detail), hotSongs: songs(detail.topTracks), more: false });
  },
  '/artist/songs': async (p) => {
    const channelId = await ytArtistIdFor(keyOf(p.id));
    const all = await cached(`ar-songs:${channelId}`, 30 * 60_000, () =>
      youtube.getArtistAllSongs(channelId)
    );
    const offset = num(p.offset, 0);
    const limit = num(p.limit, 50);
    return ok({
      songs: songs(all.slice(offset, offset + limit)),
      total: all.length,
      more: all.length > offset + limit
    });
  },
  '/artist/top/song': async (p) => {
    const channelId = await ytArtistIdFor(keyOf(p.id));
    const detail = await youtube.getArtist(channelId);
    return ok({ songs: songs(detail.topTracks), more: false });
  },
  '/artist/album': async (p) => {
    const key = keyOf(p.id);
    const channelId = await ytArtistIdFor(key);
    const detail = await cached(`ar:${channelId}`, 30 * 60_000, () => youtube.getArtist(channelId));
    const offset = num(p.offset, 0);
    const limit = num(p.limit, 30);
    return ok({
      artist: artistShape({ ...detail, key }),
      hotAlbums: detail.albums.slice(offset, offset + limit).map(albumShape),
      more: detail.albums.length > offset + limit
    });
  },
  '/artist/new/song': async () => ok({ data: { hasMore: false, newSongCount: 0, newWorks: [] } }),
  '/simi/song': async (p) => {
    const track = await loadTrack(p.id);
    const videoId = await resolveVideoId(track);
    return ok({ songs: songs(videoId ? await youtube.getRadio(videoId, 20) : []) });
  },
  '/playmode/intelligence/list': async (p) => {
    const track = await loadTrack(p.id);
    const videoId = await resolveVideoId(track);
    const radio = videoId ? await youtube.getRadio(videoId, 40) : [];
    return ok({
      data: songs(radio).map((s) => ({ id: s.id, recommended: true, alg: 'wave', songInfo: s }))
    });
  },
  '/history/recommend/songs': () =>
    ok({ data: { dates: [], purchaseUrl: '', description: '', noHistoryMessage: '' } }),
  '/history/recommend/songs/detail': () => ok({ data: { songs: [] } }),

  // user
  '/login/status': async () => {
    const profiles = await accounts.getProfiles();
    if (!profiles.length) return { data: { code: 200, account: null, profile: null } };
    return {
      data: { code: 200, account: { id: userId(), type: 1 }, profile: profileShape(profiles) }
    };
  },
  '/user/account': async () => {
    const profiles = await accounts.getProfiles();
    if (!profiles.length) return ok({ account: null, profile: null });
    return ok({
      account: { id: userId(), userName: profiles[0].name, type: 1, vipType: 0 },
      profile: profileShape(profiles)
    });
  },
  '/user/detail': async (p) => {
    const profiles = await accounts.getProfiles();
    const mine = !p.uid || Number(p.uid) === userId();
    const playlists = mine ? await userPlaylists() : [];
    const profile = mine
      ? { ...profileShape(profiles), playlistCount: playlists.length }
      : { ...profileShape([]), userId: Number(p.uid), nickname: '' };
    return ok({
      level: 10,
      listenSongs: library.history(1000).reduce((n, h) => n + h.count, 0),
      createDays: 0,
      profile,
      bindings: [],
      peopleCanSeeMyPlayRecord: true
    });
  },
  '/user/playlist': async (p) => {
    const all = await userPlaylists();
    const offset = num(p.offset, 0);
    const limit = num(p.limit, 1000);
    return ok({
      more: all.length > offset + limit,
      playlist: all.slice(offset, offset + limit).map(playlistSummaryShape)
    });
  },
  '/user/record': async () => {
    const entries = library.history(100);
    const max = Math.max(1, ...entries.map((e) => e.count));
    const data = entries.map((e) => ({
      playCount: e.count,
      score: Math.round((e.count / max) * 100),
      song: songShape(e.track)
    }));
    return ok({ weekData: data, allData: data });
  },
  '/record/recent/song': async (p) => {
    const entries = library.history(num(p.limit, 100));
    return ok({
      data: {
        total: entries.length,
        list: entries.map((e) => ({
          resourceId: String(toId(e.key)),
          playTime: e.at,
          resourceType: 'SONG',
          data: songShape(e.track)
        }))
      }
    });
  },
  '/record/recent/playlist': () => ok({ data: { total: 0, list: [] } }),
  '/record/recent/album': () => ok({ data: { total: 0, list: [] } }),
  '/record/recent/dj': () => ok({ data: { total: 0, list: [] } }),
  '/user/follows': () => ok({ follow: [], more: false }),
  '/user/followeds': () => ok({ followeds: [], more: false, size: 0 }),
  '/logout': () => {
    accounts.signOut('all');
    clearUserCaches();
    return ok();
  },
  // NetEase-only login flows are not used by Wave
  '/login/qr/key': () => ok({ data: { code: 200, unikey: '' } }),
  '/login/qr/create': () => ok({ data: { qrurl: '', qrimg: '' } }),
  '/login/qr/check': () => ({ code: 800, message: 'Use Google or Spotify sign-in' }),
  '/login/cellphone': () => ({ code: 400, message: 'Use Google or Spotify sign-in' }),

  // import
  '/playlist/import/name/task/create': async (p) => {
    const task = importer.startImport(p);
    clearUserCaches();
    return ok({ data: { taskId: task.id, taskIds: [task.id] } });
  },
  '/playlist/import/task/status': async (p) => {
    const task = importer.getTask(String(p.id));
    if (!task)
      return ok({ data: { tasks: [{ status: 'FAILED', msg: 'Task not found', succCount: 0 }] } });
    if (task.status === 'COMPLETE') clearUserCaches();
    return ok({
      data: {
        tasks: [
          {
            taskId: task.id,
            status: task.status,
            succCount: task.succCount,
            totalCount: task.total,
            failedSongs: task.failed,
            msg:
              task.msg ||
              (task.failed.length ? `Not matched: ${task.failed.slice(0, 5).join('; ')}` : '')
          }
        ]
      }
    });
  },

  // podcasts are not offered; return valid empty shapes
  '/dj/sublist': () => ok({ djRadios: [], count: 0, hasMore: false }),
  '/dj/detail': () => ok({ data: null }),
  '/dj/program': () => ok({ programs: [], count: 0, more: false }),
  '/dj/program/detail': () => ok({ program: null }),
  '/dj/recommend': () => ok({ djRadios: [] }),
  '/dj/catelist': () => ok({ categories: [] }),
  '/dj/recommend/type': () => ok({ djRadios: [], hasMore: false }),
  '/dj/category/recommend': () => ok({ data: [] }),
  '/dj/today/perfered': () => ok({ data: [] }),
  '/dj/personalize/recommend': () => ok({ data: [] }),
  '/dj/banner': () => ok({ data: [] }),
  '/dj/toplist': () => ok({ toplist: [], updateTime: 0 }),
  '/dj/radio/hot': () => ok({ djRadios: [], hasMore: false }),
  '/dj/sub': () => ok(),
  '/comment/dj': () => ok({ comments: [], hotComments: [], total: 0, more: false })
};

async function topPlaylists(p: Record<string, any>) {
  const cat = String(p.cat || 'All');
  const offset = num(p.offset, 0);
  const limit = num(p.limit, 30);
  let lists: WavePlaylist[];
  if (/^(all|全部)$/i.test(cat)) {
    lists = [
      ...flat(await home().catch(() => []), 'playlists'),
      ...flat(await explore().catch(() => []), 'playlists')
    ];
  } else {
    lists = (await cached(`cat:${cat}:${offset + limit}`, 60 * 60_000, () =>
      youtube.searchYouTube(`${cat} playlist`, 'playlist', offset + limit)
    )) as WavePlaylist[];
  }
  return ok({
    cat,
    total: lists.length,
    more: lists.length > offset + limit,
    playlists: lists.slice(offset, offset + limit).map(playlistSummaryShape)
  });
}

async function songUrl(
  p: Record<string, any>
): Promise<{ code: number; data: Record<string, unknown>[] }> {
  const ids = String(p.id || '')
    .split(',')
    .filter(Boolean);
  const data = await Promise.all(
    ids.map(async (raw) => {
      const id = Number(raw);
      try {
        const track = await loadTrack(raw);
        const videoId = await resolveVideoId(track);
        if (!videoId)
          return { id, url: null, br: 0, size: 0, code: 404, type: null, freeTrialInfo: null };
        library.recordPlay(track);
        return {
          id,
          url: `http://127.0.0.1:${apiPort}/wave/stream/${id}`,
          br: 160000,
          size: 0,
          md5: '',
          code: 200,
          type: 'm4a',
          level: 'exhigh',
          encodeType: 'aac',
          fee: 0,
          freeTrialInfo: null,
          time: track.duration || 0
        };
      } catch (error) {
        console.warn('[wave] song url failed:', (error as Error).message);
        return { id, url: null, br: 0, size: 0, code: 404, type: null, freeTrialInfo: null };
      }
    })
  );
  return { code: 200, data };
}

async function lyric(p: Record<string, any>) {
  const track = await loadTrack(p.id);
  const videoId = await resolveVideoId(track).catch(() => null);
  const lrc = await cached(`lrc:${track.key}`, 24 * 3600_000, () => getLyrics(track, videoId));
  return ok({
    sgc: false,
    sfy: false,
    qfy: false,
    lrc: { version: 1, lyric: lrc },
    tlyric: { version: 0, lyric: '' },
    romalrc: { version: 0, lyric: '' }
  });
}

async function playlistTracks(p: Record<string, any>) {
  const key = keyOf(p.pid);
  const ids = String(p.tracks || '')
    .split(',')
    .filter(Boolean);
  const tracks = (await Promise.all(ids.map((id) => loadTrack(id).catch(() => null)))).filter(
    Boolean
  ) as WaveTrack[];
  const add = p.op !== 'del';
  const { service, value } = parseKey(key);
  if (service === 'wave') {
    if (add) library.addTracks(key, tracks);
    else
      library.removeTracks(
        key,
        tracks.map((t) => t.key)
      );
  } else if (service === 'yt') {
    const videoIds = (await Promise.all(tracks.map((t) => resolveVideoId(t)))).filter(
      Boolean
    ) as string[];
    if (add) await youtube.addToPlaylist(value, videoIds);
    else await youtube.removeFromPlaylist(value, videoIds);
  } else if (service === 'sp') {
    const spIds = tracks.filter((t) => t.key.startsWith('sp:t:')).map((t) => t.key.slice(5));
    if (!spIds.length)
      return { code: 400, message: 'Only Spotify tracks can be added to a Spotify playlist' };
    if (add) await spotify.addTracks(value, spIds);
    else await spotify.removeTracks(value, spIds);
  } else {
    return { code: 400, message: 'This playlist cannot be edited' };
  }
  memo.delete(`pl:${key}`);
  clearUserCaches();
  return { code: 200, body: { code: 200 } };
}

function clearUserCaches() {
  memo.delete('user-playlists');
  accounts.invalidateProfiles();
}

export function onAccountsChanged() {
  clearUserCaches();
  memo.delete('home');
}

// ─── media proxy ────────────────────────────────────────────────────────

async function proxyStream(req: Request, res: Response, video: boolean) {
  const id = req.params.id;
  let videoId: string | null;
  try {
    const key = keyOf(id);
    const { service, kind, value } = parseKey(key);
    videoId =
      service === 'yt' && (kind === 'v' || kind === 'mv')
        ? value
        : await resolveVideoId(await loadTrack(id));
  } catch {
    res.status(404).end();
    return;
  }
  if (!videoId) {
    res.status(404).end();
    return;
  }

  const range = req.headers.range;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stream = await youtube.getAudioStream(videoId, video);
      const upstream = await fetch(stream.url, {
        headers: { 'User-Agent': BROWSER_UA, ...(range ? { Range: range } : { Range: 'bytes=0-' }) }
      });
      if (upstream.status === 403 || upstream.status === 410) {
        youtube.invalidateStream(videoId);
        continue;
      }
      if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
      const contentRange = upstream.headers.get('content-range');
      const contentLength = upstream.headers.get('content-length');
      res.setHeader('Content-Type', stream.mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (range) {
        // Pass partial responses straight through so seeking works
        res.status(upstream.status);
        if (contentRange) res.setHeader('Content-Range', contentRange);
        if (contentLength) res.setHeader('Content-Length', contentLength);
      } else {
        res.status(200);
        const total = contentRange?.split('/')[1];
        if (total && total !== '*') res.setHeader('Content-Length', total);
        else if (contentLength) res.setHeader('Content-Length', contentLength);
      }
      if (!upstream.body) {
        res.end();
        return;
      }
      const body = Readable.fromWeb(upstream.body as any);
      req.on('close', () => body.destroy());
      body.pipe(res);
      return;
    } catch (error) {
      console.warn('[wave] stream failed:', (error as Error).message);
      youtube.invalidateStream(videoId);
    }
  }
  if (!res.headersSent) res.status(502).end();
}

// ─── app ────────────────────────────────────────────────────────────────

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/wave/stream/:id', (req, res) => void proxyStream(req, res, false));
  app.get('/wave/video/:id', (req, res) => void proxyStream(req, res, true));
  app.get('/wave/auth/status', (_req, res) => {
    res.json({
      code: 200,
      signedIn: accounts.signedInServices(),
      spotifyClientId: accounts.getSpotifyClientId()
    });
  });

  app.all(/.*/, async (req, res) => {
    const handler = routes[req.path];
    const params = {
      ...(req.query as Record<string, any>),
      ...(typeof req.body === 'object' ? req.body : {})
    };
    if (!handler) {
      // Unknown NetEase endpoint: answer with an empty but valid payload instead of failing the UI
      res.json({ code: 200, data: [], result: [], list: [] });
      return;
    }
    try {
      res.json(await handler(params, req, res));
    } catch (error) {
      const status = (error as any).status || 500;
      console.warn(`[wave] ${req.path} failed:`, (error as Error).message);
      res
        .status(status === 404 ? 404 : 500)
        .json({ code: status, msg: (error as Error).message, message: (error as Error).message });
    }
  });
  return app;
}

export { routes };
