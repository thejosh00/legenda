/**
 * The user's reactions, structured so the curator can learn from them.
 *
 * Each kind says when it is offered (a reaction on marking done, a reason when
 * dismissing, or any time) and which sources it makes sense for.
 */
import type {SourceId} from './types.ts';

export type FeedbackMoment = 'done' | 'dismiss' | 'any';

interface KindSpec {
  moment: FeedbackMoment;
  sources: readonly SourceId[] | 'all';
  label: string;
}

export const FEEDBACK_KINDS = {
  loved: {moment: 'done', sources: 'all', label: 'loved'},
  liked: {moment: 'done', sources: 'all', label: 'liked'},
  meh: {moment: 'done', sources: 'all', label: 'meh'},
  disliked: {moment: 'done', sources: 'all', label: 'disliked'},
  abandoned: {moment: 'done', sources: 'all', label: 'abandoned'},
  not_interested_topic: {moment: 'dismiss', sources: 'all', label: 'not into this topic'},
  not_interested_creator: {moment: 'dismiss', sources: 'all', label: 'not this creator'},
  too_long: {moment: 'dismiss', sources: 'all', label: 'too long'},
  too_short: {moment: 'dismiss', sources: 'all', label: 'too short'},
  too_basic: {moment: 'dismiss', sources: ['papers', 'docs'], label: 'too basic'},
  too_deep: {moment: 'dismiss', sources: ['papers', 'docs'], label: 'too deep'},
  clickbait: {moment: 'dismiss', sources: ['youtube', 'papers'], label: 'clickbait'},
  low_quality: {moment: 'dismiss', sources: ['youtube', 'papers'], label: 'low quality'},
  outdated: {moment: 'dismiss', sources: ['papers', 'docs'], label: 'outdated'},
  not_relevant: {moment: 'dismiss', sources: ['docs'], label: 'not relevant here'},
  already_seen: {moment: 'dismiss', sources: 'all', label: 'already seen'},
  more_like_this: {moment: 'any', sources: 'all', label: 'more like this'},
  less_like_this: {moment: 'any', sources: 'all', label: 'less like this'},
  comment: {moment: 'any', sources: 'all', label: 'comment'},
} as const satisfies Record<string, KindSpec>;

export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

export const REACTIONS = ['loved', 'liked', 'meh', 'disliked', 'abandoned'] as const satisfies readonly FeedbackKind[];
export type Reaction = (typeof REACTIONS)[number];

export const isFeedbackKind = (value: unknown): value is FeedbackKind =>
  typeof value === 'string' && Object.hasOwn(FEEDBACK_KINDS, value);

export function kindAppliesTo(kind: FeedbackKind, source: SourceId): boolean {
  const sources: readonly SourceId[] | 'all' = FEEDBACK_KINDS[kind].sources;
  return sources === 'all' || sources.includes(source);
}

/** The kinds offered at a moment for a source, in display order. */
export function kindsFor(moment: FeedbackMoment, source: SourceId): FeedbackKind[] {
  return (Object.keys(FEEDBACK_KINDS) as FeedbackKind[]).filter(
    kind => FEEDBACK_KINDS[kind].moment === moment && kindAppliesTo(kind, source),
  );
}

export const dismissReasonsFor = (source: SourceId) => kindsFor('dismiss', source);
