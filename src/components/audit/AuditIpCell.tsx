import { ShieldAlert, Smartphone, Server, Wifi } from 'lucide-react';
import { useLang } from '../../i18n/core';
import { cityName, countryName } from '../../i18n/places';
export { countryName } from '../../i18n/places';

export type IpGeo = {
  country?: string | null;
  city?: string | null;
  region?: string | null;
  asn?: number | null;
  as_org?: string | null;
  kind?: string;
  label?: string;
  risky?: boolean;
};

/** 🇲🇦 from "MA". */
export function flagEmoji(cc?: string | null): string {
  const c = String(cc || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/**
 * IP + city/country + network operator, with a VPN / proxy / hosting flag
 * (Grabify-style). The data comes from Cloudflare on the API calls; there is
 * no third-party lookup.
 */
export default function AuditIpCell({ ip, geo, compact = false }: { ip?: string | null; geo?: IpGeo | null; compact?: boolean }) {
  useLang();
  if (!ip) return <span className="ac-ip-cell is-empty">—</span>;
  const place = [cityName(geo?.city), countryName(geo?.country)].filter(Boolean).join(', ');
  const Icon = geo?.risky ? ShieldAlert : geo?.kind === 'mobile' ? Smartphone : geo?.kind === 'hosting' ? Server : Wifi;
  const tone = geo?.risky ? (geo.kind === 'hosting' ? 'warn' : 'danger') : 'ok';
  const title = [
    ip,
    place,
    geo?.as_org ? `${geo.as_org}${geo.asn ? ` · AS${geo.asn}` : ''}` : '',
    geo?.label || '',
  ].filter(Boolean).join('\n');
  return (
    <span className={`ac-ip-cell${compact ? ' is-compact' : ''}`} title={title}>
      <code className="ac-ip-addr" translate="no" dir="ltr">{ip}</code>
      {geo && (place || geo.as_org) ? (
        <span className="ac-ip-meta">
          {geo.country ? <span className="ac-ip-flag" aria-hidden="true">{flagEmoji(geo.country)}</span> : null}
          {place ? <bdi className="ac-ip-place" translate="no" dir="auto">{place}</bdi> : null}
        </span>
      ) : null}
      {geo?.label ? (
        <span className={`ac-ip-net ac-ip-net--${tone}`}>
          <Icon size={11} strokeWidth={2.2} aria-hidden="true" />
          <bdi dir="auto">{geo.risky ? geo.label : geo.as_org ? geo.as_org.slice(0, 28) : geo.label}</bdi>
        </span>
      ) : null}
    </span>
  );
}
