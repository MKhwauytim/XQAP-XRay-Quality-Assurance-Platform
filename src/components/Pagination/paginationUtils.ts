export const DATA_PAGE_SIZE = 100;

export function clampPage(page: number, totalItems: number, pageSize = DATA_PAGE_SIZE): number {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return Math.min(Math.max(1, page), totalPages);
}

export function pageSlice<T>(items: T[], page: number, pageSize = DATA_PAGE_SIZE): T[] {
  const safePage = clampPage(page, items.length, pageSize);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
