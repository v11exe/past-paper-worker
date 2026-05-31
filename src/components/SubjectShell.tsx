import { Menu } from "lucide-react";
import type { ReactNode } from "react";

export function SubjectShell({
  enabled,
  mobileSheetOpen,
  heading,
  eyebrow,
  rail,
  mobileSheet,
  onToggleMobileSheet,
  children,
}: {
  enabled: boolean;
  mobileSheetOpen: boolean;
  heading: string;
  eyebrow: string;
  rail: ReactNode;
  mobileSheet: ReactNode;
  onToggleMobileSheet: () => void;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;

  return (
    <>
      <header className="subject-shell-topbar glass-chrome">
        <button className="icon-button" onClick={onToggleMobileSheet} aria-label={mobileSheetOpen ? "Close subjects" : "Open subjects"}>
          <Menu size={18} />
        </button>
        <div className="subject-shell-topbar__title">
          <span>{eyebrow}</span>
          <strong>{heading}</strong>
        </div>
        <span aria-hidden="true" />
      </header>
      {rail}
      {mobileSheet}
      {children}
    </>
  );
}
