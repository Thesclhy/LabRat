import React, { useState } from "react";

export function ServerLogin({ loading, error, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event) => {
    event.preventDefault();
    onLogin?.({ username, password });
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
        <form className="server-login-form" onSubmit={submit}>
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
        </form>
      </section>
    </main>
  );
}
