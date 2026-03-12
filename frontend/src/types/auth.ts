export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  workspaceName: string;
  planLabel: string;
}

export interface AuthSession {
  user: WorkspaceUser;
  signedInAt: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface RegisterInput extends SignInInput {
  name: string;
}
