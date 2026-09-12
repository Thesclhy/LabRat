import React, { useEffect, useRef, useState } from "react";
import { createInvitation, listInvitations, revokeInvitation, listLabMembers, removeLabMember, listMemberAccess, setMemberAccess } from "../data/invitationsApi.js";
import { InvitationForm } from "./InvitationForm.jsx";

const roleName = (role) => ({ lab_owner: "Owner", lab_admin: "Administrator", lab_member: "Employee" }[role] || role);
const presetName = { none: "No direct access", view: "View", edit: "Edit", approve: "Approve", custom: "Custom" };
const dateLabel = (value) => new Date(value).toLocaleString();

function InvitationTable({ labId = "" }) {
  const [page, setPage] = useState({ items: [], nextCursor: null });
  const [cursor, setCursor] = useState("");
  const [freshCode, setFreshCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const load = async (next = cursor) => setPage(await listInvitations(labId, next));
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    listInvitations(labId, cursor).then((result) => { if (active) setPage(result); })
      .catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [labId, cursor]);
  const act = async (action) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); await load(); }
    catch (err) { setError(err.message); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section>
    <div className="management-section-head"><div><h2>{labId ? "Employee invitations" : "Lab-owner invitations"}</h2><p>One person · one use · expires after 7 days. Send codes privately.</p></div>
      <button className="primary" disabled={busy} onClick={() => act(async () => { const result = await createInvitation(labId); setFreshCode(result.invitationCode); if (cursor) setCursor(""); })}>Create invitation</button></div>
    {freshCode && <div className="invitation-once" role="status"><strong>Shown only now — send privately before closing.</strong><input aria-label="New invitation code" readOnly value={freshCode} autoComplete="off" onFocus={(event) => event.target.select()} /><button onClick={() => setFreshCode("")}>Hide code</button></div>}
    {error && <p role="alert" className="import-review-error">{error}</p>}
    {loading ? <p>Loading invitations...</p> : <table className="management-table"><thead><tr><th>Invitation</th><th>Created</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {!page.items.length && <tr><td colSpan={5}>No invitations yet.</td></tr>}
      {page.items.map((invitation) => <tr key={invitation.id}><td><code>{invitation.id}</code></td><td>{dateLabel(invitation.createdAt)}</td><td>{dateLabel(invitation.expiresAt)}</td><td><span className={`management-status ${invitation.status}`}>{invitation.status}</span></td>
        <td>{invitation.status === "pending" ? <button disabled={busy} onClick={() => act(() => revokeInvitation(labId, invitation.id))}>Revoke</button> : invitation.status === "used" ? "Remove the member to end access" : "—"}</td></tr>)}
    </tbody></table>}
    <div className="management-actions"><button disabled={!cursor || loading} onClick={() => setCursor("")}>First page</button><button disabled={!page.nextCursor || loading} onClick={() => setCursor(page.nextCursor)}>Next page</button></div>
  </section>;
}

function MembersTable({ labId }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    listLabMembers(labId).then((result) => { if (active) setMembers(result.items); })
      .catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [labId]);
  const remove = async (userId) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await removeLabMember(labId, userId); setMembers((rows) => rows.filter((row) => row.user.id !== userId)); setTarget(""); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <section><h2>Lab members</h2><p>Removing a member revokes this lab only. Rejoining does not restore old project or group access.</p>
    {error && <p role="alert" className="import-review-error">{error}</p>}
    {loading ? <p>Loading members...</p> : <table className="management-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Action</th></tr></thead><tbody>
      {members.map(({ user, role }) => <tr key={user.id}><td>{user.displayName}{!user.isActive && " · Disabled"}</td><td>{user.username}</td><td>{roleName(role)}</td><td>
        {role === "lab_owner" ? "Owner protected" : target === user.id ? <div className="management-actions"><span>End lab access?</span><button disabled={busy} onClick={() => remove(user.id)}>Confirm removal</button><button disabled={busy} onClick={() => setTarget("")}>Cancel</button></div> : <button disabled={busy} onClick={() => setTarget(user.id)}>Remove member</button>}
      </td></tr>)}
    </tbody></table>}
  </section>;
}

