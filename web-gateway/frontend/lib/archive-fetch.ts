/**
 * The archive POST to the backend, with a retry for one refusal.
 *
 * The backend refuses a ZIP with 429 `archive_busy` when its process already prepares its
 * maximum of them. That limit is per pod: with several backend pods behind the Service, a
 * request can reach a busy pod while another is idle, so a second try often succeeds. The
 * request is sent again, at most twice, after a short wait. Every other outcome (any other
 * status, a 429 with another code, a network error) is returned or thrown as it is, and the
 * last 429 is returned unchanged, status and body.
 */

/** The wait before the first retry and before the second, in milliseconds. */
export const ARCHIVE_RETRY_DELAYS_MS: readonly number[] = [500, 1500];

export interface ArchiveFetchOptions {
  /** The wait before each retry; its length is the number of retries. For tests. */
  delaysMs?: readonly number[];
}

async function isArchiveBusy(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  try {
    // Read from a clone, so the response handed on still has its body.
    const body = (await response.clone().json()) as { detail?: { code?: unknown } } | null;
    return body?.detail?.code === "archive_busy";
  } catch {
    return false;
  }
}

/** Resolves after `ms`; rejects with the signal's reason as soon as it is aborted. */
function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * `fetch(url, init)`, sent again after a 429 `archive_busy`. `init.body` must be a value that
 * can be sent more than once (a string), not a stream. Aborting `init.signal` while waiting
 * rejects with its reason, like an aborted `fetch`.
 */
export async function fetchArchive(
  url: string,
  init: RequestInit,
  { delaysMs = ARCHIVE_RETRY_DELAYS_MS }: ArchiveFetchOptions = {}
): Promise<Response> {
  for (let retry = 0; ; retry++) {
    const response = await fetch(url, init);
    if (retry >= delaysMs.length || !(await isArchiveBusy(response))) return response;
    // This refusal is not handed on: let go of its connection.
    await response.body?.cancel().catch(() => {});
    await wait(delaysMs[retry], init.signal);
  }
}
