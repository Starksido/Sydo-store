import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderDetail } from "@/components/orders/order-detail";
import { getOrderForUser } from "@/lib/orders";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Order confirmation" };

// Only the order's owner can see it; anyone else gets the same 404 as for an unknown reference.
export default async function OrderPage({ params }: PageProps<"/orders/[reference]">) {
  const { reference } = await params;
  const { user } = await requireSession(`/orders/${encodeURIComponent(reference)}`);
  const order = await getOrderForUser(user.id, reference);
  if (!order) notFound();

  return <OrderDetail order={order} variant="confirmation" />;
}
