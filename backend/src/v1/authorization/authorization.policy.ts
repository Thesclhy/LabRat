import type { LabRole } from "../identity/identity.types.js";

export const CAPABILITIES = [
  "read",
  "propose",
  "approve",
  "export",
  "manage_access",
] as const;

export type Capability = typeof CAPABILITIES[number];
export type GrantScope = "all_experiments" | "selected_experiments";

export interface ProjectGrantInput {
  scope: GrantScope;
  capabilities: string[];
}

export interface ExperimentGrantInput {
  experimentId: string;
  capabilities: string[];
}

export interface EffectiveProjectAccess {
  projectId: string;
  shellOnly: boolean;
  capabilities: Capability[];
  allExperiments: boolean;
  experimentIds: string[];
  experimentCapabilities: Record<string, Capability[]>;
}

const CAPABILITY_SET = new Set<string>(CAPABILITIES);

export function normalizeCapabilities(values: readonly string[]): Capability[] {
  return [...new Set(values.filter((value): value is Capability => CAPABILITY_SET.has(value)))]
    .sort((left, right) => CAPABILITIES.indexOf(left) - CAPABILITIES.indexOf(right));
}

export function resolveEffectiveProjectAccess(input: {
  projectId: string;
  labRole: LabRole | null;
  projectGrants: ProjectGrantInput[];
  experimentGrants: ExperimentGrantInput[];
}): EffectiveProjectAccess | null {
  if (input.labRole === "lab_owner" || input.labRole === "lab_admin") {
    return {
      projectId: input.projectId,
      shellOnly: false,
      capabilities: [...CAPABILITIES],
      allExperiments: true,
      experimentIds: [],
      experimentCapabilities: {},
    };
  }
  if (input.labRole !== "lab_member") return null;

  const allExperiments = input.projectGrants.some(
    (grant) => grant.scope === "all_experiments",
  );
  // A full-project read grant must not promote selected-experiment privileges
  // into full-project edit/approval privileges.
  const projectCapabilities = normalizeCapabilities(
    input.projectGrants
      .filter((grant) => !allExperiments || grant.scope === "all_experiments")
      .flatMap((grant) => grant.capabilities),
  );
  const experimentCapabilities: Record<string, Capability[]> = {};
  for (const grant of input.experimentGrants) {
    experimentCapabilities[grant.experimentId] = normalizeCapabilities([
      ...(experimentCapabilities[grant.experimentId] || []),
      ...grant.capabilities,
    ]);
  }
  const experimentIds = Object.keys(experimentCapabilities).sort();
  const hasProjectAccess = projectCapabilities.length > 0;
  if (!hasProjectAccess && experimentIds.length === 0) return null;

  return {
    projectId: input.projectId,
    shellOnly: !allExperiments,
    capabilities: projectCapabilities,
    allExperiments,
    experimentIds,
    experimentCapabilities,
  };
}

export function hasProjectCapability(
  access: EffectiveProjectAccess | null,
  capability: Capability,
): boolean {
  return Boolean(access?.capabilities.includes(capability));
}

export function hasExperimentCapability(
  access: EffectiveProjectAccess | null,
  experimentId: string,
  capability: Capability,
): boolean {
  if (!access) return false;
  if (access.allExperiments && access.capabilities.includes(capability)) return true;
  return Boolean(access.experimentCapabilities[experimentId]?.includes(capability));
}
