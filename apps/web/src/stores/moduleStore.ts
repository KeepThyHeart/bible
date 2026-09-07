import { Store } from './Store';
import type { IModuleProvider, SemanticIndexInfo } from '../providers/interfaces';
import type { ModuleInfo, BookInfo, ModuleSectionsResponse, ModuleSection } from '../types';
import { getLocalizedBookName } from '../utils/bookNames';

class ModuleStore extends Store {
  private provider: IModuleProvider | null = null;
  availableModules: ModuleInfo[] = [];
  availableBooks: BookInfo[] = [];
  moduleSections: ModuleSectionsResponse | null = null;
  loaded = false;

  init(provider: IModuleProvider): void {
    this.provider = provider;
  }

  async loadManifest(): Promise<void> {
    if (!this.provider || this.loaded) return;

    try {
      const [modules, books, sections] = await Promise.all([
        this.provider.getAvailableModules(),
        this.provider.getBooks(),
        this.provider.getModuleSections(),
      ]);
      this.availableModules = modules;
      this.availableBooks = books;
      this.moduleSections = sections;
      this.loaded = true;
      this.notify();
    } catch (error) {
      console.error('Failed to load module manifest:', error);
    }
  }

  getBibleModules(): ModuleInfo[] {
    return this.availableModules.filter(m => m.type === 'bible');
  }

  getCommentaryModules(): ModuleInfo[] {
    return this.availableModules.filter(m => m.type === 'commentary');
  }

  getBookByNumber(bookNumber: number): BookInfo | undefined {
    return this.availableBooks.find(b => b.book_number === bookNumber);
  }

  getBookName(bookNumber: number): string {
    return this.getBookByNumber(bookNumber)?.book_name ?? getLocalizedBookName(bookNumber);
  }

  async getSemanticIndexInfo(): Promise<SemanticIndexInfo> {
    if (!this.provider) return { available: false };
    return this.provider.getSemanticIndexInfo();
  }

  /** Whether settings.json is configured on the server */
  get sectionsConfigured(): boolean {
    return this.moduleSections?.configured === true;
  }

  getBibleSections(): ModuleSection[] | null {
    return this.moduleSections?.configured ? (this.moduleSections.bibles?.sections ?? null) : null;
  }

  getCommentarySections(): ModuleSection[] | null {
    return this.moduleSections?.configured ? (this.moduleSections.commentaries?.sections ?? null) : null;
  }

  getDictionarySections(): ModuleSection[] | null {
    return this.moduleSections?.configured ? (this.moduleSections.dictionaries?.sections ?? null) : null;
  }

  /** Get a description override from settings.json for a module. */
  getModuleDescription(type: 'bibles' | 'commentaries' | 'dictionaries', abbreviation: string): { title?: string; description?: string } | null {
    if (!this.moduleSections?.configured) return null;
    const typeInfo = this.moduleSections[type];
    if (!typeInfo) return null;
    return typeInfo.descriptions[abbreviation] ?? null;
  }

  /** Get sort orders for a module type from settings.json. Returns null if not configured or empty. */
  getSortOrders(type: 'bibles' | 'commentaries' | 'dictionaries'): Record<string, number> | null {
    if (!this.moduleSections?.configured) return null;
    const orders = this.moduleSections[type]?.sortOrders;
    if (!orders || Object.keys(orders).length === 0) return null;
    return orders;
  }

  /** Custom about text from settings.json */
  get aboutText(): string | null {
    return this.moduleSections?.about ?? null;
  }

  /** Server-provided commentary popularity from site-config.json */
  private serverPopularity: Record<string, number> | null = null;

  setServerPopularity(popularity: Record<string, number>): void {
    this.serverPopularity = popularity;
  }

  getServerPopularity(): Record<string, number> | null {
    return this.serverPopularity;
  }
}

export const moduleStore = new ModuleStore();

/** Default commentary popularity ranking (lower = more popular).
 *  Used as fallback when server settings don't provide sortOrders. */
const DEFAULT_COMMENTARY_POPULARITY: Record<string, number> = {
  'SYNTHESIS': 0,
  'MHC': 1,
  'MHCC': 2,
  'Barnes': 3,
  'TSK': 4,
  'Gill': 5,
  'JFB': 6,
  'Clarke': 7,
  'Geneva': 8,
  'Wesley': 9,
  'Poole': 10,
  'Trapp': 11,
  'BensonCom': 12,
  'K&D': 13,
  'CambridgeBible': 14,
  'PulpitCom': 15,
  'Spurgeon': 16,
  'CalvinCom': 17,
  'Ellicott': 18,
  'Expositors': 19,
  'Lightfoot': 20,
  'PNT': 21,
  'RWP': 22,
  'Vincent': 23,
  'Bengel': 24,
};

/**
 * Get commentary popularity/sort-order map.
 * Priority: module-section sortOrders > server config popularity > built-in defaults.
 */
export function getCommentaryPopularity(): Record<string, number> {
  return moduleStore.getSortOrders('commentaries')
    ?? moduleStore.getServerPopularity()
    ?? DEFAULT_COMMENTARY_POPULARITY;
}
