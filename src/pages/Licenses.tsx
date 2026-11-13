import { Link } from 'react-router-dom';
import { isLoggedIn, isStockRole } from '../auth';

export default function Licenses() {
  return (
    <div className="privacy-page">
      <div className="privacy-inner">
        <p className="privacy-nav">
          <Link to={isLoggedIn() ? (isStockRole() ? '/products' : '/') : '/login'}>← Retour</Link>
          {' · '}<Link to="/privacy">Confidentialité</Link>
          {' · '}<Link to="/terms">Conditions</Link>
        </p>
        <h1>Licences</h1>
        <p>Atlas Commerce est proposé au choix sous la licence MIT ou la licence Apache 2.0
          (<code>MIT OR Apache-2.0</code>). Les composants tiers peuvent être soumis à leurs propres licences et avis.</p>
        <p>Copyright © 2026 loxdpsy. Les textes complets se trouvent dans le dépôt GitHub :</p>
        <ul>
          <li><a href="https://github.com/Etherealmber/atlas-commerce/blob/main/LICENSE">Licence MIT</a></li>
          <li><a href="https://github.com/Etherealmber/atlas-commerce/blob/main/LICENSE-APACHE">Licence Apache 2.0</a></li>
        </ul>
      </div>
    </div>
  );
}
