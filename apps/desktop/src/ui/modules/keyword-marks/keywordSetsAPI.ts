/**
 * Renderer side of keyword-set persistence (task 0065). The sets live in the user database
 * (`electron/modules/keyword-marks`, channels `module:keyword-marks:*`); this adapter lets core's
 * `KeywordSetService` treat that module as its `IKeywordSetStore`.
 */
import type { IKeywordSetStore, KeywordSet } from '@bible/core/browser';
import { createModuleClient } from '../../services/moduleClient';
import type { ModuleClient } from '../../services/moduleClient';
import type { KeywordMarksApi } from '../../../../electron/modules/keyword-marks/types';

type KeywordBridge = ModuleClient<KeywordMarksApi>;

const client = createModuleClient<KeywordMarksApi>('keyword-marks');
const defaultBridge = (): KeywordBridge => client;

export class IpcKeywordSetStore implements IKeywordSetStore {
  constructor(private readonly bridge: () => KeywordBridge = defaultBridge) {}

  list(): Promise<KeywordSet[]> {
    return this.bridge().list();
  }

  async put(set: KeywordSet): Promise<void> {
    await this.bridge().put(set);
  }

  async remove(id: string): Promise<void> {
    await this.bridge().remove(id);
  }
}

export const keywordSetsAPI = new IpcKeywordSetStore();
