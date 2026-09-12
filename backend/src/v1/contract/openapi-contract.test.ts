import fs from "node:fs/promises";
import path from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, test } from "vitest";
import {
  loadOpenApiContract,
  repositoryRoot,
  resolveLocalRef,
  type OpenApiDocument,
} from "./openapi-contract.js";

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

const AUTHORITATIVE_FIRST_SLICE = [
  "/api/v1/auth/register",
  "/api/v1/auth/invitations/preview",
  "/api/v1/auth/invitations/redeem",
  "/api/v1/admin/invitations",
  "/api/v1/admin/invitations/{invitationId}/revoke",
  "/api/v1/labs/{labId}/invitations",
  "/api/v1/labs/{labId}/invitations/{invitationId}/revoke",
  "/api/v1/projects/{projectId}/member-access",
  "/api/v1/projects/{projectId}/member-access/{userId}",
  "/health",
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/auth/me",
  "/api/v1/admin/labs",
  "/api/v1/admin/users",
  "/api/v1/admin/users/{userId}",
  "/api/v1/admin/users/{userId}/reset-password",
  "/api/v1/labs",
  "/api/v1/labs/{labId}/members",
  "/api/v1/labs/{labId}/members/{userId}",
  "/api/v1/projects",
  "/api/v1/projects/{projectId}",
  "/api/v1/projects/{projectId}/profile",
  "/api/v1/labs/{labId}/groups",
  "/api/v1/labs/{labId}/groups/{groupId}",
  "/api/v1/labs/{labId}/groups/{groupId}/members/{userId}",
  "/api/v1/projects/{projectId}/access-grants",
  "/api/v1/projects/{projectId}/access-grants/{grantId}",
  "/api/v1/projects/{projectId}/access",
  "/api/v1/projects/{projectId}/data-plans",
  "/api/v1/projects/{projectId}/data-snapshots",
  "/api/v1/projects/{projectId}/experiment-browser",
  "/api/v1/projects/{projectId}/experiments/{experimentId}",
  "/api/v1/projects/{projectId}/experiment-annotations",
  "/api/v1/projects/{projectId}/experiments/{experimentId}/annotation",
  "/api/v1/projects/{projectId}/experiment-custom-columns",
  "/api/v1/projects/{projectId}/experiment-custom-columns/{columnId}",
  "/api/v1/projects/{projectId}/experiment-custom-columns/{columnId}/experiments/{experimentId}",
  "/api/v1/projects/{projectId}/browser-config",
  "/api/v1/projects/{projectId}/browser-views",
  "/api/v1/projects/{projectId}/browser-views/{viewId}",
  "/api/v1/projects/{projectId}/evidence/retrieve",
  "/api/v1/projects/{projectId}/files",
  "/api/v1/projects/{projectId}/import-runs",
  "/api/v1/projects/{projectId}/source-documents",
  "/api/v1/projects/{projectId}/workbook-review-sessions",
  "/api/v1/projects/{projectId}/region-understandings",
  "/api/v1/source-documents/{sourceDocumentId}/regions",
  "/api/v1/source-documents/{sourceDocumentId}/query",
  "/api/v1/source-documents/{sourceDocumentId}/range",
  "/api/v1/workbook-review-sessions/{sessionId}",
  "/api/v1/workbook-review-sessions/{sessionId}/regions",
  "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}",
  "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/interpret",
  "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/revisions",
  "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/confirm",
  "/api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/ignore",
  "/api/v1/projects/{projectId}/analysis-capabilities",
  "/api/v1/projects/{projectId}/agent/runs",
  "/api/v1/agent-runs/{agentRunId}",
  "/api/v1/agent-runs/{agentRunId}/cancel",
  "/api/v1/projects/{projectId}/analysis-threads",
  "/api/v1/analysis-threads/{threadId}",
  "/api/v1/analysis-threads/{threadId}/plan-revisions",
  "/api/v1/analysis-threads/{threadId}/retry",
  "/api/v1/analysis-plan-revisions/{revisionId}/selection",
  "/api/v1/analysis-plan-revisions/{revisionId}/accept",
  "/api/v1/analysis-runs/{runId}",
  "/api/v1/analysis-runs/{runId}/execute",
  "/api/v1/analysis-runs/{runId}/retry",
  "/api/v1/analysis-runs/{runId}/revise",
  "/api/v1/analysis-runs/{runId}/result-preview",
  "/api/v1/analysis-runs/{runId}/accept-and-create-chart",
  "/api/v1/analysis-runs/{runId}/accept-and-publish-experiments",
  "/api/v1/projects/{projectId}/chart-specs",
  "/api/v1/chart-specs/{chartSpecId}",
  "/api/v1/projects/{projectId}/chart-style-profiles",
  "/api/v1/chart-style-profiles/{chartStyleProfileId}",
  "/api/v1/chart-style-profiles/{chartStyleProfileId}/versions",
  "/api/v1/chart-style-profiles/{chartStyleProfileId}/archive",
  "/api/v1/projects/{projectId}/reusable-chart-templates",
  "/api/v1/reusable-chart-templates/{reusableChartTemplateId}",
  "/api/v1/reusable-chart-templates/{reusableChartTemplateId}/versions",
  "/api/v1/reusable-chart-templates/{reusableChartTemplateId}/archive",
  "/api/v1/chart-specs/{chartSpecId}/template-eligibility",
  "/api/v1/reusable-chart-template-versions/{templateVersionId}/applications",
  "/api/v1/projects/{projectId}/manuscripts",
  "/api/v1/manuscripts/{manuscriptId}",
];

