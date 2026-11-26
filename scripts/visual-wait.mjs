/** Wait until visible loading placeholders have been absent continuously.
 * Returning false marks an incomplete capture instead of presenting it as ready. */
export async function waitForVisualReady(page, { timeout = 20000, stableMs = 1000 } = {}) {
  await page.evaluate(() => { delete window.__atlasVisualReadySince; });
  try {
    await page.waitForFunction((stable) => {
      const selectors = '.skeleton, .ph-skeleton, .page-skeleton, .ac-skeleton-table-wrap, [aria-busy="true"]';
      const busy = [...document.querySelectorAll(selectors)].some((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });
      if (busy || document.readyState !== 'complete') { delete window.__atlasVisualReadySince; return false; }
      window.__atlasVisualReadySince ||= Date.now();
      return Date.now() - window.__atlasVisualReadySince >= stable;
    }, { timeout, polling: 200 }, stableMs);
    return true;
  } catch (error) {
    if (error?.name === 'TimeoutError') return false;
    throw error;
  }
}
