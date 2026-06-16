import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSaasConfig } from "./config.js";

async function main() {
  const config = loadSaasConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: config.databaseUrl });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, "..", "..", "migrations");
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  try {
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await pool.query(sql);
      console.log(`Applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

