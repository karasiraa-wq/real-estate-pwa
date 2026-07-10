// Client-side photo compression for slow mobile networks: resize to a
// phone-screen-friendly resolution, then step JPEG quality down until the
// file is at or under the target size (~150KB).

const MAX_DIMENSION = 1280
const TARGET_BYTES = 150 * 1024
const QUALITY_STEPS = [0.8, 0.65, 0.5, 0.4, 0.3]

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('compression failed'))),
      'image/jpeg',
      quality,
    )
  })
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }
  // Older Android WebView fallback.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('could not read image'))
    }
    img.src = url
  })
}

/**
 * Compress an image File to a JPEG Blob of roughly TARGET_BYTES.
 * Throws if the file cannot be decoded as an image.
 */
export async function compressImage(file) {
  const image = await decode(file)
  const width = image.width || image.naturalWidth
  const height = image.height || image.naturalHeight
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  // White backdrop so transparent PNGs don't turn black as JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  if (image.close) image.close()

  let blob = null
  for (const quality of QUALITY_STEPS) {
    blob = await canvasToBlob(canvas, quality)
    if (blob.size <= TARGET_BYTES) break
  }
  return blob
}
