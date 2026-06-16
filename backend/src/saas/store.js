import { MemorySaasStore } from "./memoryStore.js";

export async function createSaasStore(config) {
  if (config.databaseUrl) {
    const { PostgresSaasStore } = await import("./postgresStore.js");
    const store = new PostgresSaasStore(config);
    await store.initialize();
    return store;
  }
  return new MemorySaasStore({ seedDevAccounts: config.seedDevAccounts });
}

