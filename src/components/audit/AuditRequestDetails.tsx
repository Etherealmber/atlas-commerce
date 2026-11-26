import { cityName, countryName } from '../../i18n/places';

type Row = Record<string, any>;
/** Only render values actually supplied by the journal; never infer private-mode or hardware. */
export function AuditRequestDetails({ row, kind }: { row: Row; kind: 'audit' | 'api' }) {
  const geo = kind === 'audit' ? row.geo || {} : row;
  const fields: [string, unknown][] = [
    ['Date / heure (UTC)', row.created_at], ['Adresse IP', row.ip],
    ['Pays', countryName(geo.country)], ['Ville', cityName(geo.city)], ['Région', geo.region],
    ['Fournisseur réseau', geo.as_org], ['ASN', geo.asn],
    ['Orientation', null], ['Fuseau horaire', null], ['Heure locale de l’utilisateur', null],
    ['Langue du navigateur', null], ['Navigation privée', null], ['Bloqueur de publicité', null],
    ['Taille de l’écran', null], ['Fréquence de l’écran', null], ['Thème de couleur', null],
    ['Écran HDR', null], ['Processeur graphique', null], ['Navigateur', null],
    ['Système d’exploitation', null], ['Écran tactile', null], ['Canal', row.surface],
    ['Adresse de provenance', null], ['Nom d’hôte', null], ['Agent utilisateur', row.ua],
  ];
  return <>
    {kind === 'audit' && <p className="audit-geo-note">Le lieu et le réseau proviennent du dernier appel API associé à cette IP ; ils peuvent différer de ceux de l’événement.</p>}
    <dl className="audit-detail-dl audit-device-details">
      {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null || value === '' ? <span>Non disponible</span> : <bdi dir={label === 'Adresse IP' || label === 'Date / heure (UTC)' || label === 'ASN' ? 'ltr' : 'auto'} translate="no">{String(value)}</bdi>}</dd></div>)}
    </dl>
    <p className="audit-geo-note">Les informations non enregistrées ne peuvent pas être déduites de cet événement.</p>
  </>;
}
