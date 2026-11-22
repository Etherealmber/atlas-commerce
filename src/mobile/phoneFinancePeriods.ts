/** Recent finance periods anchored to the server-returned current period. */
export function financeMonths(current: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(current)) return [];
  const [year, month] = current.split('-').map(Number);
  return Array.from({ length: 24 }, (_, i) => {
    const date = new Date(year, month - 1 - i, 1);
    return { value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) };
  });
}
