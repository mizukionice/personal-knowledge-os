import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';

export interface AuthResult {
  error: string | null;
  needsEmailConfirmation?: boolean;
}

export interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return value;
}
