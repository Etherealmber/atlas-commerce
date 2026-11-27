import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';

export type CatalogNamesValue = { fr: string; en: string; ar: string };
export const emptyCatalogNames = (): CatalogNamesValue => ({ fr: '', en: '', ar: '' });

/** Suggestions are optional and never overwrite text entered by the user. */
export default function CatalogNames({ value, onChange, kind, disabled }: { value: CatalogNamesValue; onChange: (update: (previous: CatalogNamesValue) => CatalogNamesValue) => void; kind: 'category' | 'unit'; disabled: boolean }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const suggest = async () => {
    const source = Object.entries(value).find(([, name]) => name.trim());
    if (!source) { setError('Saisissez d’abord un nom.'); return; }
    setBusy(true); setError('');
    try {
      const response = await api.assistChat(JSON.stringify({ kind, language: source[0], name: source[1].trim() }), { task: 'catalog_translation', silent: true });
      const result: unknown = JSON.parse(response.data.reply);
      if (!result || typeof result !== 'object') throw new Error('Réponse invalide');
      const suggestions = result as Record<string, unknown>;
      const values = Object.fromEntries(['fr', 'en', 'ar'].map(lang => {
        const name = suggestions[lang];
        if (typeof name !== 'string' || !name.trim() || name.length > 80 || Array.from(name).some(char => char.charCodeAt(0) < 32)) throw new Error('Réponse invalide');
        return [lang, name.trim()];
      })) as CatalogNamesValue;
      if (!mounted.current) return;
      onChange(previous => ({ fr: previous.fr.trim() ? previous.fr : values.fr, en: previous.en.trim() ? previous.en : values.en, ar: previous.ar.trim() ? previous.ar : values.ar }));
    } catch { if (mounted.current) setError('Suggestion indisponible. Vous pouvez saisir les noms manuellement.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <>
    <small>Au moins un nom est obligatoire.</small>
    {(['fr', 'en', 'ar'] as const).map(lang => <div key={lang} className="catalog-language-field">
      <label htmlFor={`${kind}-name-${lang}`}>{lang === 'fr' ? 'Nom en français' : lang === 'en' ? 'Nom en anglais' : 'Nom en arabe'}</label>
      <input id={`${kind}-name-${lang}`} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} maxLength={80} value={value[lang]} disabled={disabled || busy} onChange={e => { const next = e.target.value; onChange(previous => ({ ...previous, [lang]: next })); }} />
    </div>)}
    <button type="button" className="secondary" disabled={disabled || busy} onClick={() => void suggest()}>{busy ? 'Chargement…' : 'Proposer les noms avec l’IA'}</button>
    <small>Vérifiez les propositions avant d’enregistrer. Les champs déjà remplis ne sont pas remplacés.</small>
    {error && <p role="alert">{error}</p>}
  </>;
}
