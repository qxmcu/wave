import { rememberTrack, toId } from './ids';
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
 * Converters from Wave models to the response shapes the renderer consumes.
 * Field names follow the NetEase Cloud Music API the UI was written against.
 */

export const WAVE_USER_KEY = 'wave:user:me';
export const LIKED_PLAYLIST_KEY = 'wave:pl:liked';

export const userId = () => toId(WAVE_USER_KEY);

/** YouTube/Google thumbnails come tiny by default; ask for a square 544px image. */
export function bigCover(url?: string): string {
  if (!url) return '';
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
    return url.replace(/=w\d+-h\d+[^?]*$/, '=w544-h544-l90-rj').replace(/=s\d+[^?]*$/, '=s544');
  }
  if (url.includes('i.ytimg.com')) {
    return url.replace(/\/(default|mqdefault|hqdefault|sddefault)\.jpg/, '/hqdefault.jpg');
  }
  if (url.includes('mzstatic.com')) {
    return url.replace(/\{w\}x\{h\}(bb)?/, '600x600bb').replace(/\d+x\d+bb/, '600x600bb');
  }
  return url;
}

/**
 * Artists/albums from services we cannot browse (Apple, Amazon, text imports)
 * get a `q:` key; opening one searches YouTube Music by name instead.
 */
export const artistKey = (artist: WaveArtist) =>
  artist.key && /^(yt|sp):ar:/.test(artist.key)
    ? artist.key
    : artist.name
      ? `q:ar:${artist.name}`
      : '';

export const albumKey = (album: { key?: string; name: string }, artist?: string) =>
  album.key && /^(yt|sp):al:/.test(album.key)
    ? album.key
    : album.name
      ? `q:al:${album.name}::${artist || ''}`
      : '';

export const artistRef = (artist: WaveArtist) => ({
  id: artistKey(artist) ? toId(artistKey(artist)) : 0,
  name: artist.name,
  tns: [],
  alias: [],
  picUrl: '',
  img1v1Url: ''
});

export function songShape(track: WaveTrack) {
  const id = rememberTrack(track);
  const cover = bigCover(track.cover || track.album?.cover);
  const ar = track.artists.length ? track.artists.map(artistRef) : [artistRef({ name: '' })];
  const albumRefKey = track.album ? albumKey(track.album, track.artists[0]?.name) : '';
  const al = {
    id: albumRefKey ? toId(albumRefKey) : 0,
    name: track.album?.name || '',
    picUrl: cover,
    pic_str: '',
    tns: []
  };
  const duration = track.duration || 0;
  return {
    id,
    name: track.title,
    picUrl: cover,
    ar,
    artists: ar,
    al,
    album: al,
    dt: duration,
    duration,
    fee: 0,
    pop: 100,
    mv: track.isVideo && track.videoId ? toId(`yt:mv:${track.videoId}`) : 0,
    mvid: 0,
    alia: [],
    tns: [],
    copyright: 0,
    st: 0,
    noCopyrightRcmd: null,
    privilege: privilegeShape(id),
    source: 'wave',
    waveKey: track.key
  };
}

export function privilegeShape(id: number) {
  return {
    id,
    fee: 0,
    payed: 0,
    st: 0,
    pl: 999000,
    dl: 999000,
    sp: 7,
    cp: 1,
    subp: 1,
    cs: false,
    maxbr: 999000,
    fl: 999000,
    toast: false,
    flag: 0,
    playMaxbr: 999000,
    downloadMaxbr: 999000,
    chargeInfoList: null
  };
}

export function creatorShape(name?: string, owned?: boolean) {
  return {
    userId: owned ? userId() : toId(`wave:user:${name || 'unknown'}`),
    nickname: name || '',
    avatarUrl: '',
    signature: '',
    userType: 0,
    vipType: 0
  };
}

export function playlistSummaryShape(playlist: WavePlaylist) {
  const id = toId(playlist.key);
  const cover = bigCover(playlist.cover || playlist.tracks?.[0]?.cover);
  return {
    id,
    name: playlist.name,
    coverImgUrl: cover,
    picUrl: cover,
    description: playlist.description || '',
    copywriter: playlist.description || '',
    trackCount: playlist.trackCount ?? playlist.tracks?.length ?? 0,
    playCount: 0,
    playcount: 0,
    subscribed: !playlist.owned,
    subscribedCount: 0,
    specialType: playlist.key === LIKED_PLAYLIST_KEY ? 5 : 0,
    creator: creatorShape(playlist.ownerName, playlist.owned),
    userId: playlist.owned ? userId() : 0,
    tags: [],
    privacy: 0,
    updateTime: Date.now(),
    createTime: Date.now(),
    highQuality: false,
    alg: playlist.service,
    waveKey: playlist.key
  };
}

