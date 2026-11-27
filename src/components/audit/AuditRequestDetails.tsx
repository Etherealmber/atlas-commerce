import { cityName, countryName } from '../../i18n/places';

type Row = Record<string, any>;
/** Only render values actually supplied by the journal; never infer private-mode or hardware. */
export function AuditRequestDetails({ row, kind }: { row: Row; kind: 'audit' | 'api' }) {
  const device = kind === 'api' && row.device_context && typeof row.device_context === 'object' ? row.device_context : {};
  let localTime: string | null = null;
  if (typeof device.timezone === 'string' && row.created_at) {
    try { const d = new Date(row.created_at); if (Number.isFinite(d.getTime())) localTime = new Intl.DateTimeFormat(undefined, { timeZone: device.timezone, dateStyle: 'short', timeStyle: 'medium' }).format(d); } catch { /* invalid or unsupported timezone */ }
  }
  const geo = kind === 'audit' ? row.geo || {} : row;
  const fields: [string, unknown][] = [
    ['Date / heure (UTC)', row.created_at], ['Adresse IP', row.ip],
    ['Pays', countryName(geo.country)], ['Ville', cityName(geo.city)], ['Région', geo.region],
    ['Fournisseur réseau', geo.as_org], ['ASN', geo.asn],
    ['Orientation', device.orientation], ['Fuseau horaire', device.timezone], ['Heure locale de l’utilisateur', localTime],
    ['Langue du navigateur', device.language], ['Navigation privée', null], ['Bloqueur de publicité', null],
    ['Taille de l’écran', Number.isInteger(device.screen_width) && Number.isInteger(device.screen_height) ? `${device.screen_width} × ${device.screen_height} px` : null], ['Fréquence de l’écran', null], ['Thème de couleur', device.theme],
    ['Écran HDR', null], ['Processeur graphique', null], ['Navigateur', null],
    ['Système d’exploitation', null], ['Écran tactile', typeof device.touch === 'boolean' ? (device.touch ? 'Oui' : 'Non') : null], ['Canal', row.surface],
    ['Adresse de provenance', null], ['Nom d’hôte', null], ['Agent utilisateur', row.ua],
  ];
  const available = fields.filter(([, value]) => value != null && value !== '');
  const missing = fields.filter(([, value]) => value == null || value === '');
  const renderFields = (items: [string, unknown][]) => <dl className="audit-detail-dl audit-device-details">
    {items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null || value === '' ? <span>Non disponible</span> : <bdi dir={label === 'Adresse IP' || label === 'Date / heure (UTC)' || label === 'ASN' ? 'ltr' : 'auto'} translate="no">{String(value)}</bdi>}</dd></div>)}
  </dl>;
  return <section className="audit-connection-details">
    {kind === 'audit' && row.geo && <p className="audit-geo-note">Le lieu et le réseau proviennent du dernier appel API associé à cette IP ; ils peuvent différer de ceux de l’événement.</p>}
    {Object.keys(device).length > 0 && <p className="audit-geo-note">Les informations de l’appareil sont déclarées par le navigateur et peuvent être inexactes ou modifiées.</p>}
    {available.length ? renderFields(available) : <p>Aucune information de connexion enregistrée.</p>}
    {missing.length > 0 && <details className="audit-missing-details"><summary>Informations non enregistrées</summary>
      <p className="audit-geo-note">Les informations non enregistrées ne peuvent pas être déduites de cet événement.</p>
      {renderFields(missing)}
    </details>}
  </section>;
}
