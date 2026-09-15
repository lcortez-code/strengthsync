/** Bound public pagination before it reaches database offsets or allocation limits. */
export function boundedPageNumber(value: string | null, fallback: number, maximum: number): number {
  if (!value || !/^\d{1,10}$/.test(value)) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}
