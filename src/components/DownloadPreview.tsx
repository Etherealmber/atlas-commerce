/** Static, anonymized illustrations; no account data or live API is loaded. */
export default function DownloadPreview({ platform }: { platform: 'android' | 'desktop' }) {
  return <section className={`dl-preview dl-preview--${platform}`} aria-labelledby={`dl-preview-${platform}`}>
    <div className="dl-container">
      <p className="dl-preview-eyebrow">EN UN COUP D’ŒIL</p>
      <h2 className="dl-sec-title" id={`dl-preview-${platform}`}>{platform === 'android' ? 'Atlas sur le terrain' : 'Votre espace de travail'}</h2>
      <p className="dl-sec-sub">{platform === 'android' ? 'Scannez un article et consultez votre activité depuis votre téléphone.' : 'Découvrez l’interface web sur ordinateur, avec des données fictives.'}</p>
      {platform === 'android' ? <div className="dl-preview-phones">
        <figure><img src="/shots/android-scan-demo.webp" width="516" height="785" loading="lazy" alt="Application Android : écran de scan avec caméra en pause" /><figcaption>Scanner un article</figcaption></figure>
        <figure><img src="/shots/android-balance-demo.webp" width="538" height="799" loading="lazy" alt="Application Android : aperçu des transactions et soldes" /><figcaption>Consulter la balance</figcaption></figure>
      </div> : <figure className="dl-preview-desktop"><img src="/shots/desktop-demo.webp" width="1280" height="800" loading="lazy" alt="Tableau de bord sur ordinateur avec des données de démonstration" /><figcaption>Interface web sur ordinateur · données fictives de démonstration</figcaption></figure>}
      <p className="dl-preview-note">Aperçus en thème clair. Les écrans peuvent évoluer selon la version et les permissions.</p>
    </div>
  </section>;
}
