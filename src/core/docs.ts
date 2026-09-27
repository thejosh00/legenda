/**
 * Docs references, pure. Nothing here knows any particular organisation: the base URL
 * comes from the instance's `docs_base_url`, and page ids are recognised in the common
 * shapes docs systems use, falling back to the URL itself.
 */

/** Whether a URL is under the configured base (scheme and host exact, path prefix). */
export function underBase(url: string, base: string | undefined): boolean {
  if (base === undefined || base.trim() === '') return false;
  let target: URL;
  let root: URL;
  try {
    target = new URL(url.trim());
    root = new URL(base.trim());
  } catch {
    return false;
  }
  if (target.protocol !== root.protocol || target.host.toLowerCase() !== root.host.toLowerCase()) return false;
  const prefix = root.pathname.replace(/\/+$/, '');
  return target.pathname === prefix || target.pathname.startsWith(`${prefix}/`) || prefix === '';
}

/**
 * A page id from a docs URL: Confluence `/pages/<id>` or `?pageId=<id>`, a trailing
 * 32-hex Notion id, a Google `/d/<id>`; otherwise the URL without query or fragment.
 */
export function docPageId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  const pageParam = parsed.searchParams.get('pageId');
  if (pageParam !== null && /^\d+$/.test(pageParam)) return pageParam;
  const confluence = /\/pages\/(\d+)(?:\/|$)/.exec(parsed.pathname);
  if (confluence !== null) return confluence[1];
  const notion = /([0-9a-f]{32})\/?$/i.exec(parsed.pathname);
  if (notion !== null) return notion[1]!.toLowerCase();
  const google = /\/d\/([A-Za-z0-9_-]{20,})/.exec(parsed.pathname);
  if (google !== null) return google[1];
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}
