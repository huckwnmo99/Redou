export type AppLocale = "en" | "ko";

const LOCALE_STORAGE_KEY = "redou.locale";

export const localeOptions: { value: AppLocale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
];

export function localeText(locale: AppLocale, english: string, korean: string): string {
  return locale === "ko" ? korean : english;
}

export function resolveInitialLocale(): AppLocale {
  if (typeof window === "undefined") {
    return "en";
  }

  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "ko") {
      return stored;
    }
  } catch {
    // Ignore storage access failures and fall back to browser locale.
  }

  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko")) {
    return "ko";
  }

  return "en";
}

export function persistLocale(locale: AppLocale) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage access failures.
  }
}

export function syncDocumentLocale(locale: AppLocale) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.lang = locale;
}
