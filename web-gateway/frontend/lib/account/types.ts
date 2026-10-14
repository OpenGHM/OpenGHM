import type { UserRole } from "@/lib/auth.types";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organization: string | null;
  email_verified: boolean;
  is_active: boolean;
  /** Whether an administrator has allowed this user to run simulations
   *  (ADR 0024). Admin and staff may always run, whatever this says. */
  can_run_simulations: boolean;
  created_at: string | null;
  /** Which identity provider is connected ("cilogon"), or null. */
  sso_provider: string | null;
  /** The address the connected identity gave, which may differ from `email`;
   *  null when none is connected or the provider gave none. */
  sso_email: string | null;
  /** Whether a password is set. CILogon can be disconnected only while it is. */
  has_password: boolean;
}

export interface SessionEntry {
  id: string;
  created_at: string;
  last_used_at: string;
  user_agent: string | null;
  current: boolean;
}

export interface SessionListResponse {
  items: SessionEntry[];
}
