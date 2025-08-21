import { describe, it, expect } from 'vitest'

describe('基本測試環境', () => {
  it('測試環境應該正常運作', () => {
    expect(true).toBe(true)
  })

  it('應該能使用 Vitest 語法', () => {
    const sum = (a, b) => a + b
    expect(sum(2, 3)).toBe(5)
  })

  it('localStorage mock 應該正常運作', () => {
    localStorage.setItem('test', 'value')
    expect(localStorage.getItem('test')).toBe('value')
    
    localStorage.removeItem('test')
    expect(localStorage.getItem('test')).toBe(null)
  })
})