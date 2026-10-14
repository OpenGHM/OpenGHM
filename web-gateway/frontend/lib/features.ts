/**
 * What this deployment offers, read from the server's environment at request
 * time. Not NEXT_PUBLIC_: one built image is promoted from dev to prod
 * (`just promote-frontend`), so a value inlined by `next build` would hold for
 * both. The backend reads the same variable (`WORKSPACE_ENABLED`) and refuses a
 * draft's changes when it is off.
 */
export interface SiteFeatures {
  /** The Workspace: snapshot drafts and their runs. Off only when set to "false". */
  workspace: boolean;
}

export function siteFeatures(): SiteFeatures {
  return { workspace: process.env.WORKSPACE_ENABLED !== "false" };
}
