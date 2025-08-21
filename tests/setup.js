// 測試環境全域設定檔
import { vi } from 'vitest'

// Mock localStorage
const storage = new Map()

const localStorageMock = {
  getItem: vi.fn((key) => storage.get(key) || null),
  setItem: vi.fn((key, value) => storage.set(key, value)),
  removeItem: vi.fn((key) => storage.delete(key)),
  clear: vi.fn(() => storage.clear()),
  length: 0,
  key: vi.fn(() => null)
}

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true
})

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    href: 'http://localhost:3000',
    origin: 'http://localhost:3000',
    pathname: '/',
    search: '',
    hash: ''
  },
  writable: true
})

// Mock console methods for cleaner test output
global.console = {
  ...console,
  // 保留 log 和 error，但是可以 mock warn
  warn: vi.fn(),
  debug: vi.fn()
}

// 設定測試時區為台北時間
process.env.TZ = 'Asia/Taipei'

// Mock 全域變數
global.__APP_VERSION__ = '1.0.0'
global.__BUILD_TIME__ = new Date().toISOString()

// 在每個測試執行前清理 mocks
beforeEach(() => {
  vi.clearAllMocks()
  storage.clear()
})