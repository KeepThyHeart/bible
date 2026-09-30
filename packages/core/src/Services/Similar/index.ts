/**
 * Similar passages (task 0070), browser-safe barrel. `semanticVectorSource` is Node-only
 * (it wraps SemanticSearchService) and is exported from the main entry instead.
 */
export * from './SimilarTypes';
export * from './SimilarWeights';
export * from './aggregateHits';
export * from './rankNeighbours';
export * from './explainMatch';
export * from './passageFacts';
export * from './NeighbourTable';
export * from './SimilarPassagesService';
