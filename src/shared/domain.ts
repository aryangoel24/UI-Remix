export function getDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    return parsed.hostname;
  } catch {
    return null;
  }
}

export function getCurrentDomain(): string {
  return window.location.hostname;
}
