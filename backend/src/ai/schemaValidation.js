import Ajv from "ajv";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});
const validatorCache = new WeakMap();

function validatorFor(schema) {
  if (!schema || typeof schema !== "object") return null;
  let validator = validatorCache.get(schema);
  if (!validator) {
    validator = ajv.compile(schema);
    validatorCache.set(schema, validator);
  }
  return validator;
}

export function summarizeSchemaErrors(errors, limit = 8) {
  return (Array.isArray(errors) ? errors : [])
    .slice(0, limit)
    .map((error) => {
      const location = String(error?.instancePath || "/");
      const message = String(error?.message || "does not match the required schema");
      return `${location} ${message}`;
    });
}

export function validateJsonSchema(schema, value) {
  if (!schema) return { valid: true, errors: [] };
  try {
    const validator = validatorFor(schema);
    if (!validator) return { valid: true, errors: [] };
    const valid = Boolean(validator(value));
    return {
      valid,
      errors: valid ? [] : summarizeSchemaErrors(validator.errors),
    };
  } catch (error) {
    return {
      valid: false,
      errors: [`/ schema validation failed: ${String(error?.message || error).slice(0, 300)}`],
    };
  }
}
