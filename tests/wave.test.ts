import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseApplePage } from '../src/main/wave/apple';
import { parseJsonLd, parseTextList } from '../src/main/wave/genericImport';
import { parseIsoDuration } from '../src/main/wave/http';
import { fromId, getTrack, hashKey, rememberTrack, toId } from '../src/main/wave/ids';
import { detectService } from '../src/main/wave/importer';
import { normalize, pickBest, scoreCandidate } from '../src/main/wave/matcher';
import { resetPersistForTests, setDataDir } from '../src/main/wave/persist';
import { bigCover, playlistDetailShape, songShape } from '../src/main/wave/shapes';
import { parseEmbedHtml } from '../src/main/wave/spotify';
import type { WaveTrack } from '../src/main/wave/types';

beforeAll(() => {
  resetPersistForTests();
  setDataDir(fs.mkdtempSync(path.join(os.tmpdir(), 'wave-test-')));
});

describe('ids', () => {
  it('maps keys to stable positive safe integers and back', () => {
    const id = toId('yt:v:dQw4w9WgXcQ');
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(0);
    expect(id).toBe(hashKey('yt:v:dQw4w9WgXcQ'));
    expect(fromId(id)).toBe('yt:v:dQw4w9WgXcQ');
    expect(fromId(String(id))).toBe('yt:v:dQw4w9WgXcQ');
    expect(toId('yt:v:dQw4w9WgXcR')).not.toBe(id);
  });

  it('does not collide across many keys', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50000; i++) seen.add(hashKey(`sp:t:${i.toString(36)}xyz`));
    expect(seen.size).toBe(50000);
  });

  it('remembers track metadata and merges video ids', () => {
    const id = rememberTrack({
      key: 'sp:t:abc',
      title: 'Song',
      artists: [{ name: 'A' }],
      isrc: 'X1'
    });
    rememberTrack({
      key: 'sp:t:abc',
      title: 'Song',
      artists: [{ name: 'A' }],
      videoId: 'aaaaaaaaaaa'
    });
    expect(getTrack(id)).toMatchObject({ isrc: 'X1', videoId: 'aaaaaaaaaaa' });
  });
});

describe('shapes', () => {
  const track: WaveTrack = {
    key: 'yt:v:abcdefghijk',
    videoId: 'abcdefghijk',
    title: 'Blinding Lights',
    artists: [{ name: 'The Weeknd', key: 'yt:ar:UC123' }],
    album: { name: 'After Hours', key: 'yt:al:MPREb_1' },
    cover: 'https://lh3.googleusercontent.com/x=w60-h60-l90-rj',
    duration: 200000
  };

  it('produces NetEase-compatible song objects', () => {
    const s = songShape(track);
    expect(s.id).toBe(toId(track.key));
    expect(s.ar[0]).toMatchObject({ id: toId('yt:ar:UC123'), name: 'The Weeknd' });
    expect(s.al).toMatchObject({ id: toId('yt:al:MPREb_1'), name: 'After Hours' });
    expect(s.al.picUrl).toBe('https://lh3.googleusercontent.com/x=w544-h544-l90-rj');
    expect(s.dt).toBe(200000);
  });

  it('gives name-only artists a searchable key', () => {
    const s = songShape({
      ...track,
      key: 'am:t:1',
      artists: [{ name: 'Adele' }],
      album: { name: '25' }
    });
    expect(fromId(s.ar[0].id)).toBe('q:ar:Adele');
    expect(fromId(s.al.id)).toBe('q:al:25::Adele');
  });

  it('builds playlist details with tracks and trackIds', () => {
    const detail = playlistDetailShape({
      key: 'wave:pl:1',
      name: 'Mine',
      tracks: [track],
      owned: true,
      service: 'wave'
    });
    expect(detail.playlist.tracks).toHaveLength(1);
    expect(detail.playlist.trackIds[0].id).toBe(toId(track.key));
    expect(detail.playlist.trackCount).toBe(1);
  });

  it('upsizes artwork urls', () => {
    expect(bigCover('https://i.ytimg.com/vi/x/default.jpg')).toBe(
      'https://i.ytimg.com/vi/x/hqdefault.jpg'
    );
    expect(bigCover('https://is1-ssl.mzstatic.com/image/a/100x100bb.jpg')).toBe(
      'https://is1-ssl.mzstatic.com/image/a/600x600bb.jpg'
    );
  });
});

describe('matcher', () => {
  const wanted = { title: 'Levitating (feat. DaBaby)', artists: ['Dua Lipa'], duration: 203000 };
  const candidates: WaveTrack[] = [
    {
      key: 'yt:v:1',
      videoId: '11111111111',
      title: 'Levitating (Live)',
      artists: [{ name: 'Dua Lipa' }],
      duration: 230000
    },
    {
      key: 'yt:v:2',
      videoId: '22222222222',
      title: 'Levitating',
      artists: [{ name: 'Dua Lipa' }],
      duration: 203500
    },
    {
      key: 'yt:v:3',
      videoId: '33333333333',
      title: 'Levitating',
      artists: [{ name: 'Karaoke Stars' }],
      duration: 199000
    }
  ];

  it('normalises titles', () => {
    expect(normalize('Levitating (feat. DaBaby) - 2021 Remaster')).toBe('levitating');
    expect(normalize('Café del Mar')).toBe('cafe del mar');
  });

  it('prefers the original recording', () => {
    expect(pickBest(wanted, candidates)?.videoId).toBe('22222222222');
    expect(scoreCandidate(wanted, candidates[1])).toBeGreaterThan(
      scoreCandidate(wanted, candidates[0])
    );
  });

  it('rejects unrelated results', () => {
    expect(pickBest({ title: 'Totally Different', artists: ['Nobody'] }, candidates)).toBeNull();
  });
});

