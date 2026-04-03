/**
 * Summarize a list of strings — show first two, then "+N" for the rest.
 * @param {string[]} items
 * @returns {string}
 */
export function summarizeList(items) {
  if (!items?.length) return '';
  if (items.length <= 2) return items.join(', ');
  return `${items.slice(0, 2).join(', ')} +${items.length - 2}`;
}
