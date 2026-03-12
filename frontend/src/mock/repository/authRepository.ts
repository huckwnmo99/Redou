import type { AuthSession, RegisterInput, SignInInput, WorkspaceUser } from "@/types/auth";

interface StoredUser extends WorkspaceUser {
  password: string;
  createdAt: string;
}

const SESSION_KEY = "redou.auth.session";
const USERS_KEY = "redou.auth.users";
const delay = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readUsers(): StoredUser[] {
  if (!canUseStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(USERS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as StoredUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    window.localStorage.removeItem(USERS_KEY);
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function readSession(): AuthSession | null {
  if (!canUseStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function writeSession(session: AuthSession | null) {
  if (!canUseStorage()) {
    return;
  }

  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
}

function toSession(user: StoredUser): AuthSession {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      workspaceName: user.workspaceName,
      planLabel: user.planLabel,
    },
    signedInAt: new Date().toISOString(),
  };
}

export const authRepository = {
  async getSession(): Promise<AuthSession | null> {
    await delay(80);
    return readSession();
  },

  async signIn(input: SignInInput): Promise<AuthSession> {
    await delay();
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = readUsers().find((item) => item.email.toLowerCase() === normalizedEmail);

    if (!user || user.password !== input.password) {
      throw new Error("Email or password does not match the workspace account.");
    }

    const session = toSession(user);
    writeSession(session);
    return session;
  },

  async register(input: RegisterInput): Promise<AuthSession> {
    await delay();
    const normalizedEmail = input.email.trim().toLowerCase();
    const users = readUsers();

    if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      throw new Error("This email is already registered in the workspace.");
    }

    const displayName = input.name.trim();
    const createdUser: StoredUser = {
      id: `u${Date.now()}`,
      name: displayName,
      email: normalizedEmail,
      password: input.password,
      workspaceName: `${displayName.split(" ")[0] || "Research"} Workspace`,
      planLabel: "Email",
      createdAt: new Date().toISOString(),
    };

    writeUsers([createdUser, ...users]);

    const session = toSession(createdUser);
    writeSession(session);
    return session;
  },

  async signOut(): Promise<void> {
    await delay(60);
    writeSession(null);
  },
};
