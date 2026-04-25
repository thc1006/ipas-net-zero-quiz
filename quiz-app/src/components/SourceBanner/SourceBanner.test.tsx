// SourceBanner 測試
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SourceBanner } from './SourceBanner';

afterEach(cleanup);

describe('SourceBanner', () => {
  it('external_mock — 顯示「模擬題」標籤 + 出處 hint', () => {
    render(<SourceBanner sourceType="external_mock" />);
    const banner = screen.getByTestId('source-banner');
    expect(banner.className).toMatch(/source-banner--mock/);
    expect(banner.textContent).toContain('模擬題');
    expect(banner.textContent).toMatch(/vocus|HackMD|yamol/);
  });

  it('ai_generated — 顯示「AI 產題」標籤 + 驗證提醒', () => {
    render(<SourceBanner sourceType="ai_generated" />);
    const banner = screen.getByTestId('source-banner');
    expect(banner.className).toMatch(/source-banner--ai/);
    expect(banner.textContent).toContain('AI 產題');
    expect(banner.textContent).toMatch(/cross-check|驗證|官方教材/);
  });

  it('quality_flag = time_sensitive — 顯示時效警告 + flagged 樣式', () => {
    render(
      <SourceBanner sourceType="ai_generated" qualityFlags={['time_sensitive']} />,
    );
    const banner = screen.getByTestId('source-banner');
    expect(banner.className).toMatch(/source-banner--flagged/);
    expect(banner.textContent).toMatch(/時效性|RE100|官方資料/);
  });

  it('quality_flag = ambiguous — 顯示爭議警告', () => {
    render(<SourceBanner sourceType="ai_generated" qualityFlags={['ambiguous']} />);
    const banner = screen.getByTestId('source-banner');
    expect(banner.textContent).toMatch(/爭議|多方來源/);
  });

  it('sourceCount > 0 — 文案附上「N 條 primary-source URL」', () => {
    render(<SourceBanner sourceType="ai_generated" sourceCount={3} />);
    const banner = screen.getByTestId('source-banner');
    expect(banner.textContent).toMatch(/3 條 primary-source/);
  });

  it('sourceCount = 0 不顯示 URL 文案', () => {
    render(<SourceBanner sourceType="ai_generated" />);
    const banner = screen.getByTestId('source-banner');
    expect(banner.textContent).not.toMatch(/primary-source URL/);
  });

  it('a11y: role="note" + aria-label 描述題目來源', () => {
    render(<SourceBanner sourceType="external_mock" />);
    const banner = screen.getByRole('note');
    expect(banner.getAttribute('aria-label')).toMatch(/模擬題/);
  });

  it('multiple quality flags 全部顯示', () => {
    render(
      <SourceBanner
        sourceType="ai_generated"
        qualityFlags={['time_sensitive', 'low_confidence']}
      />,
    );
    const flags = screen.getByTestId('source-banner').querySelectorAll('.source-banner__flag');
    expect(flags.length).toBe(2);
  });
});
