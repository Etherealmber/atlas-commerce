import { useState } from 'react';

type Clarification = { question: string; options: string[] };
/** Recognize only an explicit, bounded structure; malformed output stays visible as text. */
export function parseClarification(text: string): { text: string; question: Clarification | null } {
  const match = /(?:^|\n)```atlas-clarification\s*\n([\s\S]*?)\n```\s*$/i.exec(text);
  if (!match || match[1].length > 2000) return { text, question: null };
  try {
    const data = JSON.parse(match[1]);
    if (typeof data.question !== 'string' || !data.question.trim() || data.question.length > 240 || !Array.isArray(data.options) || data.options.length < 2 || data.options.length > 4 || data.options.some((v: unknown) => typeof v !== 'string' || !v.trim() || v.length > 120) || new Set(data.options.map((v: string) => v.trim())).size !== data.options.length) return { text, question: null };
    return { text: text.slice(0, match.index).trim(), question: { question: data.question.trim(), options: data.options.map((v: string) => v.trim()) } };
  } catch { return { text, question: null }; }
}
export function AgentClarification({ question, disabled, onSubmit }: { question: Clarification; disabled: boolean; onSubmit: (answer: string) => void }) {
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [sent, setSent] = useState(false);
  const answer = choice === '__other__' ? other.trim() : choice;
  return <form className="agent-clarification" onSubmit={event => { event.preventDefault(); if (!answer || disabled || sent) return; setSent(true); onSubmit(`${question.question}\nMa réponse : ${answer}`); }}>
    <fieldset disabled={disabled || sent}><legend>{question.question}</legend>
      {question.options.map(option => <label key={option}><input type="radio" name="choice" checked={choice === option} onChange={() => setChoice(option)} /> <span>{option}</span></label>)}
      <label><input type="radio" name="choice" checked={choice === '__other__'} onChange={() => setChoice('__other__')} /><span>Autre réponse</span></label>
      {choice === '__other__' && <input aria-label="Autre réponse" maxLength={300} value={other} onChange={event => setOther(event.target.value)} />}
      <button type="submit" disabled={!answer}>{sent ? 'Envoyé' : 'Envoyer la réponse'}</button>
    </fieldset>
  </form>;
}