function AccessRow({ row, onSave, busy }) {
  const [preset, setPreset] = useState(row.directGrant?.preset || "none");
  const current = row.directGrant?.preset || "none";
  const inherited = row.sources.filter((source) => source.type !== "direct");
  return <tr><td>{row.user.displayName}<small>{row.user.username} · {roleName(row.role)}</small></td>
    <td><select aria-label={`Direct access for ${row.user.username}`} disabled={!row.editable || busy} value={preset} onChange={(event) => setPreset(event.target.value)}>
      {Object.entries(presetName).filter(([key]) => key !== "custom" || current === "custom").map(([key, label]) => <option key={key} value={key} disabled={key === "custom"}>{label}</option>)}
    </select>{!row.editable && <small>{row.role !== "lab_member" ? "Inherited from lab role" : "Advanced experiment grant · unchanged here"}</small>}</td>
    <td>{row.effectiveAccess ? <>{row.effectiveAccess.capabilities.join(", ") || "Experiment access"}<small>{row.effectiveAccess.allExperiments ? "All experiments" : "Selected experiments only"}</small></> : "No project access"}</td>
    <td>{inherited.length ? inherited.map((source) => <small key={source.id}>{source.type}: {source.groupId || source.experimentId || source.id} · {source.capabilities.join(", ")}</small>) : "None"}</td>
    <td><button disabled={busy || !row.editable || preset === current} onClick={() => onSave(row, preset)}>Save access</button></td></tr>;
}

function ProjectAccess({ projects }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [cursor, setCursor] = useState("");
  const [page, setPage] = useState({ items: [], nextCursor: null });
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!projectId) return;
    let active = true; setLoading(true);
    listMemberAccess(projectId, cursor).then((result) => { if (active) setPage(result); })
      .catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, cursor, version]);
  const save = async (row, preset) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await setMemberAccess(projectId, row.user.id, preset, row.directGrant?.id || null); }
    catch (err) { setError(err.status === 409 ? "Permissions changed elsewhere. The latest values have been reloaded; review them and save again." : err.message); }
    finally { setBusy(false); setVersion((value) => value + 1); }
  };
  return <section><h2>Project permissions</h2><p>View = read + export. Edit adds drafts and proposals. Approve adds confirmation and publication. Removing direct access leaves any additional grants intact.</p>
    <label className="management-project-select">Project<select value={projectId} disabled={busy} onChange={(event) => { setProjectId(event.target.value); setCursor(""); setError(""); }}><option value="">Select project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    {error && <p role="alert" className="import-review-error">{error}</p>}
    {!projectId ? <p>Create a project before assigning project access.</p> : loading ? <p>Loading permissions...</p> : <table className="management-table"><thead><tr><th>Member</th><th>Direct access</th><th>Effective access</th><th>Additional sources</th><th>Action</th></tr></thead><tbody>
      {page.items.map((row) => <AccessRow key={`${projectId}:${row.user.id}:${row.directGrant?.id || "none"}:${version}`} row={row} busy={busy} onSave={save} />)}
      {!page.items.length && <tr><td colSpan={5}>No members.</td></tr>}
    </tbody></table>}
    <div className="management-actions"><button disabled={!cursor || loading || busy} onClick={() => setCursor("")}>First page</button><button disabled={!page.nextCursor || loading || busy} onClick={() => setCursor(page.nextCursor)}>Next page</button></div>
  </section>;
}

export function LabManagement({ mode, lab, projects, onClose, onInvitationComplete }) {
  const [section, setSection] = useState("members");
  return <main className="management-workspace"><header className="management-section-head"><div><h1>{mode === "platform" ? "Platform management" : mode === "invitation" ? "Use invitation" : `Lab management · ${lab?.name || ""}`}</h1>
    <p>{mode === "platform" ? "Platform administration does not grant access to scientific data." : "Access and membership"}</p></div><button onClick={onClose}>Back to projects</button></header>
    {mode === "platform" ? <InvitationTable /> : mode === "invitation" ? <InvitationForm signedIn onComplete={onInvitationComplete} onCancel={onClose} /> : <>
      <nav className="management-tabs" aria-label="Lab management sections">{[["members", "Members"], ["invitations", "Invitations"], ["access", "Project permissions"]].map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}</nav>
      {section === "members" && <MembersTable labId={lab.id} />}
      {section === "invitations" && <InvitationTable labId={lab.id} />}
      {section === "access" && <ProjectAccess projects={projects} />}
    </>}
  </main>;
}
