import { getSession } from "@/lib/session";
import { isWishlisted } from "@/lib/wishlist";

/**
 * Whether the signed-in user saved `?productId=`, for the heart on (static) product pages. Guests
 * and bad ids get `false`.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("productId") ?? "";
  const productId = /^\d{1,9}$/.test(id) ? Number(id) : 0;
  const session = productId ? await getSession() : null;
  const saved = session ? await isWishlisted(session.user.id, productId) : false;
  return Response.json({ saved }, { headers: { "Cache-Control": "private, no-store" } });
}
