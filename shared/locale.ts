export function normalizeLocale(value: string): string | undefined {
  if (!value || value.length > 100) return;
  try {
    return new Intl.Locale(value).toString();
  } catch {
    return;
  }
}
