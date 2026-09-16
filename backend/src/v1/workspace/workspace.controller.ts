import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentAuth } from "../identity/current-auth.js";
import type { AuthContext } from "../identity/identity.types.js";
import { CreateProjectDto, ProjectProfileDto, UpdateProjectDto } from "./workspace.dto.js";
import { WorkspaceService } from "./workspace.service.js";

@Controller("api/v1/projects")
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  async listProjects(@CurrentAuth() auth: AuthContext, @Query("labId") labId?: string) {
    return { items: await this.workspaceService.listProjects(auth, labId), nextCursor: null };
  }

  @Post()
  async createProject(@CurrentAuth() auth: AuthContext, @Body() body: CreateProjectDto) {
    return { project: await this.workspaceService.createProject(auth, body) };
  }

  @Get(":projectId")
  async getProject(@CurrentAuth() auth: AuthContext, @Param("projectId") projectId: string) {
    return { project: await this.workspaceService.getProject(auth, projectId) };
  }

  @Patch(":projectId")
  async updateProject(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: UpdateProjectDto,
  ) {
    return { project: await this.workspaceService.updateProject(auth, projectId, body) };
  }

  @Patch(":projectId/profile")
  async updateProjectProfile(
    @CurrentAuth() auth: AuthContext,
    @Param("projectId") projectId: string,
    @Body() body: ProjectProfileDto,
  ) {
    return { project: await this.workspaceService.updateProjectProfile(auth, projectId, body) };
  }
}
