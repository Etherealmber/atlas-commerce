import { useState, type MouseEvent } from 'react';
import ImageLightbox from './ui/ImageLightbox';
import { themedShotSrc, useDocTheme } from '../lib/useDocTheme';

/** Web captures use local synthetic fixtures; they are not native client screenshots. */
export default function DownloadPreview({ platform }: { platform: 'android' | 'desktop' }) {
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  // Captures follow the site theme (dark page → dark screenshots).
  const theme = useDocTheme();
  const shot = (src: string) => themedShotSrc(src, theme);
  const openCapture = (e: MouseEvent<HTMLAnchorElement>, src: string, name: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setLightbox({ src, name });
  };
  return <section id="apercu" className={`dl-preview dl-preview--${platform}`} aria-labelledby={`dl-preview-${platform}`}>
    <div className="dl-container">
      <div className="dl-preview-intro">
        <div><p className="dl-preview-eyebrow">03 / APERÇU</p>
          <h2 className="dl-sec-title" id={`dl-preview-${platform}`}>{platform === 'android' ? 'Votre activité en poche.' : 'Un espace pour votre activité.'}</h2>
        </div>
        <p>{platform === 'android' ? 'Consultez votre catalogue et vos mouvements depuis une interface adaptée au téléphone.' : 'Suivez vos produits et leurs niveaux de stock depuis votre ordinateur.'}</p>
      </div>
      {platform === 'android' ? <div className="dl-preview-phones">
        <figure className="dl-shot-card"><a href={shot('/shots/phone-products-demo.webp')} target="_blank" rel="noopener noreferrer" aria-label="Agrandir l’aperçu du catalogue web mobile" onClick={(e) => openCapture(e, shot('/shots/phone-products-demo.webp'), 'Catalogue web mobile — Aperçu')}><img src={shot('/shots/phone-products-demo.webp')} width="390" height="844" loading="lazy" decoding="async" alt="Catalogue web mobile avec produits fictifs" /></a><figcaption><strong>01 · Vos produits</strong><span>Retrouvez les références et le stock.</span></figcaption></figure>
        <figure className="dl-shot-card"><a href={shot('/shots/phone-balance-demo.webp')} target="_blank" rel="noopener noreferrer" aria-label="Agrandir l’aperçu de la balance web mobile" onClick={(e) => openCapture(e, shot('/shots/phone-balance-demo.webp'), 'Balance web mobile — Aperçu')}><img src={shot('/shots/phone-balance-demo.webp')} width="390" height="844" loading="lazy" decoding="async" alt="Balance web mobile avec mouvements fictifs" /></a><figcaption><strong>02 · Votre balance</strong><span>Gardez un œil sur les mouvements.</span></figcaption></figure>
      </div> : <figure className="dl-preview-desktop dl-shot-card"><a href={shot('/shots/desktop-products-demo.webp')} target="_blank" rel="noopener noreferrer" aria-label="Agrandir l’aperçu du catalogue web sur ordinateur" onClick={(e) => openCapture(e, shot('/shots/desktop-products-demo.webp'), 'Produits & stock — Aperçu ordinateur')}><img src={shot('/shots/desktop-products-demo.webp')} width="1440" height="900" loading="lazy" decoding="async" alt="Catalogue web sur ordinateur avec produits et stocks fictifs" /></a><figcaption><strong>Produits &amp; stock</strong><span>Vos références et alertes dans une seule vue.</span></figcaption></figure>}
      <p className="dl-preview-note">Captures de l’interface web dans le thème de la page, avec des données fictives. Les applications Android et bureau peuvent différer selon leur version et vos permissions. Sélectionnez une image pour l’agrandir.</p>
    </div>
    {lightbox && <ImageLightbox src={lightbox.src} name={lightbox.name} onClose={() => setLightbox(null)} />}
  </section>;
}
