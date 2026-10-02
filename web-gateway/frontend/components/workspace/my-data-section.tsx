import { isUnauthorizedError, redirectToSignIn } from "@/lib/auth-guard";
import { fetchMine } from "@/lib/repository/actions";
import type { MineResponse } from "@/lib/repository/types";
import { MyDataTable } from "./my-data-table";
import { MyDataEmpty, MyDataLoadError } from "./my-data-states";

/**
 * What the Snapshots & Inputs page shows below its header. Async, so the page
 * around it (and the skeleton) is on screen while the backend answers.
 */
export async function MyDataSection({ here }: { here: string }) {
  let mine: MineResponse;
  try {
    mine = await fetchMine();
  } catch (error) {
    // A 401 with a session that looked fine: the backend no longer accepts the
    // token. Sign in again rather than showing an empty list.
    if (isUnauthorizedError(error)) redirectToSignIn(here);
    return <MyDataLoadError retryHref={here} />;
  }
  if (mine.items.length === 0) return <MyDataEmpty />;
  return <MyDataTable items={mine.items} />;
}
