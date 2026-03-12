import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:55321";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SUPABASE_STORAGE_KEY = "redou.supabase.auth";

function canUseWebStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function forEachStorage(callback: (storage: Storage) => void) {
  if (!canUseWebStorage()) {
    return;
  }

  callback(window.localStorage);

  if (typeof window.sessionStorage !== "undefined") {
    callback(window.sessionStorage);
  }
}

function legacyAuthKeys(storage: Storage) {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) {
      continue;
    }

    if (/^sb-.*-auth-token$/.test(key) && key !== SUPABASE_STORAGE_KEY) {
      keys.push(key);
    }
  }

  return keys;
}

function purgeLegacySupabaseAuthStorage() {
  forEachStorage((storage) => {
    for (const key of legacyAuthKeys(storage)) {
      storage.removeItem(key);
    }
  });
}

export function clearPersistedSupabaseSession() {
  forEachStorage((storage) => {
    storage.removeItem(SUPABASE_STORAGE_KEY);

    for (const key of legacyAuthKeys(storage)) {
      storage.removeItem(key);
    }
  });
}

export function isInvalidRefreshTokenMessage(message: string | null | undefined) {
  const normalized = message?.toLowerCase() ?? "";
  return normalized.includes("invalid refresh token") || normalized.includes("refresh token not found");
}

purgeLegacySupabaseAuthStorage();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: SUPABASE_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
