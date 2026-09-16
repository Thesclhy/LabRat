import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { createV1Application } from "./bootstrap.js";

export async function startV1Server(): Promise<void> {
  const app = await createV1Application();
  const host = process.env.V1_HOST || process.env.HOST || "127.0.0.1";
  const port = Number(process.env.V1_PORT || process.env.PORT || 8788);
  await app.listen(port, host);
  console.log(`LabRat v1 backend listening at http://${host}:${port}`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  startV1Server().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
