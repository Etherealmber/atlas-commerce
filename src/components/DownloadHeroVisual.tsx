import ThemeShot from './ThemeShot';
import { useThemedShot } from '../lib/useDocTheme';

/** Real web screenshots with fictional data (not native-client captures). */
export default function DownloadHeroVisual({ platform }: { platform: 'android' | 'desktop' }) {
  const homeShot = useThemedShot('/shots/phone-home-demo.webp');
  const productsShot = useThemedShot('/shots/phone-products-demo.webp');
  return <figure className={`dl-ed-visual dl-ed-visual--${platform}`}>
    <div className="dl-ed-visual-inner">
      {platform === 'android' ? <>
        <img src={homeShot} width="390" height="844" alt="Tableau de bord web mobile avec données fictives" />
        <img src={productsShot} width="390" height="844" alt="Catalogue web mobile avec produits fictifs" />
      </> : <ThemeShot name="site-dashboard" alt="Tableau de bord web sur ordinateur avec données fictives" width={1280} height={800} eager />}
    </div>
    <figcaption>{platform === 'android' ? 'Captures réelles de l’interface web mobile · données fictives' : 'Capture réelle de l’interface web · données fictives · l’application bureau reprend la même interface'}</figcaption>
  </figure>;
}
