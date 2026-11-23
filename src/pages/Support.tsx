import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLandingMotion } from '../hooks/useLandingMotion';
import { PublicNav, PublicSessionCta, GitHubStarButton } from '../components/PublicChrome';
import { APP_BUILD_DATE, APP_NAME } from '../version';

const SUPPORT_SITE = 'https://support.afmarbre.com';
const SUPPORT_CHAT = 'https://chat.afmarbre.com/';
const SUPPORT_STATUS = 'https://status.afmarbre.com/';
const AFMARBRE_SITE = 'https://afmarbre.com/';
const SUPPORT_EMAIL = 'support@afmarbre.com';
const SUPPORT_PHONE_TEL = 'tel:+212522969736';
const SUPPORT_PHONE_LABEL = '05 22 96 97 36';
const SUPPORT_WA = 'https://wa.me/212661959239';
const SUPPORT_WA_LABEL = '06 61 95 92 39';
const SHOWROOM_MAP = 'https://maps.app.goo.gl/oAFFAobrUDsu5sAE6';

const WORKFLOW_STEPS: { code: string; title: string; text: string }[] = [
  {
    code: '01 / Avant le projet',
    title: 'Étude, mesures & devis',
    text: 'Choix des pierres (marbre, granit, quartz), prise de cotes sur plan ou sur site et devis détaillé adapté au chantier.',
  },
  {
    code: '02 / Pendant la réalisation',
    title: 'Façonnage & pose',
    text: 'Découpe en atelier, contrôle qualité, coordination de livraison et suivi d’avancement jusqu’à la pose finale.',
  },
  {
    code: '03 / Après la pose',
    title: 'SAV, facture & entretien',
    text: 'Assistance post-pose, duplicata de facture, conseils de cristallisation et maintenance durable des surfaces.',
  },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Comment demander un devis pour un projet marbre, granit ou quartz ?',
    a: 'Utilisez le formulaire ci-dessus en sélectionnant « Demande de devis », précisez le type d’ouvrage (plan de travail, escalier, revêtement, vasque) et vos dimensions approximatives.',
  },
  {
    q: 'Puis-je envoyer des photos ou un plan après ma demande ?',
    a: 'Oui. Répondez à l’e-mail de confirmation avec vos photos/plans, ou envoyez-les directement sur WhatsApp au 06 61 95 92 39 en rappelant votre référence AFM.',
  },
  {
    q: 'Quels sont les délais habituels de façonnage et de pose ?',
    a: 'Selon la pierre retenue et la complexité du chantier, le délai est précisé dès la validation du devis et suivi avec notre équipe atelier.',
  },
  {
    q: 'Comment suivre l’avancement d’une commande ou d’une intervention ?',
    a: 'Renseignez votre référence AFM (ex. AFM-2026-0142) dans le module de suivi ci-dessous ou contactez-nous par téléphone / WhatsApp aux horaires d’ouverture.',
  },
  {
    q: 'Quels modes de paiement et documents comptables sont disponibles ?',
    a: 'Virement, chèque ou règlement au showroom. Les factures et reçus détaillés sont émis via Atlas Commerce et ré-éditables à la demande.',
  },
  {
    q: 'Comment entretenir et cristalliser un marbre ou un plan en pierre ?',
    a: 'Évitez les produits acides ou abrasifs ; utilisez un savon neutre pH 7. Pour une cristallisation ou rénovation, sélectionnez « Entretien & cristallisation ».',
  },
  {
    q: 'Où se situe le showroom AF Marbre ?',
    a: 'Route Azemmour Km 24, Berahma. Ouvert du lundi au samedi de 09h00 à 13h00 et de 14h30 à 18h30.',
  },
];

function isShowroomOpenNow(): boolean {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Casablanca',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const weekday = (parts.find((p) => p.type === 'weekday')?.value || '').toLowerCase();
    if (weekday.startsWith('dim')) return false;
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    const mins = hour * 60 + minute;
    return (mins >= 9 * 60 && mins < 13 * 60) || (mins >= 14 * 60 + 30 && mins < 18 * 60 + 30);
  } catch {
    return false;
  }
}

