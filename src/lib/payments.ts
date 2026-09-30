// Paystack payments for orders. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers check the session first (the webhook and cron routes
// authenticate the request instead).
// An order is only ever marked paid by `confirmPayment`, after Paystack's verify API says the
// transaction succeeded for the right order, amount and currency, never from a browser redirect.
// neon-http has no interactive transactions, so each write is one SQL statement.
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { PAYMENT_WINDOW_MINUTES, randomCode } from "@/lib/orders";
import { initializeTransaction, verifyTransaction } from "@/lib/paystack";
import { stockDecrementCtes, stockIncrementCtes } from "@/lib/stock";

/**
 * An unpaid order isn't expired while a payment attempt younger than this is open: the customer
 * may still be on Paystack's page. Attempts can only start inside the payment window, so an order
 * holds its stock for at most PAYMENT_WINDOW_MINUTES + PAYMENT_HOLD_MINUTES.
 */
export const PAYMENT_HOLD_MINUTES = 30;

/**
 * Payment attempts one order may start. Each open attempt costs a Paystack check in every expiry
 * sweep, so this bounds how much work one customer's clicks can make.
 */
export const MAX_PAYMENT_ATTEMPTS = 10;

const PAID_STATUSES = new Set(["paid", "processing", "shipped", "delivered"]);

/** The app's public base URL, from configuration rather than the request's Host header. */
function appUrl() {
  const base = process.env.BETTER_AUTH_URL?.trim();
  if (!base) throw new Error("BETTER_AUTH_URL is not set.");
  return base.replace(/\/+$/, "");
}

export type StartPaymentResult =
  | { ok: true; authorizationUrl: string }
  /**
   * No such order for this user; the order isn't awaiting payment; it has started
   * MAX_PAYMENT_ATTEMPTS already; or Paystack failed.
   */
  | { ok: false; reason: "not-found" | "not-payable" | "too-many-attempts" | "unavailable" };

/**
 * Starts a Paystack payment attempt for the user's pending order and returns Paystack's checkout
 * URL. The amount is the order total from the database. The attempt is recorded before Paystack is
 * called, so any webhook for it finds it. Refuses orders past their payment window, and orders that
 * have used their MAX_PAYMENT_ATTEMPTS.
 */
export async function startPayment(userId: string, email: string, orderReference: string): Promise<StartPaymentResult> {
  const base = appUrl();
  const reference = `${orderReference}-${randomCode(8)}`;
  // Locks the order, so an expiry sweep running at the same moment either sees this attempt or
  // has already expired the order (which then isn't selected). The attempt count comes from this
  // statement's snapshot, so attempts started at the very same moment can go a few over the limit;
  // it only has to bound the work, not be exact. A new attempt also touches the order row, so an
  // admin cancel racing this statement sees the row changed and refuses (see `changeOrderStatus`).
  // `amount` is a bigint, which the driver returns as a string.
  const { rows } = await db.execute<{ order_id: number; amount: string; payable: boolean; started: boolean }>(sql`
    with o as (
      select id, total, status, created_at,
        status = 'pending_payment'
          and created_at > now() - make_interval(mins => ${PAYMENT_WINDOW_MINUTES}) as payable
      from orders
      where reference = ${orderReference} and user_id = ${userId}
      for update
    ),
    attempt as (
      insert into payments (order_id, reference, amount)
      select id, ${reference}, total
      from o
      where payable
        and (select count(*) from payments p where p.order_id = o.id) < ${MAX_PAYMENT_ATTEMPTS}
      returning order_id, amount
    ),
    touched as (
      update orders set updated_at = now()
      where id in (select order_id from attempt)
      returning id
    )
    select o.id as order_id, o.total as amount, o.payable, a.order_id is not null as started
    from o
    left join attempt a on a.order_id = o.id
  `);
  const row = rows.at(0);
  if (!row) return { ok: false, reason: "not-found" };
  if (!row.payable) return { ok: false, reason: "not-payable" };
  if (!row.started) return { ok: false, reason: "too-many-attempts" };

  try {
    const { authorizationUrl } = await initializeTransaction({
      email,
      amount: Number(row.amount),
      reference,
      callbackUrl: `${base}/orders/${orderReference}/payment`,
      metadata: {
        order_id: row.order_id,
        order_reference: orderReference,
        // Where Paystack sends the customer if they cancel on its page.
        cancel_action: `${base}/orders/${orderReference}`,
      },
    });
    return { ok: true, authorizationUrl };
  } catch (error) {
    console.error(`[payments] could not initialize ${reference}`, error);
    await db
      .update(payments)
      .set({ status: "failed" })
      .where(and(eq(payments.reference, reference), eq(payments.status, "pending")));
    return { ok: false, reason: "unavailable" };
  }
}

