import { canReview, getOwnReview } from "@/lib/reviews";
import { getSession } from "@/lib/session";

/**
 * Whether the viewer may review `?productId=`, and their review if they wrote one, for the review
 * form on the (static) product page. Guests and bad ids get `canReview: false`.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("productId") ?? "";
  const productId = /^\d{1,9}$/.test(id) ? Number(id) : 0;
  const session = productId ? await getSession() : null;
  const [eligible, review] = session
    ? await Promise.all([canReview(session.user.id, productId), getOwnReview(session.user.id, productId)])
    : [false, null];
  const mine = review && { rating: review.rating, title: review.title, body: review.body, hidden: !!review.hiddenAt };
  return Response.json({ canReview: eligible, review: mine }, { headers: { "Cache-Control": "private, no-store" } });
}
