// Runs once before all tests: confirms on the server that this is a test database, then applies the
// committed migrations so the test schema always matches production's.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

import { assertTestDatabaseName, connectTestDatabase } from "./test-env";

export default async function setup() {
  const client = neon(connectTestDatabase());
  const [{ name }] = await client`select current_database() as name`;
  assertTestDatabaseName(name);
  await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
}
