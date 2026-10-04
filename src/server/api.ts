/**
 * The HTTP API. Every CLI command is one of these endpoints; the web app uses the same.
 *
 * Handlers are thin: they read the request, call into `src/db/`, and return the fields
 * of the success envelope. Anything thrown as an `AppError` becomes the failure
 * envelope with its exit code. Routes marked `userOnly` are refused for agent tokens
 * here, in one place, rather than by each handler remembering to check.
 */
import {AppError, EXIT_ERROR, EXIT_USAGE, describe, refused} from '../core/errors.ts';
import type {Ctx} from '../db/context.ts';
import {contractDocument} from '../db/contract.ts';
import {getSetting} from '../db/settings.ts';
import {VERSION} from '../version.ts';
import {compile, errorResponse, json, readBody, type CompiledRoute, type Route} from './http.ts';
import {curatorRoutes} from './routes/curator.ts';
import {followRoutes} from './routes/follows.ts';
import {itemRoutes} from './routes/items.ts';
import {pollRoutes} from './routes/poll.ts';
import {settingsRoutes} from './routes/settings.ts';
import {tasteRoutes} from './routes/taste.ts';

const ROUTES: Route[] = [
  {
    method: 'GET',
    path: '/api/whoami',
    handler: ctx => ({
      actor: ctx.actor,
      version: VERSION,
      enabled_sources: ctx.sources.enabled,
      sources: ctx.sources.list().map(s => ({id: s.id, name: s.label.name, done_label: s.label.done, item_label: s.label.item, fetched_by: s.fetchedBy, follow_kinds: s.followKinds})),
      ...(ctx.sources.isEnabled('docs') ? {docs: {label: getSetting(ctx.db, 'docs_label'), item_label: getSetting(ctx.db, 'docs_item_label'), reauth_hint: getSetting(ctx.db, 'docs_reauth_hint') ?? null}} : {}),
    }),
  },
  {method: 'GET', path: '/api/agents', handler: ctx => ({document: contractDocument(ctx)})},
  ...itemRoutes,
  ...followRoutes,
  ...tasteRoutes,
  ...pollRoutes,
  ...curatorRoutes,
  ...settingsRoutes,
];

const COMPILED: CompiledRoute[] = ROUTES.map(compile);

export function allRoutes(): readonly CompiledRoute[] {
  return COMPILED;
}

/**
 * `log` gets one line per failed request, so an error the web app only flashes on screen
 * can be read back later from the server's output (`legenda service logs`).
 */
export async function handleApi(ctx: Ctx, request: Request, url: URL, log: (line: string) => void = () => {}): Promise<Response | undefined> {
  let pathMatched = false;
  for (const route of COMPILED) {
    const match = route.regex.exec(url.pathname);
    if (match === null) continue;
    pathMatched = true;
    if (route.method !== request.method) continue;

    const params: Record<string, string> = {};
    route.names.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]!);
    });
    try {
      if (route.userOnly !== undefined && ctx.isAgent) throw refused(capitalise(route.userOnly));
      if (route.agentOnly !== undefined && !ctx.isAgent) {
        throw new AppError(`${capitalise(route.agentOnly)} is the curator's job; it needs an agent token`, EXIT_USAGE, {refused: true}, 403);
      }
      const body = await readBody(request);
      const result = await route.handler(ctx, {params, query: url.searchParams, body, request});
      return json({ok: true, ...result});
    } catch (error) {
      const failed = error instanceof AppError ? error : new AppError(`internal error: ${describe(error)}`, EXIT_ERROR, {}, 500);
      const response = errorResponse(failed);
      log(`${ctx.now()} ${request.method} ${url.pathname} ${response.status} (${ctx.actor}): ${failed.message}`);
      if (!(error instanceof AppError) && error instanceof Error && error.stack !== undefined) log(error.stack);
      return response;
    }
  }
  if (pathMatched) return errorResponse(new AppError(`${request.method} is not supported on ${url.pathname}`, EXIT_USAGE, {}, 405));
  return undefined;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
