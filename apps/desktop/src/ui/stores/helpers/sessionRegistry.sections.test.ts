/**
 * Module-owned session sections (task 0127): declared keys are written back as restored when the
 * module (and so its serializer) is absent, and a claimant gets its data whenever it arrives.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  claimRestoredSessionSection,
  declareSessionKeys,
  declaredSessionSections,
  registerSessionSerializer,
  resetSessionSectionsForTests,
  stashRestoredSessionUi,
} from './sessionRegistry';

beforeEach(() => resetSessionSectionsForTests());

describe('module-owned session sections', () => {
  it('writes a declared section back unchanged while nothing serializes it', () => {
    declareSessionKeys(['modOne']);
    stashRestoredSessionUi({ modOne: { a: 1 }, other: { b: 2 } });
    expect(declaredSessionSections()).toEqual({ modOne: { a: 1 } });
  });

  it('omits a declared section that was never saved', () => {
    declareSessionKeys(['modTwo']);
    stashRestoredSessionUi({});
    expect(declaredSessionSections()).toEqual({});
  });

  it('prefers the serializer once the module loaded', () => {
    declareSessionKeys(['modThree']);
    stashRestoredSessionUi({ modThree: { old: true } });
    registerSessionSerializer('modThree', () => ({ fresh: true }));
    expect(declaredSessionSections()).toEqual({ modThree: { fresh: true } });
  });

  it('hands a claimant its data at once when the session was already restored, or when it is', () => {
    const early = vi.fn();
    claimRestoredSessionSection('early', early); // claimed before the restore
    stashRestoredSessionUi({ early: 1, late: 2 });
    expect(early).toHaveBeenCalledWith(1);
    const late = vi.fn();
    claimRestoredSessionSection('late', late); // claimed after the restore
    expect(late).toHaveBeenCalledWith(2);
    const absent = vi.fn();
    claimRestoredSessionSection('absent', absent);
    expect(absent).not.toHaveBeenCalled();
  });
});
