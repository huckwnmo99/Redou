import {
  clearPersistedSupabaseSession,
  isInvalidRefreshTokenMessage,
  supabase,
} from "./supabase";
import type {
  AuthSession,
  RegisterInput,
  SignInInput,
  WorkspaceUser,
} from "@/types/auth";
import type { User } from "@supabase/supabase-js";

const DEFAULT_HIGHLIGHT_PRESETS = [
  { name: "Important", color_hex: "#F2C94C", description: "Key claim or result", sort_order: 1 },
  { name: "Method", color_hex: "#6FCF97", description: "Methods and experimental details", sort_order: 2 },
  { name: "Question", color_hex: "#56CCF2", description: "Open question or follow-up", sort_order: 3 },
  { name: "Concern", color_hex: "#EB5757", description: "Limitation, caveat, or conflict", sort_order: 4 },
];

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

function resolveProvider(user: User): string {
  return typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "email";
}

function resolveDisplayName(user: User): string {
  const rawName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name
          : user.email?.split("@")[0];

  return rawName?.trim() || "Researcher";
}

function resolveWorkspaceName(user: User): string {
  const explicitName =
    typeof user.user_metadata?.workspace_name === "string"
      ? user.user_metadata.workspace_name.trim()
      : "";

  if (explicitName) {
    return explicitName;
  }

  const displayName = resolveDisplayName(user);
  const shortName = displayName.split(" ")[0] || "Research";
  return `${shortName} Workspace`;
}

function resolvePlanLabel(user: User): string {
  return resolveProvider(user) === "google" ? "Google" : "Email";
}

function toWorkspaceUser(user: User): WorkspaceUser {
  return {
    id: user.id,
    name: resolveDisplayName(user),
    email: normalizeEmail(user.email),
    workspaceName: resolveWorkspaceName(user),
    planLabel: resolvePlanLabel(user),
  };
}

function toAuthSession(user: User): AuthSession {
  return {
    user: toWorkspaceUser(user),
    signedInAt: user.last_sign_in_at ?? new Date().toISOString(),
  };
}

function googleRedirectUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const protocol = window.location.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return null;
  }

  return `${window.location.origin}/`;
}

function toUserFacingError(error: Error, fallback: string): Error {
  const message = error.message.toLowerCase();

  if (message.includes("provider is not enabled") || message.includes("unsupported provider")) {
    return new Error("Google sign-in is visible in the UI, but the Google provider is not configured in local Supabase yet.");
  }

  if (message.includes("redirect")) {
    return new Error("Google sign-in needs a browser-based redirect URL that is allowed by local Supabase.");
  }

  return new Error(error.message || fallback);
}

async function recoverFromAuthError(message: string | null | undefined) {
  if (!isInvalidRefreshTokenMessage(message)) {
    return false;
  }

  clearPersistedSupabaseSession();

  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Local cleanup is enough here; the remote token is already invalid.
  }

  return true;
}

async function ensureAppUser(user: User): Promise<boolean> {
  // Ensure the JWT is actually set before making DB calls (fixes 401 race condition)
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.warn("[ensureAppUser] No active session — skipping profile upsert");
    return false;
  }

  const { error } = await supabase.from("app_users").upsert(
    {
      id: user.id,
      display_name: resolveDisplayName(user),
      email: normalizeEmail(user.email) || null,
      auth_provider: resolveProvider(user),
      role: "owner",
    },
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(`Unable to prepare the workspace profile: ${error.message}`);
  }

  return true;
}

async function ensureDefaultHighlightPresets(userId: string) {
  const { count, error: countError } = await supabase
    .from("highlight_presets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    throw new Error(`Unable to inspect highlight presets: ${countError.message}`);
  }

  if ((count ?? 0) > 0) {
    return;
  }

  const { error } = await supabase.from("highlight_presets").insert(
    DEFAULT_HIGHLIGHT_PRESETS.map((preset) => ({
      user_id: userId,
      ...preset,
      is_system_default: true,
      is_active: true,
    })),
  );

  if (error) {
    throw new Error(`Unable to prepare default highlight presets: ${error.message}`);
  }
}

async function bootstrapWorkspaceUser(user: User) {
  const isReady = await ensureAppUser(user);
  if (!isReady) {
    return;
  }
  await ensureDefaultHighlightPresets(user.id);
}

export const supabaseAuthRepository = {
  async getSession(): Promise<AuthSession | null> {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      const recovered = await recoverFromAuthError(error.message);
      if (recovered) {
        return null;
      }

      return null;
    }

    if (!session) {
      return null;
    }

    await bootstrapWorkspaceUser(session.user);
    return toAuthSession(session.user);
  },

  async signIn(input: SignInInput): Promise<AuthSession> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(input.email),
      password: input.password,
    });

    if (error || !data.user) {
      await recoverFromAuthError(error?.message);
      throw new Error(error?.message ?? "Unable to sign in right now.");
    }

    await bootstrapWorkspaceUser(data.user);
    return toAuthSession(data.user);
  },

  async register(input: RegisterInput): Promise<AuthSession> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();

    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: {
        data: {
          display_name: name,
          workspace_name: `${name.split(" ")[0] || "Research"} Workspace`,
        },
      },
    });

    if (error) {
      await recoverFromAuthError(error.message);
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error("Registration failed.");
    }

    await bootstrapWorkspaceUser(data.user);
    return toAuthSession(data.user);
  },

  async signInWithGoogle(): Promise<void> {
    // Electron desktop: use IPC-based OAuth flow (opens system browser, local callback server)
    const desktopApi = window.redouDesktop;
    if (desktopApi?.auth?.googleSignIn) {
      const result = await desktopApi.auth.googleSignIn();
      if (!result.success || !result.data) {
        throw new Error(result.error ?? "Google sign-in failed.");
      }

      const { error } = await supabase.auth.setSession({
        access_token: result.data.accessToken,
        refresh_token: result.data.refreshToken,
      });

      if (error) {
        throw toUserFacingError(error, "Unable to complete Google sign-in.");
      }

      return;
    }

    // Browser: use standard OAuth redirect flow
    const redirectTo = googleRedirectUrl();

    if (!redirectTo) {
      throw new Error("Google sign-in is not available in this environment.");
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          prompt: "select_account",
        },
      },
    });

    if (error) {
      await recoverFromAuthError(error.message);
      throw toUserFacingError(error, "Unable to start Google sign-in right now.");
    }
  },

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    clearPersistedSupabaseSession();

    if (error) {
      throw new Error(error.message);
    }
  },
};
