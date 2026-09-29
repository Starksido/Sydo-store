// Runs in each test worker before the test files import `@/db`.
import { connectTestDatabase } from "./test-env";

connectTestDatabase();

// Fixed fake values, whatever is in the environment: Paystack is always mocked (tests/paystack-mock.ts)
// and no test may reach the real API.
process.env.PAYSTACK_SECRET_KEY = "sk_test_0000000000000000000000000000000000000000";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CRON_SECRET = "test-cron-secret";
