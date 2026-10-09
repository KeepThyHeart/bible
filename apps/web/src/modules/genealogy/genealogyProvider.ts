import type { IGenealogyDataProvider } from '@bible/core/browser';
import { GenealogyDataProvider } from '../../providers/ServerDataProvider';
import { API_BASE } from '../../utils/apiUrl';

let shared: IGenealogyDataProvider | null = null;

/** The module's dataset provider (one whole JSON, fetched once and cached in memory). */
export function getGenealogyProvider(): IGenealogyDataProvider {
  if (!shared) shared = new GenealogyDataProvider(API_BASE);
  return shared;
}
