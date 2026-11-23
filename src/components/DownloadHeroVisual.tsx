/** The illustration uses web screenshots with fictional data, not native-client captures. */
export default function DownloadHeroVisual({ platform }: { platform: 'android' | 'desktop' }) {
  return <figure className={`dl-ed-visual dl-ed-visual--${platform}`}>
    <div className="dl-ed-visual-inner">
      {platform === 'android' ? <>
        <img src="/shots/phone-home-demo.webp" width="390" height="844" alt="Tableau de bord web mobile avec données fictives" />
        <img src="/shots/phone-products-demo.webp" width="390" height="844" alt="Catalogue web mobile avec produits fictifs" />
      </> : <img src="/shots/desktop-demo.webp" width="1440" height="900" alt="Tableau de bord web sur ordinateur avec données fictives" />}
    </div>
    <figcaption>Interface web en thème clair · données fictives · les applications natives peuvent différer</figcaption>
  </figure>;
}
