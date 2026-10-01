import { after } from "next/server";

/**
 * Lets `task` finish after the response is sent (Next's `after`), so slow side effects such as
 * emails don't hold up the page and take the same time whether or not they happen. Outside a
 * request (scripts, tests) the task just runs on its own. `task` must handle its own errors.
 */
export function inBackground(task: Promise<unknown>) {
  try {
    after(task);
  } catch {
    // `after` throws outside a request scope; the promise is already running.
  }
}
