import cookie from "@fastify/cookie";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./platform/http/api-exception.filter.js";

export interface CreateV1ApplicationOptions {
  logger?: false | Array<"error" | "warn" | "log" | "debug" | "verbose" | "fatal">;
}

export async function createV1Application(
  options: CreateV1ApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: options.logger ?? ["error", "warn", "log"],
  });
  await app.register(cookie);
  app.getHttpAdapter().getInstance().addContentTypeParser(
    /^multipart\/form-data/i,
    { parseAs: "buffer", bodyLimit: 25 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: false,
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
