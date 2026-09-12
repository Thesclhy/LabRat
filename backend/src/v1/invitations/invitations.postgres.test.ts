import { Pool } from "pg";
import { describe, expect, test } from "vitest";
import { hashPassword } from "../../saas/passwords.js";
import { createV1Application } from "../bootstrap.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";

const url = process.env.LABRAT_TEST_DATABASE_URL;
const password = "InvitationTest123!";
const cookieFrom = (response: { headers: Record<string, unknown> }) => String(response.headers["set-cookie"] || "").split(";")[0]!;

describe.skipIf(!url)("invitation onboarding PostgreSQL", () => {
  test("registration, redemption, grants, conflicts, revocation and rejoin preserve isolation", async () => {
    await withTestSchema(url!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl, { through: "027_authorization_v1.sql" });
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`insert into users (id, username, display_name, password_hash, is_super_admin, created_at, updated_at)
        values ('platform','platform','Platform',$1,true,now(),now())`, [hashPassword(password)]);
      await applyTestMigrations(databaseUrl, { only: "028_invitation_onboarding.sql" });
      await applyTestMigrations(databaseUrl, { only: "028_invitation_onboarding.sql" });
      process.env.NODE_ENV = "test";
      process.env.LABRAT_AI_PROVIDER = "anthropic";
      process.env.DATABASE_URL = databaseUrl;
      const app = await createV1Application({ logger: false });
      let sequence = 0;
      const post = (path: string, body: object = {}, cookie = "") => app.inject({
        method: "POST", url: "/api/v1" + path, payload: body,
        headers: { cookie }, remoteAddress: "192.0.2." + (++sequence),
      });
      const get = (path: string, cookie = "") => app.inject({ method: "GET", url: "/api/v1" + path, headers: { cookie } });
      try {
        const platform = cookieFrom(await post("/auth/login", { username: "platform", password }));
        const ownerInviteResponse = await post("/admin/invitations", {}, platform);
        expect(ownerInviteResponse.statusCode).toBe(201);
        const ownerInvite = ownerInviteResponse.json();
        expect(ownerInvite.invitationCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const ownerResponse = await post("/auth/register", {
          invitationCode: ownerInvite.invitationCode, username: "owner", displayName: "Owner", password, labName: "Lab One",
        });
        expect(ownerResponse.statusCode, ownerResponse.body).toBe(201);
        expect(ownerResponse.headers["set-cookie"]).toContain("HttpOnly");
        const owner = cookieFrom(ownerResponse);
        const labId = ownerResponse.json().lab.id;
        expect(ownerResponse.json().auth.user.isSuperAdmin).toBe(false);
        expect((await get("/auth/me", owner)).json().memberships).toEqual([{ labId, role: "lab_owner", status: "active" }]);
        expect((await post("/admin/invitations", {}, owner)).statusCode).toBe(403);
        const projectResponse = await post("/projects", { labId, name: "Project One" }, owner);
        expect(projectResponse.statusCode, projectResponse.body).toBe(201);
        const projectId = projectResponse.json().project.id;
        expect((await get(`/projects/${projectId}`, platform)).statusCode).toBe(404);

        // Fail at the last write, after user/lab/membership/session creation and code consumption.
        const rollbackInvite = (await post("/admin/invitations", {}, platform)).json();
        const counts = async () => (await pool.query(`select
          (select count(*)::int from users) users,
          (select count(*)::int from labs) labs,
          (select count(*)::int from lab_memberships) memberships,
          (select count(*)::int from sessions) sessions,
          (select count(*)::int from audit_events) audits`)).rows[0];
        const beforeFailure = await counts();
        await pool.query(`create function fail_registration_audit() returns trigger language plpgsql as $$
          begin
            if new.action = 'invitation.register' then
              raise exception 'Synthetic final-write failure';
            end if;
            return new;
          end $$;
          create trigger qa_registration_audit before insert on audit_events
            for each row execute function fail_registration_audit()`);
        try {
          const failed = await post("/auth/register", {
            invitationCode: rollbackInvite.invitationCode, username: "rollback_user",
            displayName: "Rollback QA", password, labName: "Never committed lab",
          });
          expect(failed.statusCode).toBe(500);
          expect(failed.headers["set-cookie"]).toBeUndefined();
          expect(await counts()).toEqual(beforeFailure);
          expect((await post("/auth/invitations/preview", { invitationCode: rollbackInvite.invitationCode })).statusCode).toBe(200);
          expect((await pool.query("select redeemed_at from invitations where id=$1", [rollbackInvite.invitation.id])).rows[0].redeemed_at).toBe(null);
        } finally {
          await pool.query("drop trigger qa_registration_audit on audit_events; drop function fail_registration_audit()");
        }

        const issueMember = async () => {
          const response = await post(`/labs/${labId}/invitations`, {}, owner);
          expect(response.statusCode, response.body).toBe(201);
          return response.json();
        };
        const invite = await issueMember();
        const preview = await post("/auth/invitations/preview", { invitationCode: invite.invitationCode });
        expect(preview.json()).toMatchObject({ kind: "lab_member", lab: { id: labId, name: "Lab One" } });
        const conflict = await post("/auth/register", { invitationCode: invite.invitationCode, username: "owner", displayName: "Member", password });
        expect(conflict.statusCode, conflict.body).toBe(409);
        expect((await post("/auth/invitations/preview", { invitationCode: invite.invitationCode })).statusCode).toBe(200);
        const attempts = await Promise.all(["member", "racer"].map((username) => post("/auth/register", {
          invitationCode: invite.invitationCode, username, displayName: "Employee", password,
        })));
        expect(attempts.map((r) => r.statusCode).sort()).toEqual([201, 410]);
        const memberResponse = attempts.find((r) => r.statusCode === 201)!;
        const member = cookieFrom(memberResponse);
        const userId = memberResponse.json().auth.user.id;
        expect(memberResponse.json().auth.memberships[0].role).toBe("lab_member");
        expect((await get(`/projects?labId=${labId}`, member)).json().items).toEqual([]);
        expect((await post("/projects", { labId, name: "No" }, member)).statusCode).toBe(403);
        expect((await post(`/labs/${labId}/invitations`, {}, member)).statusCode).toBe(403);
        expect((await post("/admin/invitations", {}, member)).statusCode).toBe(403);
        expect((await post(`/labs/${labId}/invitations/${invite.invitation.id}/revoke`, {}, owner)).statusCode).toBe(409);
        const setAccess = (preset: string, expectedGrantId: string | null, cookie = owner) => app.inject({
          method: "PUT", url: `/api/v1/projects/${projectId}/member-access/${userId}`,
          headers: { cookie }, payload: { preset, expectedGrantId },
        });
        expect((await setAccess("approve", null, member)).statusCode).toBe(403);
        let accessResponse = await setAccess("view", null);
        expect(accessResponse.statusCode, accessResponse.body).toBe(200);
        let grantId = accessResponse.json().memberAccess.directGrant.id;
        expect(accessResponse.json().memberAccess.effectiveAccess.capabilities).toEqual(["read", "export"]);
        expect((await get(`/projects/${projectId}`, member)).statusCode).toBe(200);
        expect((await setAccess("edit", null)).statusCode).toBe(409);
        const races = await Promise.all([setAccess("edit", grantId), setAccess("approve", grantId)]);
        expect(races.map((r) => r.statusCode).sort()).toEqual([200, 409]);
        grantId = races.find((r) => r.statusCode === 200)!.json().memberAccess.directGrant.id;
        accessResponse = await setAccess("approve", grantId);
        expect(accessResponse.json().memberAccess.effectiveAccess.capabilities).not.toContain("manage_access");
        grantId = accessResponse.json().memberAccess.directGrant.id;
        const group = (await post(`/labs/${labId}/groups`, { name: "Existing group" }, owner)).json().group;
        await app.inject({ method: "PUT", url: `/api/v1/labs/${labId}/groups/${group.id}/members/${userId}`, headers: { cookie: owner } });
        await post(`/projects/${projectId}/access-grants`, {
          subject: { type: "group", id: group.id }, scope: "all_experiments", capabilities: ["read", "export"],
        }, owner);
        const none = (await setAccess("none", grantId)).json().memberAccess;
        expect(none.directGrant).toBe(null);
        expect(none.effectiveAccess.capabilities).toEqual(["read", "export"]);
        expect(none.sources.some((source: { type: string }) => source.type === "group")).toBe(true);
        const page = (await get(`/projects/${projectId}/member-access?limit=1`, owner)).json();
        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).toBeTruthy();
        expect((await get(`/projects/${projectId}/member-access?cursor=invalid`, owner)).statusCode).toBe(400);

        const secondInvite = (await post("/admin/invitations", {}, platform)).json();
        const secondLab = await post("/auth/invitations/redeem", { invitationCode: secondInvite.invitationCode, labName: "Lab Two" }, member);
        expect(secondLab.statusCode, secondLab.body).toBe(200);
        const labTwo = secondLab.json().lab.id;
        const secondProject = (await post("/projects", { labId: labTwo, name: "Retained project" }, member)).json().project.id;
        expect((await get(`/projects/${secondProject}`, owner)).statusCode).toBe(404);
        await setAccess("view", null);
        const removal = await app.inject({ method: "DELETE", url: `/api/v1/labs/${labId}/members/${userId}`, headers: { cookie: owner } });
        expect(removal.statusCode).toBe(200);
        expect((await get(`/projects/${projectId}`, member)).statusCode).toBe(404);
        expect((await get(`/projects/${secondProject}`, member)).statusCode).toBe(200);
        const rejoin = await issueMember();
        expect((await post("/auth/invitations/redeem", { invitationCode: rejoin.invitationCode }, member)).statusCode).toBe(200);
        expect((await get(`/projects?labId=${labId}`, member)).json().items).toEqual([]);
        const priorAccess = await pool.query("select status from project_access_grants where user_id=$1 and lab_id=$2", [userId, labId]);
        expect(priorAccess.rows.every((r) => r.status === "inactive")).toBe(true);
        expect((await pool.query("select status from lab_group_members where user_id=$1 and lab_id=$2", [userId, labId])).rows[0].status).toBe("inactive");

        const revoked = await issueMember();
        await post(`/labs/${labId}/invitations/${revoked.invitation.id}/revoke`, {}, owner);
        expect((await post("/auth/invitations/preview", { invitationCode: revoked.invitationCode })).json().error.code).toBe("invitation_revoked");
        const expired = await issueMember();
        await pool.query("update invitations set created_at=now()-interval '8 days', expires_at=now()-interval '1 day' where id=$1", [expired.invitation.id]);
        expect((await post("/auth/invitations/preview", { invitationCode: expired.invitationCode })).json().error.code).toBe("invitation_expired");
        const staleIssuer = await issueMember();
        await pool.query("update users set is_active=false where id=$1", [ownerResponse.json().auth.user.id]);
        expect((await post("/auth/invitations/preview", { invitationCode: staleIssuer.invitationCode })).statusCode).toBe(403);
        const bad = await post("/auth/invitations/preview", { invitationCode: "A".repeat(43) });
        expect(bad.statusCode).toBe(400);
        const leakCheck = JSON.stringify((await pool.query("select * from invitations")).rows)
          + JSON.stringify((await pool.query("select * from audit_events")).rows)
          + (await get("/admin/invitations", platform)).body;
        expect(leakCheck).not.toContain(invite.invitationCode);
        expect(leakCheck).not.toContain(password);
        expect((await pool.query("select count(*)::int count from users where username in ('member','racer')")).rows[0].count).toBe(1);
      } finally {
        await app.close();
        await pool.end();
        delete process.env.DATABASE_URL;
      }
    });
  });
});
