import { getCart } from "@/lib/cart";
import { getSession } from "@/lib/session";

/** Item count for the header. Guests get 0 without a cart query. */
export async function GET() {
  const session = await getSession();
  const count = session ? (await getCart(session.user.id)).count : 0;
  return Response.json({ count }, { headers: { "Cache-Control": "private, no-store" } });
}
