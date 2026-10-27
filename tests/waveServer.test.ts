import fs from 'fs';
import type { Server } from 'http';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WaveTrack } from '../src/main/wave/types';

const track = (videoId: string, title: string, artist: string, duration = 200000): WaveTrack => ({
  key: `yt:v:${videoId}`,
  videoId,
  title,
  artists: [{ name: artist, key: `yt:ar:UC${artist.replace(/\W/g, '')}` }],
  album: { name: `${title} - Single`, key: `yt:al:MPRE${videoId}` },
  cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  duration
});

const catalog = [
  track('aaaaaaaaaaa', 'Yellow', 'Coldplay', 266000),
  track('bbbbbbbbbbb', 'Hello', 'Adele', 295000),
  track('ccccccccccc', 'Clocks', 'Coldplay', 307000)
];

vi.mock('../src/main/wave/youtube', () => ({
  isYouTubeSignedIn: () => false,
  setYouTubeCookie: () => {},
  getAccount: async () => null,
  getLibraryPlaylists: async () => [],
  searchYouTube: async (query: string, kind: string) => {
    if (kind === 'song') {
      const q = query.toLowerCase();
      return catalog.filter((t) => q.includes(t.title.toLowerCase()));
    }
    if (kind === 'playlist')
      return [{ key: 'yt:pl:PLx', name: `${query}`, service: 'yt', trackCount: 3 }];
    return [];
  },
  searchSuggestions: async () => ['yellow coldplay'],
  getTrackInfo: async (id: string) => catalog.find((t) => t.videoId === id) || null,
  getPlaylist: async (id: string) => ({
    key: `yt:pl:${id}`,
    name: 'YT Mix',
    tracks: catalog,
    service: 'yt'
  }),
  getAlbum: async () => ({ key: 'yt:al:MPREx', name: 'Album', artists: [], tracks: catalog }),
  getArtist: async (id: string) => ({
    key: `yt:ar:${id}`,
    name: 'Coldplay',
    topTracks: catalog,
    albums: []
  }),
  getArtistAllSongs: async () => catalog,
  getRadio: async () => catalog,
  getLyricsText: async () => 'line one\nline two',
  getHomeSections: async () => [
    {
      title: 'Quick picks',
      tracks: catalog,
      playlists: [{ key: 'yt:pl:RDx', name: 'Mix', service: 'yt' }],
      albums: [],
      artists: [],
      videos: []
    }
  ],
  getExploreSections: async () => [],
  getBrowseSections: async () => [
    {
      title: 'Charts',
      tracks: catalog,
      playlists: [{ key: 'yt:pl:TOP', name: 'Top 100', service: 'yt' }],
      albums: [{ key: 'yt:al:MPREnew', name: 'New', artists: [] }],
      artists: [{ key: 'yt:ar:UCx', name: 'X', cover: '' }],
      videos: []
    }
  ],
  getAudioStream: async () => {
    throw new Error('offline');
  },
  invalidateStream: () => {},
  likeVideo: async () => {},
  addToPlaylist: async () => {},
  removeFromPlaylist: async () => {}
}));

vi.mock('../src/main/wave/lyrics', () => ({ getLyrics: async () => '[00:01.00]hello' }));

let server: Server;
let base = '';

const get = async (p: string) => (await fetch(`${base}${p}`)).json();
const post = async (p: string, body: unknown) =>
  (
    await fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  ).json();

