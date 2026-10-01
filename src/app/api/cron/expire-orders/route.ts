import { createHash, timingSafeEqual } from "node:crypto";

import { deleteStaleGuestCarts } from "@/lib/cart";
import { expireUnpaidOrders } from "@/lib/payments";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** Whether the request carries `Authorization: Bearer <CRON_SECRET>`. Refuses all if it's unset. */
function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  // Hashing gives equal-length buffers, so the comparison takes the same time whatever was sent.
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/**
 * Expires unpaid orders past their payment window and returns their stock, and deletes guest bags
 * untouched for 30 days. Call it every 10–15 minutes from a scheduler (GitHub Actions, cron-job.org,
 * Vercel Cron) with the CRON_SECRET.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const expired = await expireUnpaidOrders();
  const guestCarts = await deleteStaleGuestCarts();
  return Response.json({ expired: expired.length, guestCarts });
}
