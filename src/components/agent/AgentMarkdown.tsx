import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Markdown is parsed without raw HTML or external images; only safe links are allowed. */
export function AgentMarkdown({ text }: { text: string }) {
  return <div className="agent-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}
    urlTransform={url => /^(https?:\/\/|#|\/(?!\/))/i.test(url.trim()) ? url.trim() : ''}
    components={{ a: ({ href, children }) => href ? <a href={href} target={/^https?:/i.test(href) ? '_blank' : undefined} rel="noopener noreferrer">{children}</a> : <span>{children}</span>, img: ({ alt }) => <span>{alt || 'Image non affichée'}</span> }}
  >{text.replace(/<br\s*\/?\s*>/gi, ' · ')}</ReactMarkdown></div>;
}
