import { isUnauthorizedError, redirectToSignIn } from "@/lib/auth-guard";
import { fetchMine } from "@/lib/repository/actions";
import type { MineResponse } from "@/lib/repository/types";
import { PublishedList, PublishedLoadError } from "./published-list";

/**
 * What the Published page shows below its hero. Async, so the page around it
 * (and the skeleton) is on screen while the backend answers.
 */
export async function PublishedSection({ here }: { here: string }) {
  let mine: MineResponse;
  try {
    mine = await fetchMine();
  } catch (error) {
    // A 401 with a session that looked fine: the backend no longer accepts the
    // token. Sign in again rather than showing an empty list.
    if (isUnauthorizedError(error)) redirectToSignIn(here);
    return <PublishedLoadError retryHref={here} />;
  }
  return <PublishedList items={mine.items} />;
}
