// Points the tests at the test database and refuses anything that could be store data.
// Only `.env.test.local` is loaded, never `.env.local`, and there is no fallback to DATABASE_URL.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(import.meta.dirname, "..", ".env.test.local");

export function assertTestDatabaseName(name: string) {
  if (!/_test$/.test(name)) {
    throw new Error(`Refusing to run tests: database "${name}" doesn't end in "_test".`);
  }
}

/** Returns TEST_DATABASE_URL after checking it, and makes `@/db` use it. */
export function connectTestDatabase() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Refusing to run tests: TEST_DATABASE_URL is not set. Put the connection string of an empty " +
        "Neon database whose name ends in _test (e.g. sydo_test) in .env.test.local.",
    );
  }
  assertTestDatabaseName(decodeURIComponent(new URL(url).pathname.slice(1)));
  process.env.DATABASE_URL = url;
  return url;
}
