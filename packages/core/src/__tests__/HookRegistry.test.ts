import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookRegistry } from '../Plugin/HookRegistry';

// Typed maps for test hooks
interface TestFilters {
  'transform:text': string;
  'transform:number': number;
  'transform:object': { value: number; label: string };
}

interface TestActions {
  'on:save': { id: number; data: string };
  'on:delete': number;
  'on:void': undefined;
}

describe('HookRegistry', () => {
  let registry: HookRegistry<TestFilters, TestActions>;

  beforeEach(() => {
    registry = new HookRegistry<TestFilters, TestActions>();
  });

  // ==========================================================================
  // Filter Hooks
  // ==========================================================================

  describe('addFilter / applyFilters', () => {
    it('should return initial value when no filters registered', async () => {
      const result = await registry.applyFilters('transform:text', 'hello');
      expect(result).toBe('hello');
    });

    it('should apply a single filter', async () => {
      registry.addFilter('transform:text', (val) => val.toUpperCase());
      const result = await registry.applyFilters('transform:text', 'hello');
      expect(result).toBe('HELLO');
    });

    it('should chain multiple filters in waterfall', async () => {
      registry.addFilter('transform:text', (val) => val + ' world');
      registry.addFilter('transform:text', (val) => val.toUpperCase());
      const result = await registry.applyFilters('transform:text', 'hello');
      expect(result).toBe('HELLO WORLD');
    });

    it('should respect priority ordering (lower runs first)', async () => {
      registry.addFilter('transform:text', (val) => val + '-second', 20);
      registry.addFilter('transform:text', (val) => val + '-first', 5);
      registry.addFilter('transform:text', (val) => val + '-third', 30);
      const result = await registry.applyFilters('transform:text', 'start');
      expect(result).toBe('start-first-second-third');
    });

    it('should handle async filter handlers', async () => {
      registry.addFilter('transform:number', async (val) => {
        return val * 2;
      });
      registry.addFilter('transform:number', async (val) => {
        return val + 10;
      });
      const result = await registry.applyFilters('transform:number', 5);
      expect(result).toBe(20); // (5 * 2) + 10
    });

    it('should transform object values', async () => {
      registry.addFilter('transform:object', (obj) => ({
        ...obj,
        value: obj.value * 2,
      }));
      registry.addFilter('transform:object', (obj) => ({
        ...obj,
        label: obj.label.toUpperCase(),
      }));
      const result = await registry.applyFilters('transform:object', { value: 5, label: 'test' });
      expect(result).toEqual({ value: 10, label: 'TEST' });
    });

    it('should unsubscribe a filter via returned function', async () => {
      const unsub = registry.addFilter('transform:text', (val) => val + '!');
      registry.addFilter('transform:text', (val) => val + '?');

      // Before unsubscribe
      let result = await registry.applyFilters('transform:text', 'hi');
      expect(result).toBe('hi!?');

      // After unsubscribe
      unsub();
      result = await registry.applyFilters('transform:text', 'hi');
      expect(result).toBe('hi?');
    });

    it('should clean up map entry when last filter unsubscribes', () => {
      const unsub = registry.addFilter('transform:text', (val) => val);
      expect(registry.hasFilters('transform:text')).toBe(true);
      unsub();
      expect(registry.hasFilters('transform:text')).toBe(false);
    });
  });

  // ==========================================================================
  // Sync Filters
  // ==========================================================================

  describe('applyFiltersSync', () => {
    it('should return initial value when no filters registered', () => {
      const result = registry.applyFiltersSync('transform:number', 42);
      expect(result).toBe(42);
    });

    it('should apply sync filters in order', () => {
      registry.addFilter('transform:number', (val) => val + 1);
      registry.addFilter('transform:number', (val) => val * 3);
      const result = registry.applyFiltersSync('transform:number', 2);
      expect(result).toBe(9); // (2 + 1) * 3
    });

    it('should throw if a handler returns a Promise', () => {
      registry.addFilter('transform:text', async (val) => val.toUpperCase());
      expect(() => registry.applyFiltersSync('transform:text', 'hello')).toThrow(
        /returned a Promise.*use applyFilters\(\)/
      );
    });
  });

  // ==========================================================================
  // Action Hooks
  // ==========================================================================

  describe('addAction / runActions', () => {
    it('should do nothing when no actions registered', async () => {
      // Should not throw
      await registry.runActions('on:save', { id: 1, data: 'test' });
    });

    it('should call action handlers with the value', async () => {
      const handler = vi.fn();
      registry.addAction('on:save', handler);
      await registry.runActions('on:save', { id: 1, data: 'test' });
      expect(handler).toHaveBeenCalledWith({ id: 1, data: 'test' });
    });

    it('should call multiple action handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      registry.addAction('on:delete', handler1);
      registry.addAction('on:delete', handler2);
      await registry.runActions('on:delete', 42);
      expect(handler1).toHaveBeenCalledWith(42);
      expect(handler2).toHaveBeenCalledWith(42);
    });

    it('should respect priority ordering for actions', async () => {
      const order: string[] = [];
      registry.addAction('on:delete', () => { order.push('second'); }, 20);
      registry.addAction('on:delete', () => { order.push('first'); }, 5);
      registry.addAction('on:delete', () => { order.push('third'); }, 30);
      await registry.runActions('on:delete', 1);
      expect(order).toEqual(['first', 'second', 'third']);
    });

    it('should not throw when one action handler fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler1 = vi.fn(async () => { throw new Error('boom'); });
      const handler2 = vi.fn();

      registry.addAction('on:delete', handler1);
      registry.addAction('on:delete', handler2);

      // Should not throw
      await registry.runActions('on:delete', 1);

      // Both handlers were called (Promise.allSettled)
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Action handler error'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('should unsubscribe an action via returned function', async () => {
      const handler = vi.fn();
      const unsub = registry.addAction('on:delete', handler);

      await registry.runActions('on:delete', 1);
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      await registry.runActions('on:delete', 2);
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  // ==========================================================================
  // fireActions (fire-and-forget)
  // ==========================================================================

  describe('fireActions', () => {
    it('should invoke handlers without blocking', async () => {
      const handler = vi.fn();
      registry.addAction('on:save', handler);
      registry.fireActions('on:save', { id: 1, data: 'fire' });

      // Handler runs asynchronously, wait a tick
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalledWith({ id: 1, data: 'fire' });
    });

    it('should do nothing when no handlers registered', () => {
      // Should not throw
      registry.fireActions('on:delete', 99);
    });
  });

  // ==========================================================================
  // Introspection
  // ==========================================================================

  describe('hasFilters / hasActions', () => {
    it('should return false when no handlers registered', () => {
      expect(registry.hasFilters('transform:text')).toBe(false);
      expect(registry.hasActions('on:save')).toBe(false);
    });

    it('should return true when handlers are registered', () => {
      registry.addFilter('transform:text', (v) => v);
      registry.addAction('on:save', () => {});
      expect(registry.hasFilters('transform:text')).toBe(true);
      expect(registry.hasActions('on:save')).toBe(true);
    });
  });

  // ==========================================================================
  // clear()
  // ==========================================================================

  describe('clear', () => {
    it('should remove all filters and actions', async () => {
      registry.addFilter('transform:text', (v) => v + '!');
      registry.addAction('on:save', () => {});

      registry.clear();

      expect(registry.hasFilters('transform:text')).toBe(false);
      expect(registry.hasActions('on:save')).toBe(false);

      // Filters should pass through unchanged
      const result = await registry.applyFilters('transform:text', 'hello');
      expect(result).toBe('hello');
    });
  });
});
