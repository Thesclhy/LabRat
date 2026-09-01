import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import {
  AnalysisPageQueryDto,
  AnalysisSelectionQueryDto,
  CreateAgentRunDto,
  CreateAnalysisPlanRevisionDto,
  CreateAnalysisThreadDto,
  ExecuteAnalysisRunDto,
  PublishAnalysisChartDto,
  PublishExperimentAnalysisDto,
  ReviseAnalysisRunDto,
} from "./analysis.dto.js";
import { AnalysisService } from "./analysis.service.js";

function requestMeta(request: FastifyRequest) {
  return {
    ipAddress: request.ip || null,
    userAgent: String(request.headers["user-agent"] || "") || null,
  };
}

function respondWithStatus(reply: FastifyReply, result: Record<string, any>) {
  reply.status(Number(result.statusCode) || 200);
  const { statusCode: _statusCode, ...body } = result;
  return body;
}

@Controller("api/v1/projects/:projectId")
export class ProjectAnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get("analysis-capabilities")
  capabilities(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return this.analysisService.capabilities(auth, projectId);
  }

  @Get("analysis-threads")
  listThreads(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Query() query: AnalysisPageQueryDto,
  ) {
    return this.analysisService.listThreads(auth, projectId, query);
  }

  @Post("analysis-threads")
  async createThread(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateAnalysisThreadDto,
  ) {
    return { analysisThread: await this.analysisService.createThread(auth, projectId, body) };
  }

  @Get("agent/runs")
  listAgentRuns(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Query() query: AnalysisPageQueryDto,
  ) {
    return this.analysisService.listAgentRunSummaries(auth, projectId, query);
  }

  @Post("agent/runs")
  createAgentRun(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: CreateAgentRunDto,
  ) {
    return this.analysisService.createAgentRun(auth, projectId, body);
  }
}

@Controller("api/v1/agent-runs/:agentRunId")
export class AgentRunController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get()
  async detail(@CurrentAuth() auth: AuthContext, @Param("agentRunId") agentRunId: string) {
    return { agentRun: await this.analysisService.getAgentRun(auth, agentRunId) };
  }

  @Post("cancel")
  @HttpCode(200)
  async cancel(@CurrentAuth() auth: AuthContext, @Param("agentRunId") agentRunId: string) {
    return { agentRun: await this.analysisService.cancelAgentRun(auth, agentRunId) };
  }
}

@Controller("api/v1/analysis-threads/:threadId")
export class AnalysisThreadController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get()
  detail(@CurrentAuth() auth: AuthContext, @Param("threadId") threadId: string) {
    return this.analysisService.threadDetail(auth, threadId);
  }

  @Post("plan-revisions")
  async createPlanRevision(
    @CurrentAuth() auth: AuthContext,
    @Param("threadId") threadId: string,
    @Body() body: CreateAnalysisPlanRevisionDto,
  ) {
    return { analysisPlanRevision: await this.analysisService.createPlanRevision(auth, threadId, body) };
  }

  @Post("retry")
  async retry(
    @CurrentAuth() auth: AuthContext,
    @Param("threadId") threadId: string,
    @Headers("idempotency-key") key: string | string[] | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return respondWithStatus(reply, await this.analysisService.retryThread(auth, threadId, key));
  }
}

@Controller("api/v1/analysis-plan-revisions/:revisionId")
export class AnalysisPlanRevisionController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get("selection")
  selection(
    @CurrentAuth() auth: AuthContext,
    @Param("revisionId") revisionId: string,
    @Query() query: AnalysisPageQueryDto,
  ) {
    return this.analysisService.selection(auth, revisionId, query);
  }

  @Post("accept")
  async accept(
    @CurrentAuth() auth: AuthContext,
    @Param("revisionId") revisionId: string,
    @Headers("idempotency-key") key: string | string[] | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return respondWithStatus(
      reply,
      await this.analysisService.acceptPlan(auth, revisionId, key, requestMeta(request)),
    );
  }
}

@Controller("api/v1/analysis-runs/:runId")
export class AnalysisRunController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get()
  detail(@CurrentAuth() auth: AuthContext, @Param("runId") runId: string) {
    return this.analysisService.runDetail(auth, runId);
  }

  @Post("execute")
  async execute(
    @CurrentAuth() auth: AuthContext,
    @Param("runId") runId: string,
    @Body() body: ExecuteAnalysisRunDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return respondWithStatus(
      reply,
      await this.analysisService.executeRun(auth, runId, body, requestMeta(request)),
    );
  }

  @Post("retry")
  async retry(
    @CurrentAuth() auth: AuthContext,
    @Param("runId") runId: string,
    @Headers("idempotency-key") key: string | string[] | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return respondWithStatus(
      reply,
      await this.analysisService.retryRun(auth, runId, key, requestMeta(request)),
    );
  }

  @Get("result-preview")
  preview(
    @CurrentAuth() auth: AuthContext,
    @Param("runId") runId: string,
    @Query() query: AnalysisSelectionQueryDto,
  ) {
    return this.analysisService.preview(auth, runId, query);
  }

  @Post("revise")
  revise(
    @CurrentAuth() auth: AuthContext,
    @Param("runId") runId: string,
    @Body() body: ReviseAnalysisRunDto,
  ) {
    return this.analysisService.reviseRun(auth, runId, body);
  }

  @Post("accept-and-create-chart")
  async publishChart(
    @CurrentAuth() auth: AuthContext,
    @Param("runId") runId: string,
    @Body() body: PublishAnalysisChartDto,
    @Headers("idempotency-key") key: string | string[] | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return respondWithStatus(
      reply,
      await this.analysisService.publishChart(auth, runId, body, key, requestMeta(request)),
    );
  }

  @Post("accept-and-publish-experiments")
  async publishExperiments(
    @CurrentAuth() auth: AuthContext,
    @Param("runId") runId: string,
    @Body() body: PublishExperimentAnalysisDto,
    @Headers("idempotency-key") key: string | string[] | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return respondWithStatus(
      reply,
      await this.analysisService.publishExperiments(auth, runId, body, key, requestMeta(request)),
    );
  }
}
