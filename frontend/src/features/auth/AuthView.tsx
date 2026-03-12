import { ArrowRight, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useState } from "react";
import { useRegister, useSignIn, useSignInWithGoogle } from "@/lib/auth";
import { useDesktopRuntime } from "@/lib/desktop";
import { localeText } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";

type AuthMode = "signin" | "register";

interface FormState {
  name: string;
  email: string;
  password: string;
}

const initialState: FormState = {
  name: "",
  email: "",
  password: "",
};

function canUseGoogleOAuth() {
  if (typeof window === "undefined") {
    return false;
  }

  // Desktop: use IPC-based OAuth flow
  if (window.redouDesktop?.auth?.googleSignIn) {
    return true;
  }

  // Browser: standard redirect
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

export function AuthView() {
  const locale = useUIStore((state) => state.locale);
  const t = (english: string, korean: string) => localeText(locale, english, korean);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [form, setForm] = useState<FormState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const signIn = useSignIn();
  const register = useRegister();
  const signInWithGoogle = useSignInWithGoogle();
  const { data: desktop } = useDesktopRuntime();
  const desktopReady = desktop?.available ?? false;
  const googleAvailable = canUseGoogleOAuth();
  const pending = signIn.isPending || register.isPending || signInWithGoogle.isPending;


  const googleHelper = desktopReady
    ? t(
        "Opens Google sign-in in your default browser, then returns the session to Electron.",
        "기본 브라우저에서 Google 로그인을 열고, 세션을 Electron으로 가져옵니다.",
      )
    : t(
        "If local Supabase does not have Google configured yet, this button will show a setup error instead of continuing.",
        "로컬 Supabase에 Google provider가 아직 설정되지 않았다면 이 버튼은 로그인 대신 설정 오류를 보여줍니다.",
      );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!form.email.trim() || !form.password.trim()) {
      setError(t("Email and password are required.", "이메일과 비밀번호를 입력해주세요."));
      return;
    }

    if (mode === "register" && !form.name.trim()) {
      setError(t("Name is required to create an account.", "계정을 만들려면 이름이 필요합니다."));
      return;
    }

    if (form.password.trim().length < 8) {
      setError(t("Use at least 8 characters for the password.", "비밀번호는 8자 이상으로 입력해주세요."));
      return;
    }

    try {
      if (mode === "signin") {
        await signIn.mutateAsync({
          email: form.email,
          password: form.password,
        });
        return;
      }

      await register.mutateAsync({
        name: form.name,
        email: form.email,
        password: form.password,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Unable to continue right now.", "지금은 계속 진행할 수 없습니다."));
    }
  }

  async function handleGoogleSignIn() {
    setError(null);

    try {
      await signInWithGoogle.mutateAsync();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Unable to start Google sign-in.", "Google 로그인을 시작할 수 없습니다."));
    }
  }

  return (
    <div style={shellStyle}>
      <div style={orbStyle("8%", "10%", 300, "rgba(37, 99, 235, 0.16)")} />
      <div style={orbStyle("74%", "78%", 260, "rgba(15, 118, 110, 0.12)")} />

      <div style={layoutStyle}>
        <section style={introPanelStyle}>
          <div style={brandPillStyle}>
            <div style={brandMarkStyle}>R</div>
            <div style={{ display: "grid", gap: 2 }}>
              <span style={brandEyebrowStyle}>Redou</span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{desktopReady ? "Electron desktop runtime" : "Browser renderer"}</span>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <h1 style={titleStyle}>Start with a clean research workspace.</h1>
            <p style={copyStyle}>
              There is no preloaded account or sample library now. Create the first account for this machine or continue with Google when local OAuth is ready.
            </p>
          </div>

          <div style={statusCardStyle}>
            <div style={statusChipStyle}>
              <ShieldCheck size={14} />
              {desktopReady ? "Desktop shell active" : "Browser preview mode"}
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              {desktopReady
                ? `Connected${desktop?.version ? ` · v${desktop.version}` : ""}${desktop?.platform ? ` · ${desktop.platform}` : ""}`
                : "Core reading, notes, figures, and search flows are ready behind this sign-in screen."}
            </div>
          </div>

          <div style={bulletGridStyle}>
            <InfoBullet
              title="No sample library"
              description="The workspace now opens clean so imported PDFs define the first real dataset."
            />
            <InfoBullet
              title="Email or Google entry"
              description="Create a local account immediately, or use Google once the local provider is configured."
            />
            <InfoBullet
              title="Built for desktop reading"
              description="Library, PDF reader, notes, search, and figures stay in one workspace model."
            />
          </div>
        </section>
        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 10 }}>
            <span style={cardEyebrowStyle}>{t("Secure access", "안전한 접근")}</span>
            <h2 style={cardTitleStyle}>{mode === "signin" ? t("Sign in to Redou", "Redou에 로그인") : t("Create your first account", "첫 계정 만들기")}</h2>
            <p style={cardCopyStyle}>
              {mode === "signin"
                ? t(
                    "Use your workspace email or continue with Google. The toggle is intentionally compact so the form stays focused.",
                    "워크스페이스 이메일로 로그인하거나 Google로 계속하세요. 토글은 화면이 어수선하지 않도록 작게 유지했습니다.",
                  )
                : t(
                    "Create the first account for this machine. After that, imported papers and notes belong to a real workspace user.",
                    "이 기기의 첫 계정을 만드세요. 그 이후부터 가져온 논문과 노트는 실제 사용자 기준으로 저장됩니다.",
                  )}
            </p>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={!googleAvailable || pending}
              style={googleButtonStyle(!googleAvailable || pending)}
            >
              <GoogleMark />
              <span>{t("Continue with Google", "Google로 계속하기")}</span>
            </button>
            <div style={helperTextStyle}>{googleHelper}</div>
          </div>

          <div style={dividerRowStyle}>
            <div style={dividerLineStyle} />
            <span>{t("or use email", "또는 이메일 사용")}</span>
            <div style={dividerLineStyle} />
          </div>

          <div style={modeToggleStyle}>
            {[
              { id: "signin", label: t("Existing account", "기존 계정") },
              { id: "register", label: t("Create account", "계정 생성") },
            ].map((option) => {
              const active = mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setMode(option.id as AuthMode);
                    setError(null);
                  }}
                  style={modeButtonStyle(active)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} style={formStyle}>
            {mode === "register" ? (
              <Field
                label={t("Name", "이름")}
                helper={t("Shown inside the workspace.", "워크스페이스 안에서 표시됩니다.")}
                icon={<UserRound size={16} />}
              >
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t("Researcher name", "연구자 이름")}
                  autoComplete="name"
                  style={inputStyle}
                />
              </Field>
            ) : null}

            <Field
              label={t("Email", "이메일")}
              helper={t("Used as your workspace sign-in.", "워크스페이스 로그인에 사용됩니다.")}
              icon={<Mail size={16} />}
            >
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="you@lab.org"
                autoComplete="email"
                style={inputStyle}
              />
            </Field>

            <Field
              label={t("Password", "비밀번호")}
              helper={t("Use at least 8 characters.", "8자 이상으로 입력해주세요.")}
              icon={<LockKeyhole size={16} />}
            >
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={t("At least 8 characters", "8자 이상")}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                style={inputStyle}
              />
            </Field>

            {error ? (
              <div role="alert" style={errorStyle}>
                {error}
              </div>
            ) : null}

            <button type="submit" disabled={pending} style={primaryButtonStyle(pending)}>
              <span>{mode === "signin" ? t("Sign in", "로그인") : t("Create account", "계정 생성")}</span>
              <ArrowRight size={16} />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  helper,
  icon,
  children,
}: {
  label: string;
  helper: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <label style={fieldStyle}>
      <div style={{ display: "grid", gap: 4 }}>
        <span style={fieldLabelStyle}>{label}</span>
        <span style={fieldHelperStyle}>{helper}</span>
      </div>
      <div style={fieldShellStyle}>
        <div style={fieldIconStyle}>{icon}</div>
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </label>
  );
}

