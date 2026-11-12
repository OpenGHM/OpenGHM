/**
 * What this deployment offers, read from the server's environment at request
 * time. Not NEXT_PUBLIC_: one built image is promoted from dev to prod
 * (`just promote-frontend`), so a value inlined by `next build` would hold for
 * both. The backend reads `WORKSPACE_ENABLED` too and refuses a draft's
 * changes when it is off; `REPOSITORY_ENABLED` is read here only, because the
 * repository's data is public on S3 and nothing in the backend is a draft.
 */
export interface SiteFeatures {
  /** The Workspace: snapshot drafts and their runs. Off only when set to "false". */
  workspace: boolean;
  /** The Data Repository: the catalogue and every snapshot's page. Off only when set to "false". */
  repository: boolean;
}

export function siteFeatures(): SiteFeatures {
  return {
    workspace: process.env.WORKSPACE_ENABLED !== "false",
    repository: process.env.REPOSITORY_ENABLED !== "false",
  };
}