export default function Support() {
  const pageRef = useRef<HTMLDivElement>(null);
  useLandingMotion(pageRef, '.dl-ed-facts, .dl-ed-section', '.dl-ed-mark');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [reference, setReference] = useState('');
  const [type, setType] = useState<'devis' | 'livraison' | 'sav' | 'entretien' | 'facture' | 'autre'>('sav');
  const [contactPref, setContactPref] = useState<'email' | 'telephone' | 'whatsapp'>('email');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitOk, setSubmitOk] = useState<{ ref: string; fallbackMailto?: string } | null>(null);
  const [submitErr, setSubmitErr] = useState('');

  const [lookupRef, setLookupRef] = useState('');
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [lookupMsg, setLookupMsg] = useState('');

  const showroomOpen = useMemo(() => isShowroomOpenNow(), []);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = `Support & assistance — ${APP_NAME}`;
    return () => {
      document.title = prevTitle;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitErr('');
    setSubmitOk(null);
    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      setSubmitErr('Merci de renseigner votre nom, votre e-mail, l’objet et le détail de votre demande.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPPORT_SITE}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          reference: reference.trim(),
          type,
          contact: contactPref,
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const refId = String(data?.reference || data?.id || `AFM-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-4)}`);
        setSubmitOk({ ref: refId });
        setSubject('');
        setMessage('');
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch {
      const localRef = reference.trim() || `AFM-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-4)}`;
      const mailBody = [
        `Nom : ${name.trim()}`,
        `E-mail : ${email.trim()}`,
        phone.trim() ? `Téléphone : ${phone.trim()}` : '',
        `Type : ${type}`,
        `Canal préféré : ${contactPref}`,
        `Référence : ${localRef}`,
        '',
        message.trim(),
      ]
        .filter(Boolean)
        .join('\n');
      const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[${type.toUpperCase()}] ${subject.trim()} (${localRef})`)}&body=${encodeURIComponent(mailBody)}`;
      setSubmitOk({ ref: localRef, fallbackMailto: mailto });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    const q = lookupRef.trim();
    if (!q) {
      setLookupState('error');
      setLookupMsg('Saisissez une référence AFM (ex. AFM-2026-0142).');
      return;
    }
    setLookupState('loading');
    setLookupMsg('');
    try {
      const res = await fetch(`${SUPPORT_SITE}/api/requests/${encodeURIComponent(q)}`);
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const status = String(data?.status || 'En cours de traitement');
        setLookupState('done');
        setLookupMsg(`Référence ${q} — Statut : ${status}`);
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch {
      setLookupState('error');
      setLookupMsg(`Suivi en ligne indisponible pour ${q}. Contactez ${SUPPORT_EMAIL} ou WhatsApp (${SUPPORT_WA_LABEL}).`);
    }
  }

  return (
    <div className="download-landing desktop-landing support-landing" ref={pageRef}>
      <PublicNav
        links={[
          { href: '/', label: 'Accueil' },
          { href: '/desktop', label: 'Bureau' },
          { href: '#demande', label: 'Demande' },
          { href: '#suivi', label: 'Suivi' },
          { href: '#faq', label: 'FAQ' },
          { href: '/whats-new', label: 'Nouveautés' },
        ]}
        cta={<PublicSessionCta />}
        classic
      />

      <main className="dl-ed-main">
        <section className="dl-hero dl-ed-hero">
          <div className="dl-container">
            <a className="dl-ed-release-badge" href={SUPPORT_SITE} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true" />
              Portail Support · support.afmarbre.com <b aria-hidden="true">↗</b>
            </a>
            <div className="dl-ed-hero-grid">
              <div className="dl-hero-content">
                <h1 className="dl-h1 dl-ed-title">
                  <span className="dl-ed-title-first">Votre projet mérite</span>{' '}
                  <span className="dl-ed-title-second">un suivi précis.</span>
                </h1>
                <p className="dl-desc">
                  Assistance commerciale et technique Atlas Commerce &amp; AF Marbre : devis, livraison, SAV, factures et showroom.
                </p>
                <div className="dl-ctas">
                  <a className="dl-cta-main" href="#demande">
                    Ouvrir une demande <span className="dl-cta-arrow" aria-hidden="true">↓</span>
                  </a>
                  <a className="dl-cta-ghost" href={SUPPORT_CHAT} target="_blank" rel="noopener noreferrer">
                    Assistant IA <span className="dl-cta-arrow" aria-hidden="true">↗</span>
                  </a>
                  <a className="dl-cta-ghost" href={SUPPORT_WA} target="_blank" rel="noopener noreferrer">
                    WhatsApp <span className="dl-cta-arrow" aria-hidden="true">↗</span>
                  </a>
                </div>
                <p className="dl-note">
                  Showroom Route Azemmour Km 24, Berahma ·{' '}
                  <strong>{showroomOpen ? 'Ouvert actuellement' : 'Hors horaires d’ouverture'}</strong> (Lun. – Sam. 09:00–13:00 · 14:30–18:30).
                </p>
              </div>
              <div className="dl-ed-mark" aria-hidden="true">
                <div>
                  <img src="/atlas-icon-light.png" alt="" width="100" height="100" />
                </div>
                <span>ATLAS · SUPPORT</span>
              </div>
            </div>

            <ul className="dl-ed-facts">
              <li>
                <b>Assistant IA 24/7</b>
                <span>
                  <a href={SUPPORT_CHAT} target="_blank" rel="noopener noreferrer">chat.afmarbre.com ↗</a>
                </span>
              </li>
              <li>
                <b>Téléphone</b>
                <span>
                  <a href={SUPPORT_PHONE_TEL}>{SUPPORT_PHONE_LABEL}</a>
                </span>
              </li>
              <li>
                <b>WhatsApp</b>
                <span>
                  <a href={SUPPORT_WA} target="_blank" rel="noopener noreferrer">{SUPPORT_WA_LABEL} ↗</a>
                </span>
              </li>
              <li>
                <b>Showroom</b>
                <span>
                  <a href={SHOWROOM_MAP} target="_blank" rel="noopener noreferrer">Berahma · Itinéraire ↗</a>
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="demande" aria-labelledby="support-form-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading">
              <p className="dl-ed-kicker">01 / ASSISTANCE</p>
              <h2 id="support-form-title">Nouvelle demande</h2>
              <p>Décrivez votre besoin (devis, livraison, SAV, entretien ou facture). Notre équipe vous répond sous 24 h ouvrées.</p>
              <a href={SUPPORT_STATUS} target="_blank" rel="noopener noreferrer">État des services ↗</a>
            </div>
            <div className="dl-ed-content">
              <form className="dl-support-form" onSubmit={handleSubmit}>
                <div className="dl-support-grid">
                  <label>
                    <span>Nom complet *</span>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Karim Benali" required />
                  </label>
                  <label>
                    <span>E-mail *</span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.com" required />
                  </label>
                  <label>
                    <span>Téléphone</span>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 00 00 00 00" />
                  </label>
                  <label>
                    <span>Référence (optionnel)</span>
                    <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="AFM-2026-..." />
                  </label>
                  <label>
                    <span>Type de demande</span>
                    <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                      <option value="devis">Demande de devis</option>
                      <option value="livraison">Livraison &amp; chantier</option>
                      <option value="sav">Service après-vente (SAV)</option>
                      <option value="entretien">Entretien &amp; cristallisation</option>
                      <option value="facture">Facture &amp; comptabilité</option>
                      <option value="autre">Autre demande</option>
                    </select>
                  </label>
                  <label>
                    <span>Canal de réponse préféré</span>
                    <select value={contactPref} onChange={(e) => setContactPref(e.target.value as typeof contactPref)}>
                      <option value="email">E-mail</option>
                      <option value="telephone">Téléphone</option>
                      <option value="whatsapp">WhatsApp</option>
                    </select>
                  </label>
                </div>
                <label className="dl-support-full">
                  <span>Objet *</span>
                  <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Résumé court de votre demande" required />
                </label>
                <label className="dl-support-full">
                  <span>Message *</span>
                  <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Précisez les dimensions, la pierre ou le numéro de facture..." required />
                </label>

                {submitErr && <p className="dl-support-err">{submitErr}</p>}
                {submitOk && (
                  <div className="dl-support-ok" role="status">
                    <strong>Demande préparée — Référence {submitOk.ref}</strong>
                    {submitOk.fallbackMailto ? (
                      <p>
                        L’envoi direct au portail distant n’est pas joignable depuis ce navigateur :{' '}
                        <a href={submitOk.fallbackMailto}>Envoyer par e-mail à {SUPPORT_EMAIL} ↗</a>
                      </p>
                    ) : (
                      <p>Votre demande a bien été transmise au support ({SUPPORT_EMAIL}).</p>
                    )}
                  </div>
                )}

                <div className="dl-support-actions">
                  <button type="submit" className="dl-cta-main" disabled={submitting}>
                    {submitting ? 'Envoi en cours…' : 'Envoyer la demande'}
                  </button>
                  <a className="dl-cta-ghost" href={`mailto:${SUPPORT_EMAIL}`}>
                    {SUPPORT_EMAIL} ↗
                  </a>
                </div>
              </form>
            </div>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="suivi" aria-labelledby="support-lookup-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading">
              <p className="dl-ed-kicker">02 / SUIVI</p>
              <h2 id="support-lookup-title">Suivi de dossier</h2>
              <p>Consultez l’état d’avancement d’une demande enregistrée sur le portail.</p>
              <a href={AFMARBRE_SITE} target="_blank" rel="noopener noreferrer">Site afmarbre.com ↗</a>
            </div>
            <div className="dl-ed-content">
              <form className="dl-support-lookup" onSubmit={handleLookup}>
                <input
                  type="text"
                  value={lookupRef}
                  onChange={(e) => setLookupRef(e.target.value)}
                  placeholder="Référence (ex. AFM-2026-0142)"
                  aria-label="Référence de suivi"
                />
                <button type="submit" className="secondary" disabled={lookupState === 'loading'}>
                  {lookupState === 'loading' ? 'Recherche…' : 'Vérifier le statut'}
                </button>
              </form>
              {lookupMsg && (
                <p className={lookupState === 'done' ? 'dl-support-lookup-ok' : 'dl-support-lookup-msg'}>
                  {lookupMsg}
                </p>
              )}
              <div className="dl-stats">
                <div className="dl-stat">
                  <strong>24 h</strong>
                  <span>Délai cible ouvré</span>
                </div>
                <div className="dl-stat">
                  <strong>6 jours</strong>
                  <span>Lun. – Sam.</span>
                </div>
                <div className="dl-stat">
                  <strong>3 canaux</strong>
                  <span>E-mail · Tél · WhatsApp</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="dl-ed-section dl-container" aria-labelledby="support-workflow-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading">
              <p className="dl-ed-kicker">03 / PARCOURS</p>
              <h2 id="support-workflow-title">Accompagnement complet.</h2>
              <p>Du premier plan jusqu’à l’entretien après pose.</p>
              <GitHubStarButton repo="loxdpsy/support-page" />
            </div>
            <div className="dl-feats">
              {WORKFLOW_STEPS.map((s) => (
                <div key={s.code} className="dl-feat">
                  <strong>{s.code} · {s.title}</strong>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="faq" aria-labelledby="support-faq-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading">
              <p className="dl-ed-kicker">04 / FAQ</p>
              <h2 id="support-faq-title">Questions fréquentes</h2>
              <p>Réponses rapides sur les devis, délais, règlements et showroom.</p>
              <Link to="/about">À propos d’Atlas ↗</Link>
            </div>
            <div className="dl-ed-content dl-support-faq">
              {FAQ_ITEMS.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="dl-foot">
        <div className="dl-foot-inner">
          <div className="dl-foot-brand">
            <img src="/atlas-logo-dark.png" alt={APP_NAME} className="theme-logo-dark" width={117} height={38} style={{ height: 38, width: 117 }} />
            <img src="/atlas-logo-light.png" alt={APP_NAME} className="theme-logo-light" width={117} height={38} style={{ height: 38, width: 117 }} />
            <p>Support AF Marbre &amp; {APP_NAME} : devis, suivi de chantier, facturation et assistance technique.</p>
          </div>
          <nav aria-label="Liens support et produit">
            <Link to="/">Accueil</Link>
            <Link to="/desktop">Bureau</Link>
            <Link to="/android">Android</Link>
            <Link to="/whats-new">Nouveautés</Link>
            <Link to="/about">À propos</Link>
            <Link to="/privacy">Confidentialité</Link>
            <Link to="/terms">Conditions</Link>
            <Link to="/licenses">Licences</Link>
            <Link to="/login">Se connecter</Link>
          </nav>
        </div>
        <div className="dl-foot-bottom">
          <span>© {new Date().getFullYear()} {APP_NAME} — tous droits réservés</span>
          <span>{APP_BUILD_DATE}</span>
        </div>
      </footer>
    </div>
  );
}
