/**
 * The internet, as far as tests are concerned: canned responses by URL prefix, and a
 * record of every request. An unexpected request is an error, never a real fetch.
 */
import type {Fetcher} from '../../src/sources/types.ts';

type Responder = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export class FakeWeb {
  readonly requests: Array<{url: string; method: string; body?: string}> = [];
  private readonly routes: Array<{prefix: string; respond: Responder}> = [];

  /** Answer requests whose URL starts with `prefix`. Later registrations win. */
  on(prefix: string, respond: Responder | string | object, status = 200): this {
    const responder: Responder =
      typeof respond === 'function'
        ? (respond as Responder)
        : () =>
            new Response(typeof respond === 'string' ? respond : JSON.stringify(respond), {
              status,
              headers: {'content-type': typeof respond === 'string' ? 'text/xml' : 'application/json'},
            });
    this.routes.unshift({prefix, respond: responder});
    return this;
  }

  count(prefix: string): number {
    return this.requests.filter(r => r.url.startsWith(prefix)).length;
  }

  readonly fetcher: Fetcher = async (url, init) => {
    this.requests.push({url, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? {body: init.body} : {})});
    const route = this.routes.find(r => url.startsWith(r.prefix));
    if (route === undefined) throw new Error(`FakeWeb: no fixture for ${url}`);
    return route.respond(new URL(url), init);
  };
}

export async function fixture(name: string): Promise<string> {
  return Bun.file(new URL(`../fixtures/${name}`, import.meta.url)).text();
}
