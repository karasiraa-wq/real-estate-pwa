import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// jsdom does not implement object URLs, used for photo thumbnails.
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock-preview')
  URL.revokeObjectURL = vi.fn()
}
