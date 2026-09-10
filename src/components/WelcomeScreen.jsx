import React, { useState } from "react";
import { ServerLogin } from "./ServerLogin.jsx";

export const WELCOME_SLOGAN = "Hi, I'm LabRat, your scientific research pet";

const MOTIF_PATHS = {
  flask: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  tube: (
    <>
      <path d="M9 3h6M10 3v14a2 2 0 0 0 4 0V3" />
      <path d="M10 11h4" />
    </>
  ),
  beaker: (
    <>
      <path d="M6 3h12M7.5 3v14a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3V3" />
      <path d="M7.5 13h9" />
    </>
  ),
  benzene: (
    <>
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />
      <circle cx="12" cy="12" r="4.5" />
    </>
  ),
  atom: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="3.5" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  dna: (
    <>
      <path d="M7 3c0 6 10 6 10 12s-10 6-10 6" />
      <path d="M17 3c0 6-10 6-10 12s10 6 10 6" />
      <path d="M8.5 6.5h7M8.5 12h7M8.5 17.5h7" />
    </>
  ),
  molecule: (
    <>
      <circle cx="12" cy="5.5" r="2.5" />
      <circle cx="5.5" cy="17" r="2.5" />
      <circle cx="18.5" cy="17" r="2.5" />
      <path d="M10.8 7.7L7 14.8M13.2 7.7L17 14.8M8 17h8" />
    </>
  ),
  ring: <circle cx="12" cy="12" r="8" />,
};

// Each motif drifts upward from below the viewport. Negative delays scatter the
// motifs across the page on first paint instead of starting them all at the bottom.
const BACKGROUND_MOTIFS = [
  { kind: "flask", left: 4, size: 84, duration: 26, delay: -3, spin: 30 },
  { kind: "benzene", left: 11, size: 57, duration: 20, delay: -14, spin: -180 },
  { kind: "ring", left: 17, size: 34, duration: 16, delay: -7, spin: 0 },
  { kind: "dna", left: 23, size: 99, duration: 30, delay: -21, spin: 20 },
  { kind: "tube", left: 31, size: 65, duration: 22, delay: -5, spin: -40 },
  { kind: "atom", left: 38, size: 76, duration: 28, delay: -17, spin: 160 },
  { kind: "ring", left: 45, size: 23, duration: 14, delay: -2, spin: 0 },
  { kind: "molecule", left: 52, size: 68, duration: 24, delay: -11, spin: 60 },
  { kind: "beaker", left: 60, size: 57, duration: 21, delay: -19, spin: -25 },
  { kind: "ring", left: 66, size: 42, duration: 18, delay: -9, spin: 0 },
  { kind: "benzene", left: 72, size: 87, duration: 32, delay: -25, spin: 120 },
  { kind: "tube", left: 79, size: 49, duration: 19, delay: -1, spin: 35 },
  { kind: "dna", left: 86, size: 72, duration: 27, delay: -13, spin: -30 },
  { kind: "atom", left: 93, size: 53, duration: 23, delay: -8, spin: -140 },
];

function BackgroundMotifs() {
  return (
    <div className="welcome-background" aria-hidden="true">
      {BACKGROUND_MOTIFS.map((motif, index) => (
        <svg
          key={`${motif.kind}-${index}`}
          className={`welcome-motif welcome-motif-${motif.kind}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            left: `${motif.left}%`,
            width: motif.size,
            height: motif.size,
            animationDuration: `${motif.duration}s`,
            animationDelay: `${motif.delay}s`,
            "--welcome-spin": `${motif.spin}deg`,
          }}
        >
          {MOTIF_PATHS[motif.kind]}
        </svg>
      ))}
    </div>
  );
}

function BubblingFlask() {
  return (
    <svg className="welcome-flask" viewBox="0 0 64 80" aria-hidden="true">
      <defs>
        <clipPath id="welcome-flask-clip">
          <path d="M26 8v20L8 62a5 5 0 0 0 4.5 8h39A5 5 0 0 0 56 62L38 28V8z" />
        </clipPath>
      </defs>
      <g clipPath="url(#welcome-flask-clip)">
        <path
          className="welcome-flask-liquid"
          d="M-16 50q8-4 16 0t16 0 16 0 16 0 16 0 16 0V80H-16z"
        />
        <circle className="welcome-flask-bubble" cx="24" cy="74" r="3" />
        <circle className="welcome-flask-bubble" cx="34" cy="76" r="2" style={{ animationDelay: "0.6s" }} />
        <circle className="welcome-flask-bubble" cx="42" cy="74" r="2.6" style={{ animationDelay: "1.2s" }} />
        <circle className="welcome-flask-bubble" cx="30" cy="77" r="1.6" style={{ animationDelay: "1.7s" }} />
      </g>
      <path
        className="welcome-flask-glass"
        d="M26 8v20L8 62a5 5 0 0 0 4.5 8h39A5 5 0 0 0 56 62L38 28V8"
      />
      <path className="welcome-flask-glass" d="M22 6h20" />
    </svg>
  );
}

export function WelcomeScreen({ loading, error, onLogin }) {
  const [showLogin, setShowLogin] = useState(false);
  const logoSrc = `${import.meta.env.BASE_URL}labrat-logo.png`;

  return (
    <main className={`welcome-screen${showLogin ? " welcome-screen-login" : ""}`}>
      <BackgroundMotifs />
      {showLogin ? (
        <div className="welcome-login-card">
          <ServerLogin
            embedded
            loading={loading}
            error={error}
            onLogin={onLogin}
            onBack={() => setShowLogin(false)}
          />
        </div>
      ) : (
        <section className="welcome-hero" aria-label="Welcome to LabRat">
          <div className="welcome-character">
            <img className="welcome-logo" src={logoSrc} alt="LabRat" />
            <BubblingFlask />
          </div>
          <p className="welcome-slogan">{WELCOME_SLOGAN}</p>
          <button type="button" className="primary welcome-login-button" onClick={() => setShowLogin(true)}>
            Log in
          </button>
        </section>
      )}
    </main>
  );
}
