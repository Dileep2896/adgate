import type { CommercialRuleSet } from '../../types.js';

/** Streaming: video and music services, devices. "max", "prime", "show", "stream" alone are omitted. */
export const ENTERTAINMENT_STREAMING: CommercialRuleSet = {
  category: 'entertainment.streaming',
  products: [
    'streaming service', 'streaming services', 'streaming platform', 'streaming platforms',
    'netflix', 'hulu', 'disney plus', 'disney', 'hbo max', 'apple tv plus', 'apple tv',
    'paramount plus', 'peacock', 'prime video', 'amazon prime video', 'amazon prime',
    'crunchyroll', 'funimation', 'mubi', 'criterion channel', 'curiositystream',
    'curiosity stream', 'youtube premium', 'youtube tv', 'sling tv', 'fubo', 'fubotv', 'philo',
    'spotify', 'apple music', 'deezer', 'youtube music', 'audible subscription',
    'kindle unlimited', 'spotify premium', 'streaming subscription', 'streaming subscriptions',
    'cable alternative', 'cord cutting', 'cut the cord', 'live tv streaming',
    'sports streaming', 'anime streaming', 'music streaming', 'podcast app',
    'audiobook subscription', 'streaming device', 'roku', 'fire stick', 'fire tv', 'chromecast',
    'apple tv 4k', 'nvidia shield', 'plex pass', 'plex', 'twitch',
  ],
  topics: [
    'streaming', 'binge', 'binge watch', 'watch', 'watching', 'tv show', 'tv shows', 'tv series',
    'movie', 'movies', 'film', 'films', 'documentary', 'documentaries', 'anime', 'drama',
    'dramas', 'sitcom', 'sitcoms', 'k drama', 'subtitles', 'what to watch', 'worth watching',
    'podcast', 'podcasts', 'music', 'playlist', 'playlists', 'album', 'albums', 'audiobook',
    'audiobooks', '4k streaming', 'hdr', 'dolby', 'live sports', 'nfl', 'premier league', 'f1',
    'ufc', 'ppv', 'pay per view', 'episode', 'episodes', 'jellyfin',
  ],
  patterns: [
    String.raw`\b(streaming|tv|music|anime|sports|movie|video) (service|services|platform|platforms|subscription|subscriptions|app|apps|provider|providers)\b`,
  ],
};
