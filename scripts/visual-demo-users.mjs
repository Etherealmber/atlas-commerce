// Verify the actual demo admin panel before taking a full-page screenshot:
// Chromium may resize/remount Settings during screenshot capture.
export async function assertDemoUserCreationDisabled(page) {
  const marker = '[data-visual-review="demo-user-create-disabled"]';
  try {
    await page.waitForSelector(marker, { visible: true, timeout: 30000 });
  } catch (cause) {
    const state = await page.evaluate(() => ({
      path: location.pathname,
      tab: new URLSearchParams(location.search).get('tab'),
      isDemo: (localStorage.getItem('stock_auth_token') || '').startsWith('atlasdemo.'),
      role: localStorage.getItem('stock_role') || '',
      hasSettingsError: Boolean(document.querySelector('.atlas-settings[role="alert"]')),
      hasCreateButton: Boolean(document.querySelector('[data-visual-review="user-create"]')),
    }));
    throw new Error(`Demo user restriction notice missing: ${JSON.stringify(state)}`, { cause });
  }
  if (await page.$('[data-visual-review="user-create"]')) {
    throw new Error('Demo must not offer user creation');
  }
}
