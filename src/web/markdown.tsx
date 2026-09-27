/**
 * A very small markdown renderer for the taste profile: headings, lists, paragraphs,
 * and inline bold, italic and code. It builds React elements, so nothing the agent
 * writes is ever interpreted as HTML.
 */
import type {ReactNode} from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const k = `${key}-${i++}`;
    if (token.startsWith('**')) out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else out.push(<em key={k}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({text}: {text: string}) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>);
      para = [];
    }
    if (list.length > 0) {
      const k = `l${blocks.length}`;
      blocks.push(
        <ul key={k}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, `${k}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      const level = Math.min(4, heading[1]!.length + 2);
      const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={`h${blocks.length}`}>{inline(heading[2]!, `h${blocks.length}`)}</Tag>);
    } else if (bullet !== null) {
      if (para.length > 0) flush();
      list.push(bullet[1]!);
    } else if (line.trim() === '') {
      flush();
    } else {
      if (list.length > 0) flush();
      para.push(line.trim());
    }
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}
