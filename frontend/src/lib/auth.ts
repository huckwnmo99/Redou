import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseAuthRepository as authRepository } from "./supabaseAuthRepository";
import { supabase } from "./supabase";
import { queryClient } from "./queryClient";
import type { RegisterInput, SignInInput } from "@/types/auth";

export const authKeys = {
  session: ["auth", "session"] as const,
};

let authStateUnsubscribe: (() => void) | null = null;

function ensureAuthStateListener() {
  if (authStateUnsubscribe) {
    return;
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(() => {
    queryClient.invalidateQueries({ queryKey: authKeys.session });
  });

  authStateUnsubscribe = () => {
    subscription.unsubscribe();
    authStateUnsubscribe = null;
  };

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      authStateUnsubscribe?.();
    });
  }
}

ensureAuthStateListener();

export function useAuthSession() {
  return useQuery({
    queryKey: authKeys.session,
    queryFn: () => authRepository.getSession(),
  });
}

export function useSignIn() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: SignInInput) => authRepository.signIn(input),
    onSuccess: (session) => {
      qc.setQueryData(authKeys.session, session);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: RegisterInput) => authRepository.register(input),
    onSuccess: (session) => {
      qc.setQueryData(authKeys.session, session);
    },
  });
}

export function useSignInWithGoogle() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => authRepository.signInWithGoogle(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: authKeys.session });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => authRepository.signOut(),
    onSuccess: () => {
      qc.setQueryData(authKeys.session, null);
    },
  });
}
