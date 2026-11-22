/** Local light-theme captures with anonymized or fictional data. */
export default function DownloadPreview({ platform }: { platform: 'android' | 'desktop' }) {
  return <section className={`dl-preview dl-preview--${platform}`} aria-labelledby={`dl-preview-${platform}`}>
    <div className="dl-container">
      <p className="dl-preview-eyebrow">01 / EN UN COUP D’ŒIL</p>
      <h2 className="dl-sec-title" id={`dl-preview-${platform}`}>{platform === 'android' ? 'Atlas sur le terrain' : 'Votre espace de travail'}</h2>
      <p className="dl-sec-sub">{platform === 'android' ? 'Du scan au suivi de l’activité, retrouvez vos outils sur téléphone.' : 'Découvrez l’interface web sur ordinateur, avec des données fictives.'}</p>
      {platform === 'android' ? <>
        <div className="dl-preview-phones">
          <figure><img src="/shots/android-scan-demo.webp" width="516" height="785" loading="lazy" alt="Application Android : écran de scan avec caméra en pause" /><figcaption>Android natif · Scanner</figcaption></figure>
          <figure><img src="/shots/android-balance-demo.webp" width="538" height="799" loading="lazy" alt="Application Android : aperçu des transactions et soldes" /><figcaption>Android natif · Balance</figcaption></figure>
          <figure><img src="/shots/phone-home-demo.webp" width="390" height="844" loading="lazy" alt="Interface web mobile : tableau de bord avec données fictives" /><figcaption>Web mobile · Tableau de bord</figcaption></figure>
          <figure><img src="/shots/phone-products-demo.webp" width="390" height="844" loading="lazy" alt="Interface web mobile : catalogue de produits fictifs" /><figcaption>Web mobile · Produits</figcaption></figure>
        </div>
      </> : <figure className="dl-preview-desktop"><img src="/shots/desktop-demo.webp" width="1280" height="800" loading="lazy" alt="Tableau de bord web sur ordinateur avec des données de démonstration" /><figcaption>Interface web sur ordinateur · données fictives de démonstration</figcaption></figure>}
      <p className="dl-preview-note">Aperçus en thème clair : captures Android anonymisées et interface web avec données fictives. Les écrans peuvent évoluer selon la version et les permissions.</p>
    </div>
  </section>;
}
