// Discount codes. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers check the session (or `requireAdmin`) first.
// The rules are applied for real inside `placeOrder` (one statement that locks the code and takes a
// redemption); `previewDiscount` applies the same rules without locking, for the checkout summary.
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { discountCodes, discountKind } from "@/db/schema";
import type { DiscountInput } from "@/lib/admin/discount-input";
import { formatPrice } from "@/lib/catalog";
import { pgError } from "@/lib/pg-error";

export type DiscountKind = (typeof discountKind.enumValues)[number];

/** Why a code doesn't apply to an order. */
export type DiscountProblem = "invalid" | "not-started" | "ended" | "used-up" | "minimum" | "already-used";

/** The smallest total an order can have after a discount: KES 1. */
export const MIN_ORDER_TOTAL = 100;

/**
 * What a code takes off a subtotal, in KES cents: a percentage rounded down to a whole shilling, or a
 * fixed amount, capped so the total stays at least KES 1. Kept in step with the SQL in `placeOrder`.
 */
export function discountAmount(kind: DiscountKind, value: number, subtotal: number) {
  const raw = kind === "percent" ? Math.floor((subtotal * value) / 10_000) * 100 : value;
  return Math.max(0, Math.min(raw, subtotal - MIN_ORDER_TOTAL));
}

export function discountProblemMessage(problem: DiscountProblem, minSubtotal = 0) {
  switch (problem) {
    case "invalid":
      return "That code isn't valid.";
    case "not-started":
      return "That code can't be used yet.";
    case "ended":
      return "That code has expired.";
    case "used-up":
      return "That code has been used up.";
    case "minimum":
      return `That code needs an order of at least ${formatPrice(minSubtotal)}.`;
    case "already-used":
      return "You've already used that code.";
  }
}

/** A code as customers type it: trimmed and upper-case. */
export function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export type DiscountPreview =
  | { ok: true; code: string; discount: number }
  | { ok: false; problem: DiscountProblem; minSubtotal: number };

/**
 * Whether `code` applies to an order of `subtotal` for the user, and what it takes off. The same
 * rules as `placeOrder`, without locking, so checkout can show the total before placing the order.
 */
export async function previewDiscount(userId: string, code: string, subtotal: number): Promise<DiscountPreview> {
  const { rows } = await db.execute<{
    code: string | null;
    kind: DiscountKind | null;
    value: number | null;
    min_subtotal: number | null;
    problem: DiscountProblem | null;
  }>(sql`
    select c.code, c.kind, c.value, c.min_subtotal::float8 as min_subtotal,
      case
        when c.id is null or not c.active then 'invalid'
        when c.starts_at > now() then 'not-started'
        when c.ends_at <= now() then 'ended'
        when c.max_redemptions is not null and c.redemptions >= c.max_redemptions then 'used-up'
        when ${subtotal}::bigint < c.min_subtotal then 'minimum'
        when c.once_per_customer and exists (
          select 1 from orders o
          where o.user_id = ${userId} and o.discount_code_id = c.id and o.status <> 'expired'
        ) then 'already-used'
      end as problem
    from (select 1) one
    left join discount_codes c on upper(c.code) = ${normalizeCode(code)}
  `);
  const [row] = rows;
  if (row.problem || !row.code || !row.kind || row.value === null) {
    return { ok: false, problem: row.problem ?? "invalid", minSubtotal: row.min_subtotal ?? 0 };
  }
  return { ok: true, code: row.code, discount: discountAmount(row.kind, row.value, subtotal) };
}

// ---------- Admin ----------

/** Every code, newest first, with how many orders used it (expired ones included). */
export async function listDiscountCodes() {
  return db
    .select({
      id: discountCodes.id,
      code: discountCodes.code,
      kind: discountCodes.kind,
      value: discountCodes.value,
      minSubtotal: discountCodes.minSubtotal,
      startsAt: discountCodes.startsAt,
      endsAt: discountCodes.endsAt,
      maxRedemptions: discountCodes.maxRedemptions,
      redemptions: discountCodes.redemptions,
      oncePerCustomer: discountCodes.oncePerCustomer,
      active: discountCodes.active,
    })
    .from(discountCodes)
    .orderBy(desc(discountCodes.createdAt), desc(discountCodes.id));
}

export type DiscountCodeListItem = Awaited<ReturnType<typeof listDiscountCodes>>[number];

export async function getDiscountCode(id: number) {
  const [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, id));
  if (!row) return undefined;
  const { rows } = await db.execute<{ used: boolean }>(
    sql`select exists (select 1 from orders where discount_code_id = ${id}::int) as used`,
  );
  return { ...row, used: rows[0].used };
}

export type AdminDiscountCode = NonNullable<Awaited<ReturnType<typeof getDiscountCode>>>;

export type SaveDiscountResult = { ok: true; id: number } | { ok: false; errors: { code?: string } };

function duplicateCode(error: unknown) {
  const { code, constraint } = pgError(error);
  return code === "23505" && constraint === "discount_codes_code_unique";
}

export async function createDiscountCode(input: DiscountInput): Promise<SaveDiscountResult> {
  try {
    const [row] = await db.insert(discountCodes).values(input).returning({ id: discountCodes.id });
    return { ok: true, id: row.id };
  } catch (error) {
    if (duplicateCode(error)) return { ok: false, errors: { code: "Another code is already called this." } };
    throw error;
  }
}

/** Updates everything but the redemption count. Undefined if there's no such code. */
export async function updateDiscountCode(id: number, input: DiscountInput): Promise<SaveDiscountResult | undefined> {
  try {
    const [row] = await db
      .update(discountCodes)
      .set(input)
      .where(eq(discountCodes.id, id))
      .returning({ id: discountCodes.id });
    return row ? { ok: true, id: row.id } : undefined;
  } catch (error) {
    if (duplicateCode(error)) return { ok: false, errors: { code: "Another code is already called this." } };
    throw error;
  }
}

/** Turns a code on or off. Returns false if there's no such code. */
export async function setDiscountCodeActive(id: number, active: boolean) {
  const rows = await db
    .update(discountCodes)
    .set({ active })
    .where(eq(discountCodes.id, id))
    .returning({ id: discountCodes.id });
  return rows.length > 0;
}

export type DeleteDiscountResult = { ok: true } | { ok: false; reason: "not-found" | "used" };

/** Deletes a code no order has used, in one statement; a used one can only be deactivated. */
export async function deleteDiscountCode(id: number): Promise<DeleteDiscountResult> {
  const { rows } = await db.execute<{ id: number }>(sql`
    delete from discount_codes c
    where c.id = ${id}::int and not exists (select 1 from orders o where o.discount_code_id = c.id)
    returning c.id
  `);
  if (rows.length > 0) return { ok: true };
  const [row] = await db.select({ id: discountCodes.id }).from(discountCodes).where(eq(discountCodes.id, id));
  return { ok: false, reason: row ? "used" : "not-found" };
}

