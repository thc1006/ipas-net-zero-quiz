// useAccessibility test — settings persistence + theme attribute
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAccessibility } from './useAccessibility';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('useAccessibility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('default settings include darkMode and fontSize', () => {
    const { result } = renderHook(() => useAccessibility());
    expect(result.current.settings).toHaveProperty('darkMode');
    expect(result.current.settings).toHaveProperty('fontSize');
    expect(result.current.settings).toHaveProperty('cvdMode');
    expect(result.current.settings).toHaveProperty('highContrast');
  });

  it('toggleDarkMode flips darkMode', () => {
    const { result } = renderHook(() => useAccessibility());
    const before = result.current.settings.darkMode;
    act(() => result.current.toggleDarkMode());
    expect(result.current.settings.darkMode).toBe(!before);
  });

  it('toggleHighContrast flips highContrast', () => {
    const { result } = renderHook(() => useAccessibility());
    const before = result.current.settings.highContrast;
    act(() => result.current.toggleHighContrast());
    expect(result.current.settings.highContrast).toBe(!before);
  });

  it('setFontSize updates fontSize', () => {
    const { result } = renderHook(() => useAccessibility());
    act(() => result.current.setFontSize('large'));
    expect(result.current.settings.fontSize).toBe('large');
  });

  it('setCvdMode updates cvdMode', () => {
    const { result } = renderHook(() => useAccessibility());
    act(() => result.current.setCvdMode('protanopia'));
    expect(result.current.settings.cvdMode).toBe('protanopia');
  });

  it('updates data-theme attribute on documentElement when darkMode changes', () => {
    const { result } = renderHook(() => useAccessibility());
    act(() => {
      // explicitly enable dark mode
      if (!result.current.settings.darkMode) result.current.toggleDarkMode();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resetToDefault restores defaults', () => {
    const { result } = renderHook(() => useAccessibility());
    act(() => {
      result.current.setFontSize('xlarge');
      result.current.setCvdMode('deuteranopia');
    });
    act(() => result.current.resetToDefault());
    expect(['normal']).toContain(result.current.settings.fontSize);
    expect(result.current.settings.cvdMode).toBe('none');
  });
});