function operation(document: OpenApiDocument, pathName: string, method: string): Record<string, unknown> {
  const candidate = document.paths[pathName]?.[method.toLowerCase()];
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`Missing ${method.toUpperCase()} ${pathName}`);
  }
  if ("$ref" in candidate) {
    return resolveLocalRef(document, String(candidate.$ref)) as Record<string, unknown>;
  }
  return candidate as Record<string, unknown>;
}

function inventoryOperations(source: string): Array<{ method: string; path: string }> {
  const operations: Array<{ method: string; path: string }> = [];
  const pattern = /^\| `([A-Z]+(?:, [A-Z]+)*) (\/api\/v1\/[^`]+)` \|/gm;
  for (const match of source.matchAll(pattern)) {
    const methods = match[1]?.split(", ") ?? [];
    const pathName = match[2];
    if (!pathName) continue;
    for (const method of methods) operations.push({ method, path: pathName });
  }
  return operations;
}

describe("backend API v1 contract", () => {
  test("passes a standard OpenAPI 3.1 parser", async () => {
    await expect(SwaggerParser.validate(path.join(
      repositoryRoot(),
      "doc",
      "contracts",
      "backend-api-v1.openapi.yaml",
    ))).resolves.toBeDefined();
  });

  test("is valid YAML with the versioned path and bounded error policy", async () => {
    const document = await loadOpenApiContract();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/health"]).toBeDefined();
    for (const pathName of Object.keys(document.paths)) {
      expect(pathName === "/health" || pathName.startsWith("/api/v1/")).toBe(true);
    }

    const components = document.components as Record<string, Record<string, unknown>>;
    const schemas = components.schemas as Record<string, Record<string, unknown>>;
    const errorResponse = schemas.ErrorResponse;
    if (!errorResponse) throw new Error("OpenAPI ErrorResponse schema is missing.");
    const properties = errorResponse.properties as Record<string, Record<string, unknown>>;
    const errorProperty = properties.error;
    if (!errorProperty) throw new Error("OpenAPI ErrorResponse.error property is missing.");
    expect(errorProperty.required).toEqual(["code", "message", "requestId"]);
  });

  test("contains no migration-only operation placeholders", async () => {
    const document = await loadOpenApiContract();
    for (const [pathName, pathItem] of Object.entries(document.paths)) {
      for (const [method, candidate] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        const resolved = operation(document, pathName, method);
        expect(resolved["x-labrat-schema-status"], `${method} ${pathName}`).not.toBe("planned");
        expect(candidate && typeof candidate === "object" && "$ref" in candidate, `${method} ${pathName}`).toBe(false);
      }
    }
  });

  test("covers every active operation in the migration inventory", async () => {
    const document = await loadOpenApiContract();
    const inventory = await fs.readFile(
      path.join(repositoryRoot(), "doc", "reports", "backend-api-v1-migration-inventory.md"),
      "utf8",
    );
    const expected = inventoryOperations(inventory);
    expect(expected.length).toBeGreaterThan(50);
    for (const item of expected) {
      expect(
        document.paths[item.path]?.[item.method.toLowerCase()],
        `${item.method} ${item.path}`,
      ).toBeDefined();
    }
  });

  test("first-slice DTOs are closed rather than migration placeholders", async () => {
    const document = await loadOpenApiContract();
    for (const pathName of AUTHORITATIVE_FIRST_SLICE) {
      const pathItem = document.paths[pathName];
      expect(pathItem, pathName).toBeDefined();
      for (const [method] of Object.entries(pathItem ?? {})) {
        if (!HTTP_METHODS.has(method)) continue;
        expect(operation(document, pathName, method)["x-labrat-schema-status"]).not.toBe("planned");
      }
    }
  });

  test("authoritative operations have unique ids and declare every path parameter", async () => {
    const document = await loadOpenApiContract();
    const operationIds = new Set<string>();
    for (const pathName of AUTHORITATIVE_FIRST_SLICE) {
      const pathItem = document.paths[pathName] as Record<string, unknown>;
      const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
      for (const [method] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        const resolved = operation(document, pathName, method);
        const operationId = String(resolved.operationId || "");
        expect(operationId, `${method} ${pathName}`).not.toBe("");
        expect(operationIds.has(operationId), operationId).toBe(false);
        operationIds.add(operationId);

        const operationParameters = Array.isArray(resolved.parameters) ? resolved.parameters : [];
        const parameters = [...pathParameters, ...operationParameters].map((parameter) => (
          parameter && typeof parameter === "object" && "$ref" in parameter
            ? resolveLocalRef(document, String((parameter as Record<string, unknown>).$ref))
            : parameter
        )) as Array<Record<string, unknown>>;
        for (const name of [...pathName.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])) {
          expect(parameters.some((parameter) => parameter.in === "path" && parameter.name === name), `${method} ${pathName} ${name}`).toBe(true);
        }
      }
    }
  });
});
