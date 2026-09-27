/**
 * Seeds for a source's own recommender, taken from the user's feedback: what they
 * loved, liked or asked for more of is positive; what they disliked, asked for less of,
 * or dismissed as not their topic is negative.
 */
import type {SourceId} from '../core/types.ts';
import type {Ctx} from './context.ts';

const POSITIVE = ['loved', 'liked', 'more_like_this'];
const NEGATIVE = ['disliked', 'less_like_this', 'not_interested_topic'];

export function feedbackSeeds(ctx: Ctx, source: SourceId, limit = 50): {positive: string[]; negative: string[]} {
  const seeds = (kinds: string[]) =>
    (
      ctx.db
        .query(
          `SELECT i.external_id, MAX(f.at) AS at FROM feedback f JOIN items i ON i.id = f.item_id
           WHERE i.source = ? AND f.kind IN (${kinds.map(() => '?').join(',')})
           GROUP BY i.external_id ORDER BY at DESC LIMIT ?`,
        )
        .all(source, ...kinds, limit) as Array<{external_id: string}>
    ).map(r => r.external_id);
  const positive = seeds(POSITIVE);
  const negative = seeds(NEGATIVE).filter(id => !positive.includes(id));
  return {positive, negative};
}