export type ConfirmPaymentOutcome =
  /** The order is now paid by this payment. */
  | "paid"
  /** The order was already paid by this payment (a repeated event or a second check). */
  | "already-paid"
  /** Paystack hasn't finished the transaction yet (e.g. waiting for the M-Pesa PIN). */
  | "pending"
  /** The transaction failed, was abandoned or reversed, or never reached Paystack. */
  | "failed"
  /** Not a reference we issued. */
  | "unknown-reference"
  /** Paystack's record doesn't match the order (amount, currency or order). Nothing was changed. */
  | "mismatch"
  /** Money was taken but the order can't take it (already paid, cancelled, or expired and sold out). */
  | "needs-refund";

export type ConfirmPaymentResult = { outcome: ConfirmPaymentOutcome; orderReference?: string };

/**
 * Verifies a payment attempt with Paystack and, if it succeeded for this order's exact amount in
 * KES, marks the order paid. Safe to call any number of times, concurrently, from the webhook, the
 * callback page and the expiry sweep. An expired order is paid only if its stock can be taken
 * again. Throws when Paystack or the database can't be reached, so the caller can retry.
 */
export async function confirmPayment(reference: string): Promise<ConfirmPaymentResult> {
  const [attempt] = await db
    .select({
      orderId: payments.orderId,
      amount: payments.amount,
      orderReference: orders.reference,
      orderTotal: orders.total,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(eq(payments.reference, reference));
  if (!attempt) return { outcome: "unknown-reference" };
  const orderReference = attempt.orderReference;

  const transaction = await verifyTransaction(reference);
  if (!transaction || ["failed", "abandoned", "reversed"].includes(transaction.status)) {
    await db
      .update(payments)
      .set({ status: transaction?.status === "abandoned" ? "abandoned" : "failed" })
      .where(and(eq(payments.reference, reference), eq(payments.status, "pending")));
    return { outcome: "failed", orderReference };
  }
  if (transaction.status !== "success") return { outcome: "pending", orderReference };

  const problems = [
    transaction.reference !== reference && "reference",
    transaction.currency !== "KES" && `currency ${transaction.currency}`,
    String(transaction.metadata.order_id) !== String(attempt.orderId) && `order ${String(transaction.metadata.order_id)}`,
    (transaction.amount !== attempt.amount || attempt.amount !== attempt.orderTotal) &&
      `amount ${transaction.amount} (attempt ${attempt.amount}, order ${attempt.orderTotal})`,
  ].filter(Boolean);
  if (problems.length > 0) {
    const detail = `Doesn't match order ${orderReference}: ${problems.join(", ")}`;
    console.error(`[payments] ${reference} ${detail}`);
    // Paystack took the money but the order can't take it, so it's owed back. Recorded once.
    await db
      .update(payments)
      .set({
        status: "success",
        paystackId: transaction.id,
        channel: transaction.channel,
        paidAt: transaction.paidAt ?? new Date(),
        refundStatus: "due",
        refundReason: "mismatch",
        refundDetail: detail,
      })
      .where(and(eq(payments.reference, reference), isNull(payments.refundStatus)));
    return { outcome: "mismatch", orderReference };
  }

  const paidAt = (transaction.paidAt ?? new Date()).toISOString();
  const { rows } = await db.execute<{ previous_status: string; payment_reference: string | null; applied: number }>(sql`
    with o as (
      select id, status, payment_reference
      from orders
      where id = ${attempt.orderId}
      for update
    ),
    -- Only an expired order needs its stock back; a deleted product (null id) fails the verdict.
    req as (
      select oi.product_id, sum(oi.quantity)::int as quantity
      from order_items oi
      join o on o.id = oi.order_id
      where o.status = 'expired'
      group by oi.product_id
    ),
    ${stockDecrementCtes()},
    paid as (
      update orders
      set status = 'paid', payment_reference = ${reference}, paid_at = ${paidAt}::timestamptz, updated_at = now()
      from o, verdict v
      where orders.id = o.id and (o.status = 'pending_payment' or (o.status = 'expired' and v.ok))
      returning orders.id
    ),
    paid_event as (
      insert into order_events (order_id, from_status, to_status)
      select o.id, o.status, 'paid' from o, paid
      returning id
    ),
    -- The first time this payment succeeds. If it didn't pay the order (already paid, cancelled, or
    -- expired and sold out), the money is owed back: recorded as a refund due, in the same statement.
    attempt as (
      update payments
      set status = 'success', paystack_id = ${transaction.id}, channel = ${transaction.channel},
        paid_at = ${paidAt}::timestamptz, updated_at = now(),
        refund_status = case when exists (select 1 from paid) then null else 'due'::refund_status end,
        refund_reason = case
          when exists (select 1 from paid) then null
          when (select payment_reference from o) is not null then 'duplicate_payment'::refund_reason
          else 'order_unavailable'::refund_reason
        end,
        refund_detail = case when exists (select 1 from paid) then null
          else 'Order was ' || (select status::text from o) end
      where reference = ${reference} and status <> 'success'
      returning id
    )
    select o.status::text as previous_status, o.payment_reference,
      (select count(*) from paid)::int as applied
    from o
  `);
  const row = rows[0];

  if (row.applied > 0) {
    if (row.previous_status === "expired") {
      console.warn(`[payments] late payment ${reference} reinstated expired order ${orderReference}`);
    }
    return { outcome: "paid", orderReference };
  }
  if (PAID_STATUSES.has(row.previous_status) && row.payment_reference === reference) {
    return { outcome: "already-paid", orderReference };
  }
  console.error(
    `[payments] REFUND NEEDED: ${reference} succeeded but order ${orderReference} is ${row.previous_status}` +
      (row.payment_reference ? ` (paid by ${row.payment_reference})` : ""),
  );
  return { outcome: "needs-refund", orderReference };
}

/**
 * Expires orders still unpaid PAYMENT_WINDOW_MINUTES after they were placed and returns their
 * stock. First re-checks their open payment attempts with Paystack, so a payment whose webhook
 * hasn't arrived isn't lost. An order is only expired once this run has checked every attempt of it
 * that's still open, so orders it couldn't check (Paystack unreachable, or past `limit` attempts)
 * are left for the next run. Orders with an attempt started in the last PAYMENT_HOLD_MINUTES are
 * left too. Returns the references of the orders it expired. Safe to run concurrently.
 */
export async function expireUnpaidOrders({ limit = 100 }: { limit?: number } = {}) {
  const { rows: open } = await db.execute<{ reference: string }>(sql`
    select p.reference
    from payments p
    join orders o on o.id = p.order_id
    where o.status = 'pending_payment'
      and o.created_at < now() - make_interval(mins => ${PAYMENT_WINDOW_MINUTES})
      and p.status = 'pending'
    order by p.id
    limit ${limit}
  `);
  // Attempts Paystack answered for. Some stay pending (still open on Paystack, or a mismatch).
  const checked: string[] = [];
  for (const { reference } of open) {
    try {
      await confirmPayment(reference);
      checked.push(reference);
    } catch (error) {
      console.error(`[payments] could not check ${reference} before expiry`, error);
    }
  }

  const { rows } = await db.execute<{ reference: string }>(sql`
    with expired as (
      update orders o
      set status = 'expired', updated_at = now()
      where o.status = 'pending_payment' and o.id in (
        select c.id
        from orders c
        where c.status = 'pending_payment'
          and c.created_at < now() - make_interval(mins => ${PAYMENT_WINDOW_MINUTES})
          and not exists (
            select 1 from payments p
            where p.order_id = c.id and p.status = 'pending'
              and p.reference not in (select jsonb_array_elements_text(${JSON.stringify(checked)}::jsonb))
          )
          and not exists (
            select 1 from payments p
            where p.order_id = c.id and p.created_at > now() - make_interval(mins => ${PAYMENT_HOLD_MINUTES})
          )
        order by c.id
        limit ${limit}
        for update skip locked
      )
      returning o.id, o.reference
    ),
    expired_event as (
      insert into order_events (order_id, from_status, to_status)
      select id, 'pending_payment', 'expired' from expired
      returning id
    ),
    restock_req as (
      select oi.product_id, sum(oi.quantity)::int as quantity
      from order_items oi
      where oi.order_id in (select id from expired) and oi.product_id is not null
      group by oi.product_id
    ),
    ${stockIncrementCtes()}
    select reference, (select count(*) from restock_upd)::int as restocked_products
    from expired
    order by reference
  `);
  return rows.map((row) => row.reference);
}

/**
 * The payment attempt `paymentReference` of the user's order `orderReference`, or undefined if
 * it isn't one.
 */
export async function getPaymentForUser(userId: string, orderReference: string, paymentReference: string) {
  const [row] = await db
    .select({ reference: payments.reference, status: payments.status })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(payments.reference, paymentReference),
        eq(orders.reference, orderReference),
        eq(orders.userId, userId),
      ),
    );
  return row;
}
