import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, test } from "vitest";
import { ApplyReusableChartTemplateDto } from "./reusable-charts.dto.js";

describe("ApplyReusableChartTemplateDto", () => {
  test("accepts closed slot bindings", async () => {
    const input = plainToInstance(ApplyReusableChartTemplateDto, {
      experimentIds: ["experiment_1"],
      bindings: [{ slotId: "slot_yield", columnId: "column_yield" }],
    });

    await expect(validate(input, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    })).resolves.toEqual([]);
  });

  test("rejects unknown and incomplete nested binding fields", async () => {
    const input = plainToInstance(ApplyReusableChartTemplateDto, {
      experimentIds: ["experiment_1"],
      bindings: [{ slotId: "slot_yield", unexpectedColumn: "column_yield" }],
    });

    const errors = await validate(input, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    });

    expect(JSON.stringify(errors)).toContain("unexpectedColumn");
    expect(JSON.stringify(errors)).toContain("columnId");
  });
});
