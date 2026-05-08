export function AppLogo({ size = 32, showText = true }: { size?: 24 | 32 | 44; showText?: boolean }) {
  return (
    <div className="app-logo">
      <img className="app-logo__mark" src="./elliots-logo.png" width={size} height={size} alt="Past Paper Worker logo" />
      {showText ? (
        <div className="app-logo__text">
          <strong>Past Paper Worker</strong>
          <span>Grounded exam practice</span>
        </div>
      ) : null}
    </div>
  );
}
