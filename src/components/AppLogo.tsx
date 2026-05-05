export function AppLogo({ size = 32, showText = true }: { size?: 24 | 32 | 44; showText?: boolean }) {
  return (
    <div className="app-logo">
      <svg className="app-logo__mark" width={size} height={size} viewBox="0 0 44 44" role="img" aria-label="Past Paper Worker logo">
        <rect x="6" y="4" width="28" height="36" rx="7" fill="#0d1518" stroke="#8fe6c0" strokeWidth="2" />
        <path d="M27 4v9a3 3 0 0 0 3 3h4" fill="none" stroke="#e6c36f" strokeWidth="2" strokeLinejoin="round" />
        <path d="M13 19h17" stroke="#8fe6c0" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M13 25h13" stroke="#e6c36f" strokeWidth="2.2" strokeLinecap="round" />
        <path d="m16 32 3 3 7-8" fill="none" stroke="#8fe6c0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="35" cy="31" r="3" fill="#e6c36f" />
      </svg>
      {showText ? (
        <div className="app-logo__text">
          <strong>Past Paper Worker</strong>
          <span>Grounded exam practice</span>
        </div>
      ) : null}
    </div>
  );
}
