// The screenshot account is a demo: user creation is intentionally disabled.
export function visualDialogsForPage(code, device) {
  if (device === 'desktop' && code === '15-settings-categories') {
    return ['category-create', 'category-edit', 'unit-create', 'unit-edit'];
  }
  return [];
}
