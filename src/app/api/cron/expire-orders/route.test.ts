// Runs against the test database only (see tests/test-env.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProduct, createUser, getStock, resetCatalog } from "../../../../../tests/fixtures";
import { ageOrder, createOrder, getOrderRow } from "../../../../../tests/orders";
import { GET } from "./route";

beforeEach(resetCatalog);

afterEach(() => {
  vi.unstubAllEnvs();
});

function call(authorization?: string) {
  return GET(
    new Request("http://localhost:3000/api/cron/expire-orders", {
      headers: authorization === undefined ? {} : { authorization },
    }),
  );
}

describe("GET /api/cron/expire-orders", () => {
  it("refuses requests without the cron secret", async () => {
    const userId = await createUser();
    const reference = await createOrder(userId, [[await createProduct(5), 1]]);
    await ageOrder(reference, 61);

    for (const authorization of [undefined, "", "Bearer wrong", "test-cron-secret", "bearer test-cron-secret"]) {
      expect((await call(authorization)).status).toBe(401);
    }
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);

    expect((await getOrderRow(reference)).status).toBe("pending_payment");
  });

  it("expires unpaid orders past their window", async () => {
    const userId = await createUser();
    const product = await createProduct(5);
    const reference = await createOrder(userId, [[product, 2]]);
    await ageOrder(reference, 61);

    const response = await call("Bearer test-cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ expired: 1, guestCarts: 0 });
    expect((await getOrderRow(reference)).status).toBe("expired");
    expect(await getStock(product)).toBe(5);
  });
});
