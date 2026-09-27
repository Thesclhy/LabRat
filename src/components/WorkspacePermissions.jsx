import { createContext, useContext } from "react";

export const WorkspacePermissions = createContext({ canEdit: true, canApprove: true, canExport: true, canAsk: true });
export const useWorkspacePermissions = () => useContext(WorkspacePermissions);
export function permissionsForProject(project) {
  const capabilities = Array.isArray(project?.capabilities) ? project.capabilities : [];
  return {
    canAsk: !project?.shellOnly && project?.canAskResearchQuestions === true,
    canEdit: !project?.shellOnly && capabilities.includes("propose"),
    canApprove: !project?.shellOnly && capabilities.includes("approve"),
    canExport: !project?.shellOnly && capabilities.includes("export"),
  };
}
