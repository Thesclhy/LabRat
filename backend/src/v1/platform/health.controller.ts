import { Controller, Get } from "@nestjs/common";
import { Public } from "./http/route-metadata.js";

@Controller()
export class HealthController {
  @Public()
  @Get("health")
  getHealth() {
    return {
      ok: true,
      service: "labrat-backend",
      apiVersion: "v1",
    } as const;
  }
}
