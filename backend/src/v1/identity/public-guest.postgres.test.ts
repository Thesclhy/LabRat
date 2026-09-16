import { Pool } from "pg";
import { describe, expect, test } from "vitest";
import { hashPassword } from "../../saas/passwords.js";
import { createV1Application } from "../bootstrap.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { V1Config } from "../platform/config/v1-config.js";
import { applyTestMigrations, withTestSchema } from "../testing/postgres-test-database.js";
import { provisionPublicGuest } from "./public-guest-provision.js";

const url = process.env.LABRAT_TEST_DATABASE_URL;
const password = "PublicGuestTest2026!";
const adminPassword = "PrivateOperatorTest2026!";
const cookieFrom = (response: { headers: Record<string, unknown> }) => String(response.headers["set-cookie"] || "").split(";")[0]!;

describe.skipIf(!url)("public Guest PostgreSQL", () => {
  test("upgrade, atomic provisioning, shared-account isolation and revocation", async () => {
    await withTestSchema(url!, async ({ databaseUrl }) => {
      await applyTestMigrations(databaseUrl, { through: "029_region_template_apply_receipts.sql" });
      const pool = new Pool({ connectionString: databaseUrl });
      const database = new DatabaseService({ databaseUrl } as V1Config);
      try {
      await pool.query(`insert into users (id, username, display_name, password_hash, is_super_admin, created_at, updated_at)
        values ('operator','operator','Operator',$1,true,now(),now())`, [hashPassword(adminPassword)]);
      const beforeMigration = (await pool.query("select password_hash from users where id='operator'")).rows[0];
      await applyTestMigrations(databaseUrl, { only: "030_public_guest_accounts.sql" });
      await applyTestMigrations(databaseUrl, { only: "030_public_guest_accounts.sql" });
      expect((await pool.query("select password_hash from users where id='operator'")).rows[0]).toEqual(beforeMigration);
      const input = { username: "public_visitor", password, adminUsername: "operator" };
      const attempts = await Promise.all([provisionPublicGuest(database, input), provisionPublicGuest(database, input)]);
      expect(attempts.filter((attempt) => attempt.created)).toHaveLength(1);
      expect(attempts[0].userId).toBe(attempts[1].userId);
      const guest = attempts[0];
      const counts = async () => (await pool.query(`select
        (select count(*) from users)::int users, (select count(*) from labs)::int labs,
        (select count(*) from projects)::int projects, (select count(*) from public_guest_accounts)::int guests,
        (select count(*) from audit_events)::int audits`)).rows[0];
      const baseline = await counts();
      expect(baseline).toEqual({ users: 2, labs: 1, projects: 1, guests: 1, audits: 1 });
      await expect(provisionPublicGuest(database, { ...input, password: "DifferentPassword2026!" })).rejects.toMatchObject({ code: "guest_conflict" });
      await expect(provisionPublicGuest(database, { ...input, username: "operator" })).rejects.toMatchObject({ code: "guest_conflict" });
      await expect(provisionPublicGuest(database, { ...input, username: "other_visitor" })).rejects.toMatchObject({ code: "guest_lab_conflict" });
      await expect(provisionPublicGuest(database, { ...input, password: adminPassword })).rejects.toMatchObject({ code: "unsafe_guest_password" });
      expect(await counts()).toEqual(baseline);
      await pool.query(`create function fail_guest_audit() returns trigger language plpgsql as $$
        begin if new.action = 'admin.public_guest.create' then raise exception 'guest audit QA failure'; end if;
        return new; end $$;
        create trigger qa_guest_audit before insert on audit_events for each row execute function fail_guest_audit()`);
      try {
        await expect(provisionPublicGuest(database, { ...input, username: "rollback_guest", labSlug: "rollback-demo" })).rejects.toThrow();
        expect(await counts()).toEqual(baseline);
      } finally {
        await pool.query("drop trigger qa_guest_audit on audit_events; drop function fail_guest_audit()");
      }
      process.env.NODE_ENV = "test";
      process.env.LABRAT_AI_PROVIDER = "anthropic";
      process.env.DATABASE_URL = databaseUrl;
      const app = await createV1Application({ logger: false });
      const get = (path: string, cookie: string) => app.inject({ method: "GET", url: "/api/v1" + path, headers: { cookie } });
      const post = (path: string, payload: object, cookie = "") => app.inject({ method: "POST", url: "/api/v1" + path, payload, headers: { cookie } });
      try {
        expect((await post("/auth/login", { username: input.username, password: "x".repeat(9000) })).statusCode).toBe(413);
        const login = await post("/auth/login", { username: input.username, password });
        expect(login.statusCode, login.body).toBe(200);
        expect(login.headers["cache-control"]).toBe("no-store");
        expect(login.body).not.toContain("password");
        const cookie = cookieFrom(login);
        for (let attempt = 0; attempt < 19; attempt++) {
          expect((await post("/auth/login", { username: input.username, password: "WrongGuestPassword!" })).statusCode).toBe(401);
        }
        expect((await post("/auth/login", { username: input.username, password })).statusCode).toBe(429);
        expect(login.json().user.isSuperAdmin).toBe(false);
        expect(login.json().memberships).toEqual([{ labId: guest.labId, role: "lab_member", status: "active" }]);
        const owner = cookieFrom(await post("/auth/login", { username: "operator", password: adminPassword }));
        expect((await get("/admin/users", owner)).statusCode).toBe(200);
        expect((await get("/labs", cookie)).json().items.map((lab: { id: string }) => lab.id)).toEqual([guest.labId]);
        expect((await get("/projects", cookie)).json().items.map((project: { id: string }) => project.id)).toEqual([guest.projectId]);
        expect((await get(`/projects/${guest.projectId}`, cookie)).json().project.capabilities).toEqual(["read", "export"]);
        const expires = (await pool.query("select expires_at-created_at lifetime from sessions where user_id=$1", [guest.userId])).rows[0].lifetime;
        expect(expires.hours || 0).toBe(0);
        expect(expires.minutes || 0).toBeLessThanOrEqual(30);
        const inviteResponse = await post("/admin/invitations", {}, owner);
        expect(inviteResponse.statusCode).toBe(201);
        const invitation = inviteResponse.json();
        for (const [path, body] of [
          ["/auth/invitations/redeem", { invitationCode: invitation.invitationCode, labName: "Not allowed" }],
          ["/projects", { labId: guest.labId, name: "Not allowed" }],
          [`/projects/${guest.projectId}/agent/runs`, { message: "Spend model tokens" }],
          [`/projects/${guest.projectId}/files`, {}],
          [`/labs/${guest.labId}/invitations`, {}],
        ] as const) {
          const denied = await post(path, body, cookie);
          expect(denied.statusCode, denied.body).toBe(403);
          expect(denied.json().error.code).toBe("public_guest_read_only");
        }
        expect((await pool.query("select redeemed_at from invitations where id=$1", [invitation.invitation.id])).rows[0].redeemed_at).toBe(null);
        expect((await pool.query("select count(*)::int count from agent_runs")).rows[0].count).toBe(0);
        const write = await app.inject({ method: "PATCH", url: `/api/v1/projects/${guest.projectId}`, headers: { cookie }, payload: { name: "Hacked" } });
        expect(write.statusCode).toBe(403);

        await pool.query(`insert into labs (id,name,slug,created_at,updated_at,created_by)
          values ('private_lab','Private Lab','private-lab',now(),now(),'operator');
          insert into projects (id,lab_id,name,metadata,created_at,updated_at,created_by)
          values ('private_project','private_lab','Private Project','{"projectProfile":{"researchGoal":"Do not disclose"}}',now(),now(),'operator')`);
        await pool.query(`insert into lab_memberships (id,lab_id,user_id,role,status,created_at,updated_at,created_by)
          values ('bad_membership','private_lab',$1,'lab_admin','active',now(),now(),'operator');`, [guest.userId]);
        await pool.query("update lab_memberships set role='lab_owner' where user_id=$1 and lab_id=$2", [guest.userId, guest.labId]);
        await pool.query("update users set is_super_admin=true where id=$1", [guest.userId]);
        await pool.query(`update project_access_grants set capabilities='["read","export","propose","approve","manage_access"]' where user_id=$1`, [guest.userId]);
        const refreshed = await get("/auth/me", cookie);
        expect(refreshed.json().user.isSuperAdmin).toBe(false);
        expect(refreshed.json().memberships).toEqual([{ labId: guest.labId, role: "lab_member", status: "active" }]);
        expect((await get("/admin/users", cookie)).statusCode).toBe(403);
        expect((await get("/projects/private_project", cookie)).statusCode).toBe(404);
        expect((await get("/projects?labId=private_lab", cookie)).json().items).toEqual([]);
        expect((await get(`/projects/${guest.projectId}`, cookie)).json().project.capabilities).toEqual(["read", "export"]);
        await expect(provisionPublicGuest(database, { ...input, adminUsername: input.username })).rejects.toMatchObject({ code: "guest_operator_required" });

        await pool.query("update project_access_grants set status='inactive' where user_id=$1", [guest.userId]);
        expect((await get(`/projects/${guest.projectId}`, cookie)).statusCode).toBe(404);
        await pool.query("update project_access_grants set status='active' where user_id=$1", [guest.userId]);
        await pool.query("update lab_memberships set status='inactive' where user_id=$1 and lab_id=$2", [guest.userId, guest.labId]);
        expect((await get(`/projects/${guest.projectId}`, cookie)).statusCode).toBe(404);
        expect((await get("/labs", cookie)).json().items).toEqual([]);
        await pool.query("update lab_memberships set status='active' where user_id=$1 and lab_id=$2", [guest.userId, guest.labId]);
        await pool.query("update users set is_active=false where id=$1", [guest.userId]);
        expect((await get("/auth/me", cookie)).statusCode).toBe(401);
        await pool.query("update users set is_active=true where id=$1", [guest.userId]);
        let readStatus = 200;
        for (let attempt = 0; attempt < 181 && readStatus === 200; attempt++) {
          readStatus = (await get("/auth/me", cookie)).statusCode;
        }
        expect(readStatus).toBe(429);
        expect((await post("/auth/logout", {}, cookie)).statusCode).toBe(200);
        expect((await get("/auth/me", cookie)).statusCode).toBe(401);
      } finally {
        await app.close();
      }
      } finally {
        await database.onModuleDestroy();
        await pool.end();
      }
    });
  });
});
