"use client";

import { useCallback, useRef, useState } from "react";
import type { UploadKind } from "@/lib/community/admin-format";
import { uploadCommunityFile } from "@/lib/community/admin-upload";
import type { CommunityFile } from "@/lib/community/types";

export interface FileUploadState {
  /** A file is on its way. */
  pending: boolean;
  /** 0 to 1 of the file now going; null before the first byte is reported. */
  progress: number | null;
  /** Why the last upload failed, in a sentence. */
  error: string | null;
  /** The last upload failed because the session ended. */
  expired: boolean;
}

const IDLE: FileUploadState = { pending: false, progress: null, error: null, expired: false };

/**
 * Uploads files to the Community media library one at a time and reports where
 * it stands. `upload` resolves with the stored file, or null after it has set
 * `error` (or `expired`); it never throws, and a second call while one is in
 * flight is ignored.
 */
export function useFileUpload(kind: UploadKind) {
  const [state, setState] = useState<FileUploadState>(IDLE);
  const busy = useRef(false);

  const upload = useCallback(
    async (file: File): Promise<CommunityFile | null> => {
      if (busy.current) return null;
      busy.current = true;
      setState({ pending: true, progress: null, error: null, expired: false });
      try {
        const result = await uploadCommunityFile(file, {
          kind,
          onProgress: (progress) => setState((s) => ({ ...s, progress })),
        });
        if (result.ok) {
          setState(IDLE);
          return result.file;
        }
        setState({
          pending: false,
          progress: null,
          expired: result.reason === "session_expired",
          error: result.reason === "error" ? result.message : null,
        });
        return null;
      } finally {
        busy.current = false;
      }
    },
    [kind]
  );

  const reset = useCallback(() => setState(IDLE), []);
  return { ...state, upload, reset };
}
