/** Heuristic only: collect potentially French UI in an isolated demo capture.
 * Never inspect form values, opted-out content, code, or explicitly marked user data.
 * A hit is not proof of an untranslated string and absence is not proof of coverage. */
export function findVisibleFrenchCandidates() {
  const skip = '[translate="no"], [data-no-i18n], [data-user-data], .notranslate, code, pre, kbd, samp, svg, [contenteditable="true"], .pc-name, .hl-pname, .ia-name, .ph-employee-name, .wn-contributor-name, .ac-number-link, .cell-product, .cell-client, .client-name, .product-name';
  const french = /[àâçéèêëîïôùûüÿœ]|\b(?:chargement|enregistrer|annuler|ajouter|aucun|aucune|rechercher|veuillez|impossible|données|paramètres|factures|produits|clients|utilisateur|catégorie|unités|réessayer|accueil|supprimer|modifier)\b/i;
  const found = new Map();
  function visible(el) {
    if (!el || el.closest(skip)) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }
  function add(value, kind) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 180 || !french.test(text)) return;
    const key = `${kind}:${text}`;
    found.set(key, { kind, text, count: (found.get(key)?.count || 0) + 1 });
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE && !node.parentElement?.matches('textarea, input') && visible(node.parentElement)) add(node.nodeValue, 'text');
    else if (node.nodeType === Node.ELEMENT_NODE && visible(node)) {
      for (const attr of ['aria-label', 'title', 'alt', 'placeholder']) add(node.getAttribute(attr), attr);
    }
  }
  return [...found.values()].slice(0, 200);
}