describe('importers', () => {
  it('detects services from links', () => {
    expect(detectService('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe('sp');
    expect(detectService('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe('sp');
    expect(detectService('https://music.youtube.com/playlist?list=PL123')).toBe('yt');
    expect(detectService('https://youtu.be/dQw4w9WgXcQ')).toBe('yt');
    expect(detectService('https://music.apple.com/us/playlist/x/pl.123')).toBe('am');
    expect(detectService('https://music.amazon.com/playlists/B0123')).toBe('amz');
    expect(detectService('https://www.deezer.com/playlist/1')).toBe('web');
    expect(detectService('Song - Artist')).toBeNull();
  });

  it('parses text lists', () => {
    expect(parseTextList('1. Yellow - Coldplay\nHello – Adele\nClocks')).toEqual([
      { title: 'Yellow', artists: ['Coldplay'] },
      { title: 'Hello', artists: ['Adele'] },
      { title: 'Clocks', artists: [] }
    ]);
  });

  it('parses CSV exports (Exportify / TuneMyMusic style)', () => {
    const csv = [
      'Track URI,Track Name,Artist Name(s),Album Name,Duration (ms),ISRC',
      'spotify:track:1,"Hello, World",Artist A,Album A,180000,USAAA0000001',
      'spotify:track:2,Second,"Artist B, Artist C",Album B,200000,'
    ].join('\n');
    expect(parseTextList(csv)).toEqual([
      {
        title: 'Hello, World',
        artists: ['Artist A'],
        album: 'Album A',
        duration: 180000,
        isrc: 'USAAA0000001'
      },
      {
        title: 'Second',
        artists: ['Artist B', 'Artist C'],
        album: 'Album B',
        duration: 200000,
        isrc: ''
      }
    ]);
  });

  it('parses schema.org playlists (Amazon Music and others)', () => {
    const html = `<html><script type="application/ld+json">${JSON.stringify({
      '@type': 'MusicPlaylist',
      name: 'Road Trip',
      track: [
        {
          '@type': 'MusicRecording',
          name: 'Song One',
          byArtist: { name: 'Band' },
          duration: 'PT3M20S'
        },
        { '@type': 'MusicRecording', name: 'Song Two', byArtist: [{ name: 'X' }, { name: 'Y' }] }
      ]
    })}</script></html>`;
    const list = parseJsonLd(html)!;
    expect(list.name).toBe('Road Trip');
    expect(list.tracks).toEqual([
      { title: 'Song One', artists: ['Band'], album: undefined, duration: 200000, isrc: undefined },
      {
        title: 'Song Two',
        artists: ['X', 'Y'],
        album: undefined,
        duration: undefined,
        isrc: undefined
      }
    ]);
  });

  it('parses Apple Music page data', () => {
    const data = {
      data: [
        {
          sections: [
            {
              items: [
                {
                  title: 'Track A',
                  artistName: 'Artist A',
                  duration: 210000,
                  contentDescriptor: { kind: 'song' }
                },
                { title: 'Track B', artistName: 'Artist B', duration: 190000 }
              ]
            }
          ]
        }
      ]
    };
    const html = `<meta property="og:title" content="Chill Mix on Apple Music"><script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script>`;
    const list = parseApplePage(html);
    expect(list.name).toBe('Chill Mix');
    expect(list.tracks.map((t) => t.title)).toEqual(['Track A', 'Track B']);
  });

  it('parses the Spotify embed page', () => {
    const next = {
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                name: 'Today’s Top Hits',
                coverArt: { sources: [{ url: 'https://i.scdn.co/a', width: 640 }] },
                trackList: [
                  {
                    uri: 'spotify:track:abc',
                    title: 'Song',
                    subtitle: 'Artist 1, Artist 2',
                    duration: 180000
                  }
                ]
              }
            }
          }
        }
      }
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`;
    const list = parseEmbedHtml(html, 'playlist', 'xyz');
    expect(list.name).toBe('Today’s Top Hits');
    expect(list.tracks?.[0]).toMatchObject({ key: 'sp:t:abc', title: 'Song', duration: 180000 });
    expect(list.tracks?.[0].artists.map((a) => a.name)).toEqual(['Artist 1', 'Artist 2']);
  });

  it('parses ISO durations', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723000);
    expect(parseIsoDuration('PT45S')).toBe(45000);
    expect(parseIsoDuration('bad')).toBeUndefined();
  });
});
