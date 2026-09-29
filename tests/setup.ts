// Runs in each test worker before the test files import `@/db`.
import { connectTestDatabase } from "./test-env";

connectTestDatabase();