function InfoBullet({ title, description }: { title: string; description: string }) {
  return (
    <article style={infoBulletStyle}>
      <strong style={{ fontSize: 14, lineHeight: 1.4 }}>{title}</strong>
      <p style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>{description}</p>
    </article>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-.9 2.2-1.9 2.9l3 2.3c1.7-1.6 2.7-4 2.7-6.8 0-.6-.1-1.2-.2-1.8H12z" />
      <path fill="#34A853" d="M12 22c2.4 0 4.4-.8 5.9-2.2l-3-2.3c-.8.6-1.9 1-3 1-2.3 0-4.2-1.5-4.9-3.5l-3.1 2.4C5.4 20.2 8.4 22 12 22z" />
      <path fill="#4A90E2" d="M7.1 15c-.2-.6-.4-1.3-.4-2s.1-1.4.4-2L4 8.6C3.4 9.9 3 11.4 3 13s.4 3.1 1 4.4L7.1 15z" />
      <path fill="#FBBC05" d="M12 7.5c1.3 0 2.5.5 3.4 1.3l2.6-2.6C16.4 4.7 14.4 4 12 4 8.4 4 5.4 5.8 4 8.6L7.1 11C7.8 9 9.7 7.5 12 7.5z" />
    </svg>
  );
}

function orbStyle(top: string, left: string, size: number, color: string): CSSProperties {
  return {
    position: "absolute",
    top,
    left,
    width: size,
    height: size,
    borderRadius: 999,
    background: color,
    filter: "blur(42px)",
    pointerEvents: "none",
  };
}

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  position: "relative",
  overflow: "auto",
  padding: 24,
  background:
    "radial-gradient(circle at top left, rgba(255,255,255,0.95), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #e9eef5 100%)",
};

const layoutStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  minHeight: "calc(100vh - 48px)",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 20,
  alignItems: "center",
  maxWidth: 1080,
  margin: "0 auto",
};

const introPanelStyle: CSSProperties = {
  display: "grid",
  gap: 18,
  padding: "34px clamp(22px, 4vw, 38px)",
  borderRadius: 28,
  border: "1px solid rgba(255, 255, 255, 0.72)",
  background: "linear-gradient(180deg, rgba(248,250,252,0.94) 0%, rgba(255,255,255,0.8) 100%)",
  boxShadow: "0 24px 56px rgba(15, 23, 42, 0.08)",
  backdropFilter: "blur(14px)",
};

const brandPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 12,
  width: "fit-content",
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(37, 99, 235, 0.12)",
  background: "rgba(255,255,255,0.84)",
};

const brandMarkStyle: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 12,
  background: "linear-gradient(135deg, #2563eb 0%, #0f766e 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
};

const brandEyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const titleStyle: CSSProperties = {
  fontSize: "clamp(2.2rem, 4vw, 3.6rem)",
  lineHeight: 1.02,
  letterSpacing: "-0.05em",
  maxWidth: 620,
};

const copyStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.8,
  color: "var(--color-text-secondary)",
  maxWidth: 640,
};

const statusCardStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 18,
  borderRadius: 20,
  background: "rgba(255,255,255,0.84)",
  border: "1px solid rgba(226, 232, 240, 0.95)",
};

const statusChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  width: "fit-content",
  padding: "8px 12px",
  borderRadius: 999,
  background: "rgba(37, 99, 235, 0.08)",
  color: "var(--color-accent)",
  fontSize: 12,
  fontWeight: 700,
};

const bulletGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
};

const infoBulletStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 16,
  borderRadius: 18,
  background: "rgba(255,255,255,0.76)",
  border: "1px solid rgba(226, 232, 240, 0.95)",
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 500,
  margin: "0 auto",
  display: "grid",
  gap: 18,
  padding: "30px clamp(22px, 4vw, 30px)",
  borderRadius: 28,
  border: "1px solid rgba(255,255,255,0.8)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.95) 100%)",
  boxShadow: "0 24px 56px rgba(15, 23, 42, 0.12)",
  backdropFilter: "blur(14px)",
};

const cardEyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const cardTitleStyle: CSSProperties = {
  fontSize: 30,
  lineHeight: 1.05,
  letterSpacing: "-0.05em",
};

const cardCopyStyle: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.75,
  color: "var(--color-text-secondary)",
};

function googleButtonStyle(disabled: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 44,
    padding: "0 16px",
    borderRadius: 14,
    border: "1px solid var(--color-border-subtle)",
    background: disabled ? "rgba(248,250,252,0.92)" : "#fff",
    color: "var(--color-text-primary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
  };
}

const helperTextStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.7,
  color: "var(--color-text-muted)",
};

const dividerRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  gap: 10,
  color: "var(--color-text-muted)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

const dividerLineStyle: CSSProperties = {
  height: 1,
  background: "rgba(226, 232, 240, 0.95)",
};

const modeToggleStyle: CSSProperties = {
  display: "inline-grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 6,
  padding: 4,
  borderRadius: 999,
  background: "rgba(226, 232, 240, 0.58)",
  border: "1px solid rgba(226, 232, 240, 0.9)",
  width: "fit-content",
};

function modeButtonStyle(active: boolean): CSSProperties {
  return {
    minHeight: 34,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid transparent",
    background: active ? "rgba(255,255,255,0.98)" : "transparent",
    color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: active ? "0 8px 16px rgba(15, 23, 42, 0.08)" : "none",
  };
}

const formStyle: CSSProperties = {
  display: "grid",
  gap: 14,
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--color-text-primary)",
};

const fieldHelperStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted)",
  lineHeight: 1.6,
};

const fieldShellStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minHeight: 50,
  padding: "0 14px",
  borderRadius: 15,
  border: "1px solid var(--color-border-subtle)",
  background: "rgba(255,255,255,0.96)",
};

const fieldIconStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(37, 99, 235, 0.08)",
  color: "var(--color-accent)",
  flexShrink: 0,
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: 14,
  color: "var(--color-text-primary)",
};

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(190, 24, 93, 0.14)",
  background: "rgba(190, 24, 93, 0.08)",
  color: "#9f1239",
  fontSize: 12.5,
  lineHeight: 1.7,
};

function primaryButtonStyle(pending: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 46,
    padding: "0 18px",
    borderRadius: 14,
    border: "none",
    background: "linear-gradient(135deg, #2563eb 0%, #0f766e 100%)",
    color: "#fff",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: pending ? "progress" : "pointer",
    opacity: pending ? 0.82 : 1,
    boxShadow: pending ? "none" : "0 16px 28px rgba(37, 99, 235, 0.22)",
  };
}




