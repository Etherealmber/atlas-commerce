/** Settings search — full index + fuzzy (Windows/Linear style). */
type SettingsSearchHit = { id: string; tab: string; label: string; keywords: string };

export const SETTINGS_SEARCH_INDEX: SettingsSearchHit[] = [
  { id: 'profile_photo', tab: 'profile', label: 'Photo de profil', keywords: 'photo avatar image profil' },
  { id: 'display_name', tab: 'profile', label: 'Nom affiché', keywords: 'nom affiche display name profil' },
  { id: 'profile_email', tab: 'profile', label: 'E-mail du profil', keywords: 'email mail profil contact' },
  { id: 'profile_phone', tab: 'profile', label: 'Téléphone du profil', keywords: 'telephone tel profil' },
  { id: 'profile_notes', tab: 'profile', label: 'Note personnelle', keywords: 'note personnelle profil' },
  { id: 'passkeys', tab: 'profile', label: 'Clés d\'accès (passkeys)', keywords: 'passkey webauthn biometrie cle acces fido' },
  { id: 'webauthn', tab: 'profile', label: 'Sécurité WebAuthn / FIDO2', keywords: 'webauthn fido attestation pin biometrie' },
  { id: 'company_name', tab: 'company', label: 'Nom de la société', keywords: 'nom societe entreprise raison sociale' },
  { id: 'legal_form', tab: 'company', label: 'Forme juridique', keywords: 'forme juridique sarl sa auto entrepreneur' },
  { id: 'company_address', tab: 'company', label: 'Adresse', keywords: 'adresse rue' },
  { id: 'company_city', tab: 'company', label: 'Ville', keywords: 'ville city' },
  { id: 'company_postal', tab: 'company', label: 'Code postal', keywords: 'code postal cp' },
  { id: 'company_country', tab: 'company', label: 'Pays', keywords: 'pays country maroc' },
  { id: 'company_contact', tab: 'company', label: 'Téléphone société', keywords: 'telephone tel societe' },
  { id: 'company_email', tab: 'company', label: 'E-mail société', keywords: 'email mail societe' },
  { id: 'company_website', tab: 'company', label: 'Site web', keywords: 'site web website url' },
  { id: 'company_logo', tab: 'company', label: 'Logo', keywords: 'logo image marque url logo_url' },
  { id: 'attendance_enabled', tab: 'attendance', label: 'Activer la présence', keywords: 'activer presence attendance enable pointage' },
  { id: 'attendance_rules', tab: 'attendance', label: 'Règles de présence et paie', keywords: 'regles retard paie acompte cycle presence' },
  { id: 'ice', tab: 'legal', label: 'ICE', keywords: 'ice identifiant commun entreprise' },
  { id: 'rc', tab: 'legal', label: 'Registre de commerce (RC)', keywords: 'rc registre commerce' },
  { id: 'patente', tab: 'legal', label: 'Patente', keywords: 'patente taxe professionnelle' },
  { id: 'if_fiscal', tab: 'legal', label: 'Identifiant fiscal (IF)', keywords: 'if identifiant fiscal' },
  { id: 'cnss', tab: 'legal', label: 'CNSS', keywords: 'cnss social' },
  { id: 'legal_footer', tab: 'legal', label: 'Mentions légales documents', keywords: 'mentions legales pied page' },
  { id: 'numbering', tab: 'invoicing', label: 'Style de numérotation', keywords: 'numerotation style sequence maroc' },
  { id: 'number_pad', tab: 'invoicing', label: 'Nombre de chiffres (séquence)', keywords: 'chiffres pad sequence zeros' },
  { id: 'prefixes', tab: 'invoicing', label: 'Préfixe factures de vente', keywords: 'prefixe facture fa vente' },
  { id: 'employee_prefix', tab: 'invoicing', label: 'Préfixe employés', keywords: 'prefixe employe emp' },
  { id: 'prefix_quote', tab: 'invoicing', label: 'Préfixe devis', keywords: 'prefixe devis quote' },
  { id: 'prefix_bill', tab: 'invoicing', label: 'Préfixe factures d\'achat', keywords: 'prefixe achat bill' },
  { id: 'prefix_receipt', tab: 'invoicing', label: 'Préfixe reçus', keywords: 'prefixe recu receipt' },
  { id: 'prefix_wr', tab: 'invoicing', label: 'Préfixe remboursements (WR)', keywords: 'prefixe remboursement wr' },
  { id: 'prefix_qs', tab: 'invoicing', label: 'Préfixe ventes rapides', keywords: 'prefixe vente rapide caisse qs' },
  { id: 'next_invoice', tab: 'invoicing', label: 'Prochain n° facture', keywords: 'prochain numero facture' },
  { id: 'next_quote', tab: 'invoicing', label: 'Prochain n° devis', keywords: 'prochain numero devis' },
  { id: 'next_employee', tab: 'invoicing', label: 'Prochain n° employé', keywords: 'prochain numero employe' },
  { id: 'tax_rate', tab: 'invoicing', label: 'Taux de TVA', keywords: 'tva tax taux' },
  { id: 'currency', tab: 'invoicing', label: 'Devise', keywords: 'devise currency mad euro' },
  { id: 'doc-preview', tab: 'invoicing', label: 'Aperçus documents (démo)', keywords: 'apercu preview facture devis' },
  { id: 'pdf_accent', tab: 'documents', label: 'Couleur d\'accent PDF', keywords: 'couleur accent hex pdf' },
  { id: 'pdf_footer', tab: 'documents', label: 'Texte bas de page PDF', keywords: 'bas de page footer pdf' },
  { id: 'pdf_signature', tab: 'documents', label: 'Signature société', keywords: 'signature image pdf' },
  { id: 'pdf_stamp', tab: 'documents', label: 'Cachet / tampon', keywords: 'cachet tampon stamp' },
  { id: 'pdf_options', tab: 'documents', label: 'Options d\'impression PDF', keywords: 'options pdf logo qr banque' },
  { id: 'warehouse_main', tab: 'warehouse', label: 'Entrepôts et emplacements', keywords: 'entrepot stock magasin emplacement' },
  { id: 'sales_location', tab: 'warehouse', label: 'Emplacement ventes', keywords: 'sales_location vente' },
  { id: 'purchase_location', tab: 'warehouse', label: 'Emplacement achats', keywords: 'purchase_location achat' },
  { id: 'valuation', tab: 'warehouse', label: 'Méthode de valorisation stock', keywords: 'valorisation stock cmp fifo' },
  { id: 'categories_list', tab: 'categories', label: 'Catégories produits', keywords: 'categorie produit catalogue' },
  { id: 'integrations_api', tab: 'integrations', label: 'API / intégrations', keywords: 'api integration webhook' },
  { id: 'atlas_agent', tab: 'agent', label: 'Atlas Agent · Groq', keywords: 'atlas agent groq ia cle key modele' },
  { id: 'agent_knowledge', tab: 'agent', label: 'Mémoire & savoir de l’Agent (mémoire, contexte, garde-fous, outils, RAG)', keywords: 'memoire memory rag connaissances outils garde-fous contexte agent knowledge docs documents' },
  { id: 'agent_permissions', tab: 'agent', label: 'Permissions Atlas Agent', keywords: 'permissions outils agent modes acces complet lecture seule' },
  { id: 'agent_security', tab: 'agent', label: 'Atlas Agent & Sécurité (quotas, 2FA, accès utilisateurs, appareils)', keywords: 'securite quota jetons 2fa otp appareils acces suspendre retablir comptes agent' },
  { id: 'backup', tab: 'admin', label: 'Sauvegarde et restauration', keywords: 'sauvegarde restore backup' },
  { id: 'users', tab: 'admin', label: 'Utilisateurs et rôles', keywords: 'utilisateur role equipe admin' },
  { id: 'danger', tab: 'admin', label: 'Zone sensible', keywords: 'danger export reset parametres' },
  { id: 'period_lock', tab: 'admin', label: 'Clôture de période', keywords: 'cloture periode lock mois' },
  { id: 'sec-audit', tab: 'audit', label: 'Journal d\'audit', keywords: 'audit journal historique log' },
];



















