import React, { useRef, useState } from "react";
import { previewInvitation, redeemInvitation, registerWithInvitation } from "../data/invitationsApi.js";

export function InvitationForm({ signedIn = false, onComplete, onCancel }) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [labName, setLabName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    if (preview && !signedIn && password !== confirmation) { setError("Passwords do not match."); return; }
    submitting.current = true;
    setBusy(true);
    try {
      if (!preview) {
        setPreview(await previewInvitation(code.trim()));
      } else {
        const body = { invitationCode: code.trim(), ...(preview.kind === "lab_owner" ? { labName: labName.trim() } : {}) };
        const result = await (signedIn ? redeemInvitation(body) : registerWithInvitation({
          ...body, username: username.trim(), displayName: displayName.trim(), password,
        }));
        setPassword(""); setConfirmation(""); setCode("");
        await onComplete?.(result);
      }
    } catch (err) { setError(err.message || "Invitation could not be used."); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form className="server-login-form invitation-form" onSubmit={submit}>
    <h2>{signedIn ? "Use invitation" : "Register with invitation"}</h2>
    {!preview ? <>
      <p>Paste the private, single-use code sent by your developer or lab owner.</p>
      <label><span>Invitation code</span><input value={code} onChange={(event) => setCode(event.target.value)} required maxLength={100} autoComplete="off" spellCheck={false} /></label>
    </> : <>
      <p className="invitation-target">{preview.kind === "lab_owner" ? "Create a new lab as its owner." : `Join ${preview.lab.name} as an employee. Your owner will assign project access.`}</p>
      {!signedIn && <>
        <label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={200} autoComplete="username" /></label>
        <label><span>Display name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={300} autoComplete="name" /></label>
        <label><span>Password · at least 12 characters</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={1000} autoComplete="new-password" /></label>
        <label><span>Confirm password</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={12} maxLength={1000} autoComplete="new-password" /></label>
      </>}
      {preview.kind === "lab_owner" && <label><span>Lab name</span><input value={labName} onChange={(event) => setLabName(event.target.value)} required maxLength={300} /></label>}
    </>}
    {error && <p className="import-review-error" role="alert">{error}</p>}
    <div className="management-actions">
      <button className="primary" type="submit" disabled={busy || !code.trim()}>{busy ? "Please wait..." : !preview ? "Check invitation" : signedIn ? "Accept invitation" : "Create account"}</button>
      {preview && <button type="button" disabled={busy} onClick={() => { setPreview(null); setPassword(""); setConfirmation(""); setError(""); }}>Change code</button>}
      <button type="button" disabled={busy} onClick={onCancel}>{signedIn ? "Cancel" : "Back to sign in"}</button>
    </div>
    {!signedIn && <small>Forgotten passwords are handled by your developer after manual verification.</small>}
  </form>;
}
