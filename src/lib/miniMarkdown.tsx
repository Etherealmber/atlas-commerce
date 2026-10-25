import { type ReactNode } from 'react';

/**
 * miniMarkdown — tiny, dependency-free Markdown renderer for Atlas Agent replies.
 * Supports: ``` code fences, # / ## / ### headings, - / * and 1. lists,
 * **bold**, *italic*, `inline code`, [liens](url), > citations, --- séparateurs.
 * Input is HTML-escaped by construction (text nodes only, no dangerouslySetInnerHTML).
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key} className="md-inline-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('*')) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (mm) {
        const safe = /^(https?:\/\/|\/|#)/i.test(mm[2]);
        out.push(
          safe ? (
            <a key={key} href={mm[2]} target={mm[2].startsWith('http') ? '_blank' : undefined} rel="noreferrer noopener">{mm[1]}</a>
          ) : (
            <span key={key}>{mm[1]}</span>
          ),
        );
      } else out.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMiniMarkdown(src: string): ReactNode {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // code fence
    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i += 1; }
      i += 1;
      blocks.push(<pre key={`b${k++}`} className="md-pre"><code>{buf.join('\n')}</code></pre>);
      continue;
    }

    // headings
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const content = renderInline(h[2], `b${k}`);
      blocks.push(lvl === 1 ? <h4 key={`b${k++}`} className="md-h1">{content}</h4>
        : lvl === 2 ? <h5 key={`b${k++}`} className="md-h2">{content}</h5>
        : <h6 key={`b${k++}`} className="md-h3">{content}</h6>);
      i += 1;
      continue;
    }

    // separator
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push(<hr key={`b${k++}`} className="md-hr" />); i += 1; continue; }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      blocks.push(<blockquote key={`b${k++}`} className="md-quote">{renderInline(buf.join(' '), `b${k}`)}</blockquote>);
      continue;
    }

    // unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i += 1; }
      blocks.push(
        <ul key={`b${k++}`} className="md-ul">
          {items.map((it, j) => <li key={j}>{renderInline(it, `b${k}-${j}`)}</li>)}
        </ul>,
      );
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i += 1; }
      blocks.push(
        <ol key={`b${k++}`} className="md-ol">
          {items.map((it, j) => <li key={j}>{renderInline(it, `b${k}-${j}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // blank line
    if (!line.trim()) { i += 1; continue; }

    // paragraph (merge consecutive plain lines)
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length
      && lines[i].trim()
      && !/^(```|#{1,3}\s|>\s?|\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(lines[i])
    ) { buf.push(lines[i]); i += 1; }
    blocks.push(<p key={`b${k++}`} className="md-p">{renderInline(buf.join(' '), `b${k}`)}</p>);
  }

  return <div className="md-root">{blocks}</div>;
}

export default renderMiniMarkdown;
