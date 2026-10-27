/**
 * Shared types for the Wave music backend.
 *
 * The renderer was built against NetEase-shaped responses with numeric ids.
 * Everything here is service-neutral; `shapes.ts` converts it to the shapes
 * the UI expects and `ids.ts` maps service keys to stable numeric ids.
 */

export type ServiceKey = 'yt' | 'sp' | 'am' | 'amz' | 'wave' | 'ext';

export interface WaveArtist {
  /** Service key, e.g. `yt:ar:UC...` or `sp:ar:...`. Optional when the service gave no id. */
  key?: string;
  name: string;
}

export interface WaveAlbumRef {
  key?: string;
  name: string;
  cover?: string;
}

export interface WaveTrack {
  /** Service key, e.g. `yt:v:<videoId>`, `sp:t:<trackId>`, `ext:t:<hash>` */
  key: string;
  title: string;
  artists: WaveArtist[];
  album?: WaveAlbumRef;
  cover?: string;
  /** Milliseconds */
  duration?: number;
  isrc?: string;
  /** YouTube video id when known (for `yt:v:` keys this is the same id) */
  videoId?: string;
  /** Marks YouTube entries that are music videos rather than audio tracks */
  isVideo?: boolean;
  explicit?: boolean;
}

export interface WavePlaylist {
  key: string;
  name: string;
  cover?: string;
  description?: string;
  ownerName?: string;
  /** True when the signed-in user owns the playlist (shows under "created") */
  owned?: boolean;
  trackCount?: number;
  tracks?: WaveTrack[];
  service: ServiceKey;
}

export interface WaveAlbum {
  key: string;
  name: string;
  cover?: string;
  artists: WaveArtist[];
  year?: string;
  description?: string;
  tracks?: WaveTrack[];
  trackCount?: number;
}

export interface WaveArtistDetail {
  key: string;
  name: string;
  cover?: string;
  description?: string;
  topTracks: WaveTrack[];
  albums: WaveAlbum[];
}

export interface WaveVideo {
  key: string;
  videoId: string;
  title: string;
  artistName: string;
  cover?: string;
  duration?: number;
  views?: number;
}

export interface AccountProfile {
  service: 'yt' | 'sp';
  name: string;
  avatar?: string;
  email?: string;
}

/** Track metadata read from an external service for importing */
export interface ImportedTrack {
  title: string;
  artists: string[];
  album?: string;
  duration?: number;
  isrc?: string;
  cover?: string;
  /** Pre-resolved key when the source already is YouTube */
  key?: string;
}

export interface ImportedList {
  name: string;
  cover?: string;
  description?: string;
  tracks: ImportedTrack[];
}
