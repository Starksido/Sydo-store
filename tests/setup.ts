// Runs in each test worker before the test files import `@/db`.
import { connectTestDatabase } from "./test-env";

connectTestDatabase();

// Fixed fake values, whatever is in the environment: Paystack is always mocked (tests/paystack-mock.ts)
// and no test may reach the real API.
process.env.PAYSTACK_SECRET_KEY = "sk_test_0000000000000000000000000000000000000000";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CRON_SECRET = "test-cron-secret";
// Only for signing test sessions; tests that use the real Better Auth instance need one that passes
// the checks in src/lib/auth.ts.
process.env.BETTER_AUTH_SECRET = "58bcc4abea633cd39800a4c719886e9c8e3793987eec6493bfe9d6243b867aa9";
delete process.env.BETTER_AUTH_SECRETS;
