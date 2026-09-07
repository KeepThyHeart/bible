/**
 * StudyOverview - cross-module aggregation services
 *
 * Services that aggregate per-chapter overviews across multiple installed
 * modules (commentaries, topical indexes, cross-references, tag-graph).
 * Used by the study cache generation script and (in future) by the desktop
 * IPC layer.
 *
 * See docs/queue/keep1.md section 7 for the design rationale.
 */

export * from './types';

export * from './ICommentaryAggregationService';
export * from './CommentaryAggregationService';

export * from './ITopicAggregationService';
export * from './TopicAggregationService';

export * from './ICrossRefAggregationService';
export * from './CrossRefAggregationService';

export * from './IEntityAggregationService';
export * from './EntityAggregationService';
