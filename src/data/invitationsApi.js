import { apiV1Request } from "./backendApiV1Client.ts";

export const previewInvitation = (invitationCode) => apiV1Request("post", "/api/v1/auth/invitations/preview", { body: { invitationCode } });
export const registerWithInvitation = (body) => apiV1Request("post", "/api/v1/auth/register", { body });
export const redeemInvitation = (body) => apiV1Request("post", "/api/v1/auth/invitations/redeem", { body });
export const createInvitation = (labId = "") => labId
  ? apiV1Request("post", "/api/v1/labs/{labId}/invitations", { pathParams: { labId }, body: {} })
  : apiV1Request("post", "/api/v1/admin/invitations", { body: {} });
export const listInvitations = (labId = "", cursor = "") => labId
  ? apiV1Request("get", "/api/v1/labs/{labId}/invitations", { pathParams: { labId }, query: { limit: 30, ...(cursor ? { cursor } : {}) } })
  : apiV1Request("get", "/api/v1/admin/invitations", { query: { limit: 30, ...(cursor ? { cursor } : {}) } });
export const revokeInvitation = (labId, invitationId) => labId
  ? apiV1Request("post", "/api/v1/labs/{labId}/invitations/{invitationId}/revoke", { pathParams: { labId, invitationId } })
  : apiV1Request("post", "/api/v1/admin/invitations/{invitationId}/revoke", { pathParams: { invitationId } });
export const listLabMembers = (labId) => apiV1Request("get", "/api/v1/labs/{labId}/members", { pathParams: { labId } });
export const removeLabMember = (labId, userId) => apiV1Request("delete", "/api/v1/labs/{labId}/members/{userId}", { pathParams: { labId, userId } });
export const listMemberAccess = (projectId, cursor = "") => apiV1Request("get", "/api/v1/projects/{projectId}/member-access", {
  pathParams: { projectId }, query: { limit: 30, ...(cursor ? { cursor } : {}) },
});
export const setMemberAccess = (projectId, userId, preset, expectedGrantId) => apiV1Request("put", "/api/v1/projects/{projectId}/member-access/{userId}", {
  pathParams: { projectId, userId }, body: { preset, expectedGrantId },
});
