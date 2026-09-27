/**
 * The sources this build knows, and the ones an instance has turned on.
 *
 * A source that is not enabled is invisible: it is not detected in pasted URLs, not
 * offered in the UI, and not in the agent's context.
 */
import {AppError, EXIT_USAGE} from '../core/errors.ts';
import type {SourceId} from '../core/types.ts';
import type {Source, SourceDeps} from './types.ts';
import {docsSource} from './docs.ts';
import {papersSource} from './papers.ts';
import {youtubeSource} from './youtube.ts';

type Factory = (deps: SourceDeps) => Source;

const FACTORIES: Partial<Record<SourceId, Factory>> = {
  youtube: youtubeSource,
  papers: papersSource,
  docs: docsSource,
};

export const implementedSources = (): SourceId[] => Object.keys(FACTORIES) as SourceId[];

export class Sources {
  private readonly built = new Map<SourceId, Source>();

  constructor(
    private readonly deps: (id: SourceId) => SourceDeps,
    readonly enabled: readonly SourceId[],
  ) {}

  isEnabled(id: SourceId): boolean {
    return this.enabled.includes(id) && FACTORIES[id] !== undefined;
  }

  /** An enabled source, or a usage error naming what is on. */
  get(id: SourceId): Source {
    if (!this.isEnabled(id)) {
      throw new AppError(`the ${id} source is not enabled on this instance (enabled: ${this.list().map(s => s.id).join(', ') || 'none'})`, EXIT_USAGE);
    }
    let source = this.built.get(id);
    if (source === undefined) {
      source = FACTORIES[id]!(this.deps(id));
      this.built.set(id, source);
    }
    return source;
  }

  list(): Source[] {
    return this.enabled.filter(id => FACTORIES[id] !== undefined).map(id => this.get(id));
  }

  /** Which enabled source a pasted URL belongs to. Bare ids are not guessed at. */
  detect(input: string): {source: Source; externalId: string} | undefined {
    if (!looksLikeUrl(input)) return undefined;
    for (const source of this.list()) {
      const ref = source.parseRef(input);
      if (ref !== null) return {source, externalId: ref.externalId};
    }
    return undefined;
  }
}

function looksLikeUrl(input: string): boolean {
  const text = input.trim();
  // A URL, or an explicitly prefixed reference like arXiv:2401.01234 or doi:10.1145/….
  return /^https?:\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+\//.test(text) || /^(arxiv|doi):\S+$/i.test(text);
}
