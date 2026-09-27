/**
 * Just enough XML for Atom feeds (YouTube uploads, arXiv queries).
 *
 * Feeds are machine-written and regular, so this reads elements by name rather than
 * building a DOM: no dependency, and pure, so fixtures test it directly.
 */

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function unwrap(text: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  return cdata !== null ? cdata[1]! : decodeEntities(text);
}

const escapeName = (name: string) => name.replace(/[:.]/g, m => `\\${m}`);

/** Every `<name …>…</name>` block's inner XML, in order. Not for nested same-name tags. */
export function elements(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${escapeName(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeName(name)}>`, 'g');
  return [...xml.matchAll(pattern)].map(m => m[1]!);
}

/** The text of the first `<name>` element, decoded and trimmed with whitespace collapsed. */
export function text(xml: string, name: string): string | undefined {
  const [first] = elements(xml, name);
  return first === undefined ? undefined : unwrap(first).replace(/\s+/g, ' ').trim();
}

/** An attribute of the first `<name …>` tag (self-closing or not). */
export function attr(xml: string, name: string, attribute: string): string | undefined {
  return attrs(xml, name, attribute)[0];
}

/** An attribute of every `<name …>` tag. */
export function attrs(xml: string, name: string, attribute: string): string[] {
  const tag = new RegExp(`<${escapeName(name)}(\\s[^>]*?)/?>`, 'g');
  const out: string[] = [];
  for (const match of xml.matchAll(tag)) {
    const found = new RegExp(`\\s${escapeName(attribute)}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(match[1]!);
    if (found !== null) out.push(decodeEntities(found[2] ?? found[3] ?? ''));
  }
  return out;
}

/** Tags with all their attributes, for elements like `<link rel=… href=…/>`. */
export function tagsWithAttrs(xml: string, name: string): Array<Record<string, string>> {
  const tag = new RegExp(`<${escapeName(name)}(\\s[^>]*?)/?>`, 'g');
  return [...xml.matchAll(tag)].map(match => {
    const found: Record<string, string> = {};
    for (const a of match[1]!.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) found[a[1]!] = decodeEntities(a[3] ?? a[4] ?? '');
    return found;
  });
}
