import { Injectable } from "@nestjs/common";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { AuthContext } from "../identity/identity.types.js";
import { ApiError } from "../platform/http/api-error.js";
import type { ChartSpecPageQueryDto } from "./chart.dto.js";
import { ChartRepository } from "./chart.repository.js";

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function supported(chartSpec: Record<string, any>): boolean {
  return chartSpec.spec?.origin === "analysis_result"
    && chartSpec.spec?.schemaVersion === "labrat.chartSpec.v3";
}

export function chartSpecListItem(chartSpec: Record<string, any>) {
  const spec = chartSpec.spec && typeof chartSpec.spec === "object" ? chartSpec.spec : {};
  const { plotly: _plotly, sourceSelections, sourceRefs, traceCatalog, ...metadata } = spec;
  return {
    ...chartSpec,
    spec: {
      ...metadata,
      traceCatalog: asArray<Record<string, any>>(traceCatalog).map((trace) => ({
        traceId: trace.traceId || null,
        name: trace.name || null,
        type: trace.type || null,
        pointCount: Number(trace.pointCount) || 0,
      })),
      sourceSelectionCount: asArray(sourceSelections).length,
      sourceRefCount: asArray(sourceRefs).length,
      plotlyTraceCount: asArray(spec.plotly?.data).length,
      detailRequired: true,
    },
  };
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isInteger(value?.offset) || value.offset < 0) throw new Error("invalid");
    return value.offset;
  } catch {
    throw new ApiError(400, "invalid_cursor", "The pagination cursor is invalid.");
  }
}

@Injectable()
export class ChartService {
  constructor(
    private readonly repository: ChartRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(auth: AuthContext, projectId: string, query: ChartSpecPageQueryDto) {
    await this.authorization.requireFullProjectCapability(auth, projectId, "read");
    const offset = decodeCursor(query.cursor);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const chartSpecs = (await this.repository.listChartSpecs(projectId))
      .filter((chartSpec) => supported(chartSpec));
    const items = chartSpecs.slice(offset, offset + limit).map(chartSpecListItem);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < chartSpecs.length ? encodeCursor(nextOffset) : null,
    };
  }

  async detail(auth: AuthContext, chartSpecId: string) {
    const chartSpec = await this.repository.findChartSpecById(chartSpecId);
    if (!chartSpec || !supported(chartSpec)) {
      throw new ApiError(404, "chart_spec_not_found", "ChartSpec not found.");
    }
    const resolved = await this.authorization.resolveProjectAccess(auth, chartSpec.projectId);
    if (!resolved?.access?.allExperiments) {
      throw new ApiError(404, "chart_spec_not_found", "ChartSpec not found.");
    }
    if (!resolved.access.capabilities.includes("read")) {
      throw new ApiError(403, "forbidden", "Full-project capability read is required.");
    }
    return chartSpec;
  }
}
