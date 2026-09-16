import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plot } from './Plot.jsx';

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn(), Plots: { resize: vi.fn() } }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('Plot lifecycle', () => {
  it('waits for an in-flight render before purging or rendering new props', async () => {
    let finish;
    const first = new Promise((resolve) => { finish = resolve; });
    plotly.react.mockReturnValueOnce(first).mockResolvedValue(undefined);
    const view = render(<Plot traces={[{ x: [1], y: [2] }]} />);
    await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(1));
    view.rerender(<Plot traces={[{ x: [1], y: [3] }]} />);
    expect(plotly.purge).not.toHaveBeenCalled();
    expect(plotly.react).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(2));
    expect(plotly.purge).toHaveBeenCalledTimes(1);
    expect(plotly.purge.mock.invocationCallOrder[0]).toBeLessThan(plotly.react.mock.invocationCallOrder[1]);
    view.unmount();
    await waitFor(() => expect(plotly.purge).toHaveBeenCalledTimes(2));
  });

  it('does not resize an unmounted chart when a pending render completes', async () => {
    let finish;
    plotly.react.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = render(<Plot traces={[{ x: [1], y: [2] }]} />);
    await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(plotly.purge).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(plotly.purge).toHaveBeenCalledTimes(1));
    expect(plotly.Plots.resize).not.toHaveBeenCalled();
  });
});
