import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { PdfPageText } from './PdfPageText.jsx';
import * as api from '../data/researchQaApi.js';
vi.mock('../data/researchQaApi.js', () => ({ readContextDocumentPage: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const first = { text: 'First 🔬', end: 8, totalCharacters: 14, nextCursor: '8', status: 'needs_review', warnings: ['ocr_check_original'] };

test('long page text continues without losing symbols and read failure is retryable', async () => {
  api.readContextDocumentPage.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ ...first, text: '中文 ZnO', end: 14, nextCursor: null });
  render(<PdfPageText projectId="p" versionId="old-v1" page={2} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Show page text' }));
  expect(screen.getByText('First 🔬')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Load more page text' }));
  await screen.findByText(/Connection lost/);
  expect(screen.getByText('First 🔬')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry text' }));
  await screen.findByText('First 🔬中文 ZnO');
  expect(screen.queryByRole('button', { name: 'Load more page text' })).toBeNull();
  expect(api.readContextDocumentPage.mock.calls[2].slice(0, 4)).toEqual(['p', 'old-v1', 2, { cursor: '8' }]);
});

test('StrictMode cleanup and a page change reject stale text and quality status', async () => {
  const pending = [];
  api.readContextDocumentPage.mockImplementation((_p, _v, page, _q, { signal }) => new Promise((resolve) => pending.push({ resolve, signal, page })));
  const view = render(<StrictMode><PdfPageText key="1" projectId="p" versionId="v1" page={1} /></StrictMode>);
  expect(pending).toHaveLength(2); expect(pending[0].signal.aborted).toBe(true);
  view.rerender(<StrictMode><PdfPageText key="2" projectId="p" versionId="v1" page={2} /></StrictMode>);
  await act(async () => { for (const entry of pending) entry.resolve(entry.page === 1 ? first
    : { text: '', end: 0, totalCharacters: 0, nextCursor: null, status: 'empty', warnings: [] }); });
  await screen.findByText('Blank page');
  expect(screen.queryByText('Check recognition against the original')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show page text' })).toBeNull();
});
