import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export type OpenApiDocument = Record<string, unknown> & {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
};

export function repositoryRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..");
}

export async function loadOpenApiContract(): Promise<OpenApiDocument> {
  const source = await fs.readFile(
    path.join(repositoryRoot(), "doc", "contracts", "backend-api-v1.openapi.yaml"),
    "utf8",
  );
  return parse(source) as OpenApiDocument;
}

export function resolveLocalRef(document: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local OpenAPI references are supported: ${ref}`);
  }
  return ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((value, segment) => {
      if (!value || typeof value !== "object" || !(segment in value)) {
        throw new Error(`OpenAPI reference does not resolve: ${ref}`);
      }
      return (value as Record<string, unknown>)[segment];
    }, document);
}