export function playlistDetailShape(playlist: WavePlaylist) {
  const tracks = (playlist.tracks || []).map(songShape);
  return {
    code: 200,
    playlist: {
      ...playlistSummaryShape(playlist),
      trackCount: tracks.length || playlist.trackCount || 0,
      tracks,
      trackIds: tracks.map((t) => ({ id: t.id, v: 0, t: 0, at: 0, alg: null })),
      commentCount: 0,
      shareCount: 0,
      subscribers: []
    },
    privileges: tracks.map((t) => t.privilege)
  };
}

export function albumShape(album: WaveAlbum) {
  const cover = bigCover(album.cover);
  const artists = album.artists.map(artistRef);
  const publishTime = album.year ? new Date(`${album.year}-01-01T00:00:00Z`).getTime() : 0;
  return {
    id: toId(album.key),
    name: album.name,
    picUrl: cover,
    blurPicUrl: cover,
    coverImgUrl: cover,
    artist: artists[0] || artistRef({ name: '' }),
    artists,
    size: album.trackCount ?? album.tracks?.length ?? 0,
    publishTime,
    description: album.description || '',
    briefDesc: album.description || '',
    company: '',
    type: 'Album',
    subType: '',
    alias: [],
    waveKey: album.key
  };
}

export function albumDetailShape(album: WaveAlbum) {
  const cover = bigCover(album.cover);
  const songs = (album.tracks || []).map((t) =>
    songShape({
      ...t,
      cover: t.cover || cover,
      album: t.album || { key: album.key, name: album.name, cover }
    })
  );
  return {
    code: 200,
    resourceState: true,
    album: { ...albumShape(album), size: songs.length },
    songs
  };
}

export function artistShape(artist: { key: string; name: string; cover?: string }) {
  const cover = bigCover(artist.cover);
  return {
    id: toId(artist.key),
    name: artist.name,
    picUrl: cover,
    img1v1Url: cover,
    cover,
    avatar: cover,
    alias: [],
    albumSize: 0,
    musicSize: 0,
    mvSize: 0,
    briefDesc: '',
    followed: false,
    waveKey: artist.key
  };
}

export function artistDetailShape(detail: WaveArtistDetail) {
  const base = artistShape(detail);
  return {
    code: 200,
    data: {
      videoCount: 0,
      artist: {
        ...base,
        briefDesc: detail.description || '',
        musicSize: detail.topTracks.length,
        albumSize: detail.albums.length
      },
      user: null
    }
  };
}

export function mvShape(video: WaveVideo) {
  const cover = bigCover(video.cover);
  return {
    id: toId(video.key),
    name: video.title,
    cover,
    imgurl: cover,
    imgurl16v9: cover,
    picUrl: cover,
    artistName: video.artistName,
    artistId: 0,
    artists: [{ id: 0, name: video.artistName }],
    duration: video.duration || 0,
    playCount: video.views || 0,
    briefDesc: '',
    desc: '',
    publishTime: '',
    waveKey: video.key
  };
}

export function profileShape(accounts: AccountProfile[]) {
  const primary = accounts[0];
  const nickname = primary?.name || 'Wave';
  return {
    userId: userId(),
    nickname,
    avatarUrl: primary?.avatar || '',
    backgroundUrl: '',
    signature: accounts.map((a) => serviceLabel(a.service)).join(' · '),
    vipType: 0,
    userType: 0,
    accountStatus: 0,
    authStatus: 0,
    gender: 0,
    birthday: 0,
    city: 0,
    province: 0,
    follows: 0,
    followeds: 0,
    eventCount: 0,
    playlistCount: 0,
    createTime: Date.now(),
    waveAccounts: accounts
  };
}

export function serviceLabel(service: string) {
  switch (service) {
    case 'yt':
      return 'YouTube Music';
    case 'sp':
      return 'Spotify';
    case 'am':
      return 'Apple Music';
    case 'amz':
      return 'Amazon Music';
    default:
      return 'Wave';
  }
}
