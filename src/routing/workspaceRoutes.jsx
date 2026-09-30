import React from "react";
import { matchRoutes } from "react-router";

export const APP_BASENAME = "/LabRat";
const pages = ["overview", "browser", "manuscript", "references"];
const routes = [
  { index: true, handle: { kind: "root" } },
  { path: "login", handle: { kind: "login" } },
  { path: "labs/:labId/projects", handle: { kind: "dashboard" } },
  { path: "projects/:projectId", handle: { kind: "project-root" } },
  ...pages.map((tab) => ({ path: `projects/:projectId/${tab}`, handle: { kind: "project", tab } })),
  { path: "*", handle: { kind: "not-found" } },
];

// The parent element is stable across all pages; project drafts live there.
export const workspaceRoutes = (element) => [{ path: "/", element, children: routes.map((route) => ({ ...route, element: <></> })) }];
export function readWorkspaceRoute(pathname) {
  const match = matchRoutes(workspaceRoutes(null), pathname)?.at(-1);
  return { ...match?.route.handle, ...match?.params };
}
export const projectPath = (projectId, tab = "overview") => `/projects/${encodeURIComponent(projectId)}/${tab}`;
export const dashboardPath = (labId) => labId ? `/labs/${encodeURIComponent(labId)}/projects` : "/";

export function loginReturnPath(search) {
  const value = new URLSearchParams(search).get("returnTo");
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f]/.test(value)) return "/";
  const pathname = value.split(/[?#]/)[0];
  return ["project", "project-root", "dashboard"].includes(readWorkspaceRoute(pathname).kind) ? value : "/";
}
