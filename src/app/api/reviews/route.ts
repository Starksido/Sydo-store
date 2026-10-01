import { listReviews } from "@/lib/reviews";

function positiveInt(value: string | null, max: number) {
  return value && /^\d{1,9}$/.test(value) && Number(value) > 0 ? Math.min(Number(value), max) : null;
}

/**
 * A page of a product's visible reviews (`?productId=&page=`), for "More reviews" on the static
 * product page, which renders the first page itself.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const productId = positiveInt(params.get("productId"), 2_147_483_647);
  const page = positiveInt(params.get("page"), 1000) ?? 1;
  if (!productId) return Response.json({ error: "productId is required" }, { status: 400 });
  const result = await listReviews(productId, { page });
  return Response.json(result, { headers: { "Cache-Control": "public, max-age=60" } });
}
