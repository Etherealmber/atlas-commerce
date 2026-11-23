export default function Licenses() {
  return (
    <div className="privacy-page">
      <div className="privacy-inner">
        <h1>Licences</h1>
        <p>Atlas Commerce est proposé au choix sous la licence MIT ou la licence Apache 2.0
          (<code>MIT OR Apache-2.0</code>). Les composants tiers peuvent être soumis à leurs propres licences et avis.</p>
        <p>Copyright © {new Date().getUTCFullYear() > 2026 ? `2026–${new Date().getUTCFullYear()}` : '2026'} Etherealmber. Les textes complets se trouvent dans le dépôt GitHub :</p>
        <ul>
          <li><a href="https://github.com/Etherealmber/atlas-commerce/blob/main/LICENSE">Licence MIT</a></li>
          <li><a href="https://github.com/Etherealmber/atlas-commerce/blob/main/LICENSE-APACHE">Licence Apache 2.0</a></li>
        </ul>
      </div>
    </div>
  );
}
