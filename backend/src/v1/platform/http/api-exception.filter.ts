import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "./api-error.js";

interface PublicException {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function publicException(exception: unknown): PublicException {
  if (exception instanceof ApiError) {
    return {
      statusCode: exception.statusCode,
      code: exception.code,
      message: exception.message,
      ...(exception.details ? { details: exception.details } : {}),
    };
  }

  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const body = typeof response === "object" && response
      ? response as Record<string, unknown>
      : {};
    const rawMessage = body.message;
    const validationMessages = Array.isArray(rawMessage)
      ? rawMessage.map(String).slice(0, 20)
      : null;
    return {
      statusCode,
      code: statusCode === HttpStatus.BAD_REQUEST
        ? "invalid_request"
        : statusCode === HttpStatus.UNAUTHORIZED
          ? "unauthorized"
          : statusCode === HttpStatus.FORBIDDEN
            ? "forbidden"
            : statusCode === HttpStatus.NOT_FOUND
              ? "not_found"
              : "request_failed",
      message: validationMessages
        ? "Request validation failed."
        : String(rawMessage || exception.message || "Request failed."),
      ...(validationMessages ? { details: { errors: validationMessages } } : {}),
    };
  }

  if (exception && typeof exception === "object") {
    const candidate = exception as Record<string, unknown>;
    const statusCode = Number(candidate.statusCode);
    const code = String(candidate.code || "");
    if (statusCode >= 400 && statusCode < 500 && /^[a-z][a-z0-9_]{1,79}$/.test(code)) {
      const details = candidate.details && typeof candidate.details === "object"
        && !Array.isArray(candidate.details)
        ? candidate.details as Record<string, unknown>
        : undefined;
      return {
        statusCode,
        code,
        message: String(candidate.message || "Request failed."),
        ...(details ? { details } : {}),
      };
    }
  }

  return {
    statusCode: 500,
    code: "internal_error",
    message: "Request failed.",
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const output = publicException(exception);
    if (output.statusCode >= 500) {
      console.error(`[${request.id}] v1 request failed`, exception);
    }
    void reply.status(output.statusCode).send({
      error: {
        code: output.code,
        message: output.message,
        requestId: String(request.id),
        ...(output.details ? { details: output.details } : {}),
      },
    });
  }
}
