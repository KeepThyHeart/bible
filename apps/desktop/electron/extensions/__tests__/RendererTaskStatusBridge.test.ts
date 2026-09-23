/**
 * Production `RendererTaskStatusBridge` unit tests.
 *
 * Drives the bridge with a fake `IExtensionUiBridge` (just the one method it
 * calls: `registerStatusBarItem`) so we can assert the task-snapshot ->
 * status-bar-item translation and the replace/cleanup behavior without a real
 * IPC round trip.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Extensions } from '@bible/core';

import { RendererTaskStatusBridge } from '../bridges/RendererTaskStatusBridge';
import type { IExtensionUiBridge } from '../api-impl/IExtensionDataBridges';

type BackgroundTaskInfo = Extensions.BackgroundTaskInfo;
type StatusBarItemDescriptor = Extensions.StatusBarItemDescriptor;

function makeFakeUiBridge() {
  const registrations: { extensionId: string; item: StatusBarItemDescriptor }[] = [];
  const disposed: string[] = []; // item ids
  const uiBridge = {
    registerStatusBarItem: vi.fn((extensionId: string, item: StatusBarItemDescriptor) => {
      registrations.push({ extensionId, item });
      return () => disposed.push(item.id);
    }),
  } as unknown as IExtensionUiBridge;
  return { uiBridge, registrations, disposed };
}

function task(overrides: Partial<BackgroundTaskInfo> = {}): BackgroundTaskInfo {
  return {
    id: 'ext.demo.reindex',
    title: 'Rebuilding search index',
    startedAt: 0,
    state: 'running',
    ...overrides,
  };
}

describe('RendererTaskStatusBridge', () => {
  it('registers a status bar item namespaced under __task. for a running task', () => {
    const { uiBridge, registrations } = makeFakeUiBridge();
    const bridge = new RendererTaskStatusBridge(uiBridge);

    bridge.onTaskUpdate('ext.demo', [task()]);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.extensionId).toBe('ext.demo');
    expect(registrations[0]!.item.id).toBe('__task.ext.demo.reindex');
    expect(registrations[0]!.item.text).toBe('Rebuilding search index');
  });

  it('composes title, percent, and message into the display text', () => {
    const { uiBridge, registrations } = makeFakeUiBridge();
    const bridge = new RendererTaskStatusBridge(uiBridge);

    bridge.onTaskUpdate('ext.demo', [
      task({ progress: { current: 40, total: 100, message: 'scanning modules' } }),
    ]);

    expect(registrations[0]!.item.text).toBe(
      'Rebuilding search index — 40% — scanning modules',
    );
  });

  it('degrades to progress-only text when the title is a catalog-key LocalizedString', () => {
    const { uiBridge, registrations } = makeFakeUiBridge();
    const bridge = new RendererTaskStatusBridge(uiBridge);

    bridge.onTaskUpdate('ext.demo', [
      task({ title: { key: 'demo.reindex.title' }, progress: { current: 1, total: 2 } }),
    ]);

    expect(registrations[0]!.item.text).toBe('50%');
  });

  it('re-registering the same task id refreshes rather than duplicating', () => {
    const { uiBridge, registrations } = makeFakeUiBridge();
    const bridge = new RendererTaskStatusBridge(uiBridge);

    bridge.onTaskUpdate('ext.demo', [task({ progress: { current: 10, total: 100 } })]);
    bridge.onTaskUpdate('ext.demo', [task({ progress: { current: 20, total: 100 } })]);

    expect(registrations).toHaveLength(2); // the bridge call count - not a leak assertion
    expect(uiBridge.registerStatusBarItem).toHaveBeenCalledTimes(2);
    expect(registrations[1]!.item.text).toContain('20%');
  });

  it('disposes the status bar item once a task drops out of the snapshot (settled)', () => {
    const { uiBridge, disposed } = makeFakeUiBridge();
    const bridge = new RendererTaskStatusBridge(uiBridge);

    bridge.onTaskUpdate('ext.demo', [task()]);
    expect(disposed).toEqual([]);

    bridge.onTaskUpdate('ext.demo', []); // task settled and was removed from the api-impl's registry
    expect(disposed).toEqual(['__task.ext.demo.reindex']);
  });

  it('does not touch another extension\'s tasks when one settles', () => {
    const { uiBridge, disposed } = makeFakeUiBridge();
    const bridge = new RendererTaskStatusBridge(uiBridge);

    bridge.onTaskUpdate('ext.a', [task({ id: 'ext.a.job' })]);
    bridge.onTaskUpdate('ext.b', [task({ id: 'ext.b.job' })]);

    bridge.onTaskUpdate('ext.a', []); // only ext.a's task settled

    expect(disposed).toEqual(['__task.ext.a.job']);
  });

  it('clearTasksForExtension disposes every tracked item for that extension only', () => {
    const { uiBridge, disposed } = makeFakeUiBridge();
    const bridge = new RendererTaskStatusBridge(uiBridge);

    bridge.onTaskUpdate('ext.a', [task({ id: 'ext.a.one' }), task({ id: 'ext.a.two' })]);
    bridge.onTaskUpdate('ext.b', [task({ id: 'ext.b.job' })]);

    bridge.clearTasksForExtension('ext.a');

    expect(disposed.sort()).toEqual(['__task.ext.a.one', '__task.ext.a.two']);
  });
});
