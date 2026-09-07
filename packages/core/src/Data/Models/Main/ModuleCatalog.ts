import { Metadata } from '../../Core/Types';
import { RepositoryCatalog, CatalogSignatureStatus } from '../../Core/CatalogTypes';

/**
 * Catalog source type
 */
export type CatalogSourceType = 'official' | 'crosswire' | 'third_party' | 'local';

/**
 * Module catalog entity from the main database.
 * Represents a source for downloadable modules (distinct from the data-access Repository pattern).
 */
export class ModuleCatalog {
  catalogId?: number;
  name: string;
  abbreviation?: string;
  url: string;
  type: CatalogSourceType;
  isEnabled: boolean;
  priority: number;
  catalogJson?: string;
  lastUpdated?: string;
  lastFetched?: string;
  metadata?: Metadata;
  /** Result of verifying the detached signature on the last successful fetch. */
  signatureStatus?: CatalogSignatureStatus;
  /**
   * Hex Ed25519 public key that signed this catalog. Recorded on first use so
   * a later key change can be detected (trust-on-first-use).
   */
  signingPublicKey?: string;

  constructor(data: {
    catalogId?: number;
    name: string;
    abbreviation?: string;
    url: string;
    type: CatalogSourceType;
    isEnabled?: boolean;
    priority?: number;
    catalogJson?: string;
    lastUpdated?: string;
    lastFetched?: string;
    metadata?: Metadata;
    signatureStatus?: CatalogSignatureStatus;
    signingPublicKey?: string;
  }) {
    this.catalogId = data.catalogId;
    this.name = data.name;
    this.abbreviation = data.abbreviation;
    this.url = data.url;
    this.type = data.type;
    this.isEnabled = data.isEnabled ?? true;
    this.priority = data.priority ?? 0;
    this.catalogJson = data.catalogJson;
    this.lastUpdated = data.lastUpdated;
    this.lastFetched = data.lastFetched;
    this.metadata = data.metadata;
    this.signatureStatus = data.signatureStatus;
    this.signingPublicKey = data.signingPublicKey;
  }

  /**
   * Whether this catalog has ever served a valid signature.
   * Once true, a subsequent unsigned fetch is treated as a downgrade attack.
   */
  hasBeenSigned(): boolean {
    return this.signatureStatus === 'verified' && !!this.signingPublicKey;
  }

  /**
   * Get the display name with abbreviation
   */
  getDisplayName(): string {
    if (this.abbreviation) {
      return `${this.name} (${this.abbreviation})`;
    }
    return this.name;
  }

  /**
   * Check if repository is official
   */
  isOfficial(): boolean {
    return this.type === 'official';
  }

  /**
   * Check if catalog needs refresh (older than 7 days)
   */
  needsRefresh(): boolean {
    if (!this.lastFetched) {
      return true;
    }
    const lastFetch = new Date(this.lastFetched);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return lastFetch < sevenDaysAgo;
  }

  /**
   * Get the parsed catalog (if available)
   */
  getParsedCatalog(): RepositoryCatalog | undefined {
    if (!this.catalogJson) {
      return undefined;
    }
    try {
      return JSON.parse(this.catalogJson);
    } catch {
      return undefined;
    }
  }

  /**
   * Set the catalog JSON (from object)
   */
  setCatalog(catalog: RepositoryCatalog): void {
    this.catalogJson = JSON.stringify(catalog);
    this.lastFetched = new Date().toISOString();
    this.lastUpdated = catalog.repository?.last_updated;
  }
}
