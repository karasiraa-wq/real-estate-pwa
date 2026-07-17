import { YOUTUBE_URL } from './validation.js'

/** The 11-character YouTube video id, or null if the URL is not a YouTube link. */
export function youtubeId(url) {
  const m = typeof url === 'string' ? url.match(YOUTUBE_URL) : null
  return m ? m[1] : null
}

/** Thumbnail served by YouTube — lets the detail page show a poster without
 * loading the ~500KB iframe player until the user taps play (3G budget). */
export function youtubeThumbnail(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

export function youtubeEmbedUrl(id) {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1`
}
