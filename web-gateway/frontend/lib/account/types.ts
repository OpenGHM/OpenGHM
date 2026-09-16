import type { UserRole } from "@/lib/auth.types";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organization: string | null;
  email_verified: boolean;
  is_active: boolean;
  created_at: string | null;
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
