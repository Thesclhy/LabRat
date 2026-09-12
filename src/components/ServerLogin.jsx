import React, { useRef, useState } from "react";
import { InvitationForm } from "./InvitationForm.jsx";

export function ServerLogin({ loading, error, onLogin, onRegistered }) {
  const [registering, setRegistering] = useState(false);
  const submitting = useRef(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (loading || submitting.current) return;
    submitting.current = true;
    try { await onLogin?.({ username, password }); }
    finally { submitting.current = false; }
  };

  return (
    <main className="server-login">
      <section className="server-login-panel">
        <div className="server-login-brand">
          <img src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="" />
          <div>
            <h1>LabRat</h1>
            <p>Sign in to your lab workspace.</p>
          </div>
        </div>
        {registering ? <InvitationForm onComplete={onRegistered} onCancel={() => setRegistering(false)} /> : <form className="server-login-form" onSubmit={submit}>
          <label>
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="import-review-error">{error}</p>}
          <button className="primary" type="submit" disabled={loading || !username.trim() || !password}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <button type="button" disabled={loading} onClick={() => { setPassword(""); setRegistering(true); }}>Register with invitation</button>
        </form>}
      </section>
    </main>
  );
}
