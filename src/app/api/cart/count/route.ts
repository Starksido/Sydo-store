import { getCart } from "@/lib/cart";
import { getCartOwner } from "@/lib/cart-owner";

/** Item count for the header, for users and guests. Guests without a cart cookie get 0 without a query. */
export async function GET() {
  const owner = await getCartOwner();
  const count = owner ? (await getCart(owner)).count : 0;
  return Response.json({ count }, { headers: { "Cache-Control": "private, no-store" } });
}