beforeAll(async () => {
  const { resetPersistForTests } = await import('../src/main/wave/persist');
  resetPersistForTests();
  const { startWaveApi } = await import('../src/main/wave');
  const port = 30000 + Math.floor(Math.random() * 20000);
  server = await startWaveApi({
    port,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wave-srv-'))
  });
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => server?.close());

describe('wave api server', () => {
  it('searches songs in the NetEase shape', async () => {
    const res = await get('/cloudsearch?keywords=yellow&type=1&limit=30');
    expect(res.code).toBe(200);
    expect(res.result.songs[0]).toMatchObject({ name: 'Yellow', ar: [{ name: 'Coldplay' }] });
    expect(Number.isSafeInteger(res.result.songs[0].id)).toBe(true);
  });

  it('returns a local stream url and song details by numeric id', async () => {
    const search = await get('/cloudsearch?keywords=hello&type=1');
    const id = search.result.songs[0].id;
    const url = await get(`/song/url/v1?id=${id}&level=higher`);
    expect(url.data[0].url).toBe(`${base}/wave/stream/${id}`);
    const detail = await get(`/song/detail?ids=${id}`);
    expect(detail.songs[0].name).toBe('Hello');
    const lyric = await get(`/lyric/new?id=${id}`);
    expect(lyric.lrc.lyric).toContain('hello');
  });

  it('likes songs and exposes them as the first user playlist', async () => {
    const search = await get('/cloudsearch?keywords=clocks&type=1');
    const id = search.result.songs[0].id;
    expect((await get(`/like?id=${id}&like=true`)).code).toBe(200);
    expect((await get('/likelist?uid=1')).ids).toContain(id);
    const lists = await get('/user/playlist?uid=1');
    expect(lists.playlist[0]).toMatchObject({ name: 'Liked Songs', trackCount: 1 });
    const liked = await get(`/playlist/detail?id=${lists.playlist[0].id}`);
    expect(liked.playlist.tracks[0].id).toBe(id);
  });

  it('creates playlists and adds tracks', async () => {
    const created = await post('/playlist/create', { name: 'Road trip', privacy: 0 });
    expect(created.code).toBe(200);
    const search = await get('/cloudsearch?keywords=yellow&type=1');
    const res = await post('/playlist/tracks', {
      op: 'add',
      pid: created.id,
      tracks: String(search.result.songs[0].id)
    });
    expect(res.code).toBe(200);
    const detail = await get(`/playlist/detail?id=${created.id}`);
    expect(detail.playlist.name).toBe('Road trip');
    expect(detail.playlist.tracks.map((t: any) => t.name)).toEqual(['Yellow']);
  });

  it('imports a text playlist and reports task progress', async () => {
    const res = await post('/playlist/import/name/task/create', {
      text: encodeURIComponent('Yellow - Coldplay\nHello - Adele\nUnknown Song - Nobody'),
      playlistName: 'Imported'
    });
    expect(res.code).toBe(200);
    let task: any;
    for (let i = 0; i < 50; i++) {
      task = (await get(`/playlist/import/task/status?id=${res.data.taskId}`)).data.tasks[0];
      if (task.status === 'COMPLETE' || task.status === 'FAILED') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(task.status).toBe('COMPLETE');
    expect(task.succCount).toBe(2);
    const lists = await get('/user/playlist?uid=1');
    const imported = lists.playlist.find((p: any) => p.name === 'Imported');
    expect(imported.trackCount).toBe(2);
  });

  it('serves home feeds', async () => {
    expect((await get('/personalized?limit=10')).result[0].name).toBe('Mix');
    expect((await get('/toplist')).list[0].name).toBe('Top 100');
    expect((await get('/top/artists?limit=5')).artists[0].name).toBe('X');
    expect((await get('/recommend/songs')).data.dailySongs).toHaveLength(3);
    expect((await get('/search/hot/detail')).data[0].searchWord).toBe('Yellow');
    expect((await get('/top/album?limit=5')).weekData[0].name).toBe('New');
  });

  it('answers unknown endpoints with an empty payload', async () => {
    expect(await get('/some/unknown/endpoint')).toMatchObject({ code: 200, data: [] });
  });

  it('fails stream requests cleanly when no source is reachable', async () => {
    const search = await get('/cloudsearch?keywords=yellow&type=1');
    const res = await fetch(`${base}/wave/stream/${search.result.songs[0].id}`);
    expect(res.status).toBe(502);
  });
});
