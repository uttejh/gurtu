import { createContext } from 'react';
import type { Session } from '@supabase/supabase-js';

export interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  configAvailable: boolean;
  isGlobalAdmin: boolean;
  adminRoleLoading: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
