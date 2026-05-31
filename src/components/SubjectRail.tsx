import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, FileText, Info, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Sparkles, UploadCloud } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { AppLogo } from "./AppLogo";
import { displaySubjectName, subjectDataValue, type SubjectNicknames } from "../lib/subjectDisplay";
import { subjectMetaForLabel, unsupportedSubjects } from "../subjectMeta";
import { supportedSubjects, type SelectableSubject, type SupportedSubject } from "../subjects";

export function SubjectRail({
  collapsed,
  selectedSubjects,
  activeSubject,
  subjectNicknames,
  versionText,
  onToggleCollapsed,
  onSelectSubject,
  onToggleUnsupportedSubject,
  onHome,
  onAddSubject,
  onUpload,
  onSettings,
  onVersion,
  onCredits,
}: {
  collapsed: boolean;
  selectedSubjects: SelectableSubject[];
  activeSubject: SelectableSubject | null;
  subjectNicknames: SubjectNicknames;
  versionText: string;
  onToggleCollapsed: () => void;
  onSelectSubject: (subject: SelectableSubject) => void;
  onToggleUnsupportedSubject: (subject: SelectableSubject) => void;
  onHome: () => void;
  onAddSubject: () => void;
  onUpload: () => void;
  onSettings: () => void;
  onVersion: () => void;
  onCredits: () => void;
}) {
  const [showUnsupported, setShowUnsupported] = useState(false);
  const supportedSelected = selectedSubjects.filter((subject): subject is SupportedSubject => supportedSubjects.includes(subject as SupportedSubject));
  const unsupportedSelected = selectedSubjects.filter((subject) => !supportedSubjects.includes(subject as SupportedSubject));
  const uploadEnabled = Boolean(activeSubject && supportedSubjects.includes(activeSubject as SupportedSubject));

  return (
    <aside className={collapsed ? "subject-sidebar subject-sidebar--collapsed" : "subject-sidebar"} aria-label="Subject sidebar">
      <div className="subject-sidebar__brand">
        <div className="subject-sidebar__brand-control">
          <button className="icon-button" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button className="subject-sidebar__home-button" onClick={onHome} title="Home">
            <AppLogo size={32} showText={false} />
          </button>
        </div>
        {!collapsed ? (
          <button className="subject-sidebar__home-copy" onClick={onHome} title="Home">
            <strong>Past Paper Worker</strong>
            <span>Marked GCSE practice</span>
          </button>
        ) : null}
      </div>

      <div className="subject-sidebar__section subject-sidebar__section--grow">
        {!collapsed ? <span className="eyebrow">Your subjects</span> : null}
        <div className="subject-sidebar__list">
          {supportedSelected.map((subject) => {
            const meta = subjectMetaForLabel(subject);
            const Icon = meta?.Icon ?? FileText;
            const label = displaySubjectName(subject, subjectNicknames);
            return (
              <button
                key={subject}
                className={subject === activeSubject ? "subject-nav-item subject-nav-item--active" : "subject-nav-item"}
                onClick={() => onSelectSubject(subject)}
                title={label}
                data-subject={subjectDataValue(subject)}
                style={{ "--subject-accent": meta?.accent ?? "var(--accent)" } as CSSProperties}
              >
                <Icon size={18} />
                {!collapsed ? <span>{label}</span> : null}
              </button>
            );
          })}
        </div>

        <button className="subject-nav-item subject-nav-item--utility" onClick={onAddSubject} title="Add Subject">
          <Plus size={18} />
          {!collapsed ? <span>Add subject</span> : null}
        </button>

        <button className="subject-nav-item subject-nav-item--utility" onClick={() => setShowUnsupported((value) => !value)} aria-expanded={showUnsupported} title="Unsupported subjects">
          <ChevronDown size={18} className={showUnsupported ? "question-disclosure__icon question-disclosure__icon--open" : "question-disclosure__icon"} />
          {!collapsed ? <span>Unsupported subjects</span> : null}
        </button>

        <AnimatePresence initial={false}>
          {showUnsupported && !collapsed ? (
            <motion.div
              className="sidebar-unsupported-list"
              initial={{ height: 0, opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              animate={{ height: "auto", opacity: 1, clipPath: "inset(0 0 0 0)" }}
              exit={{ height: 0, opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {unsupportedSubjects.map((subject) => {
                const meta = subjectMetaForLabel(subject);
                const selected = unsupportedSelected.includes(subject);
                const active = activeSubject === subject;
                if (!meta) return null;

                return (
                  <button
                    key={subject}
                    className={active ? "unsupported-nav-row unsupported-nav-row--active" : "unsupported-nav-row"}
                    style={{ "--subject-accent": meta.accent } as CSSProperties}
                    onClick={() => (selected ? onSelectSubject(subject) : onToggleUnsupportedSubject(subject))}
                  >
                    <div className="unsupported-nav-row__main">
                      <meta.Icon size={16} />
                      <span>{meta.shortLabel}</span>
                    </div>
                    <div className="unsupported-nav-row__status">
                      <small>{active ? "selected" : selected ? "added" : "not added"}</small>
                      <span className="static-chip">unsupported</span>
                    </div>
                  </button>
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="subject-sidebar__section subject-sidebar__section--bottom">
        <button className="primary-button primary-button--wide subject-sidebar__upload" onClick={onUpload} title={uploadEnabled ? "Upload paper" : "Upload support is not available for this subject yet"} disabled={!uploadEnabled}>
          <UploadCloud size={16} /> {!collapsed ? "Upload paper" : null}
        </button>
        <div className="subject-sidebar__utility">
          <button className="subject-nav-item subject-nav-item--utility" onClick={onSettings} title="Settings">
            <Settings2 size={18} /> {!collapsed ? <span>Settings</span> : null}
          </button>
          <button className="subject-nav-item subject-nav-item--utility" onClick={onVersion} title={versionText}>
            <Sparkles size={18} /> {!collapsed ? <span>{versionText} -&gt;</span> : null}
          </button>
          <button className="subject-nav-item subject-nav-item--utility" onClick={onCredits} title="Credits">
            <Info size={18} /> {!collapsed ? <span>Credits</span> : null}
          </button>
        </div>
      </div>
    </aside>
  );
}
