import { useState } from 'react'
import { youtubeEmbedUrl, youtubeId, youtubeThumbnail } from '../lib/video.js'

/**
 * Lite YouTube embed: renders only the poster image and a play button; the
 * ~500KB player iframe is created when the user taps play. Videos are hosted
 * on YouTube — RentUg never stores video files.
 */
export default function VideoEmbed({ url, title }) {
  const [playing, setPlaying] = useState(false)
  const id = youtubeId(url)
  if (!id) return null

  if (playing) {
    return (
      <div className="video-embed">
        <iframe
          src={youtubeEmbedUrl(id)}
          title={`Video tour — ${title}`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      className="video-embed video-poster"
      aria-label={`Play video tour of ${title}`}
      onClick={() => setPlaying(true)}
    >
      <img src={youtubeThumbnail(id)} alt="" loading="lazy" />
      <span className="video-play" aria-hidden="true">
        ▶
      </span>
      <span className="video-label">Video tour</span>
    </button>
  )
}
