import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Info, Plus, Settings2, Sparkles, UploadCloud, X } from "lucide-react";
import type { CSSProperties } from "react";

import { AppLogo } from "./AppLogo";
import { displaySubjectName, subjectDataValue, type SubjectNicknames } from "../lib/subjectDisplay";
import { subjectMetaForLabel, unsupportedSubjects } from "../subjectMeta";
import { supportedSubjects, type SelectableSubject, type SupportedSubject } from "../subjects";

export function MobileSubjectSheet({
  open,
  activeSubject,
  subjectNicknames,
  selectedSubjects,
  versionText,
  onClose,
  onHome,
  onSelectSubject,
  onToggleUnsupportedSubject,
  onAddSubject,
  onUpload,
  onSettings,
  onVersion,
  onCredits,
}: {
  open: boolean;
  activeSubject: SelectableSubject | null;
  subjectNicknames: SubjectNicknames;
  selectedSubjects: SelectableSubject[];
  versionText: string;
  onClose: () => void;
  onHome: () => void;
  onSelectSubject: (subject: SelectableSubject) => void;
  onToggleUnsupportedSubject: (subject: SelectableSubject) => void;
  onAddSubject: () => void;
  onUpload: () => void;
  onSettings: () => void;
  onVersion: () => void;
  onCredits: () => void;
}) {
  const supportedSelected = selectedSubjects.filter((subject): subject is SupportedSubject => supportedSubjects.includes(subject as SupportedSubject));
  const unsupportedSelected = selectedSubjects.filter((subject) => !supportedSubjects.includes(subject as SupportedSubject));
  const uploadEnabled = Boolean(activeSubject && supportedSubjects.includes(activeSubject as SupportedSubject));
  const activeMeta = activeSubject ? subjectMetaForLabel(activeSubject) : null;
  const unsupportedOpen = Boolean(activeSubject && unsupportedSelected.includes(activeSubject));

  function selectAndClose(subject: SelectableSubject) {
    onSelectSubject(subject);
    onClose();
  }

  function toggleUnsupportedAndClose(subject: SelectableSubject) {
    onToggleUnsupportedSubject(subject);
    onClose();
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="mobile-subject-sheet__backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.section
            className="mobile-subject-sheet glass-chrome"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-subject-sheet__header">
              <button className="mobile-subject-sheet__home" onClick={() => { onHome(); onClose(); }}>
                <AppLogo size={28} showText={false} />
                <span>
                  <strong>Past Paper Worker</strong>
                  <small>{activeMeta?.shortLabel ?? "Subjects and tools"}</small>
                </span>
              </button>
              <button className="icon-button" onClick={onClose} aria-label="Close subjects">
                <X size={16} />
              </button>
            </div>

            <section className="mobile-subject-sheet__section">
              <div className="section-frame__header">
                <div>
                  <span className="eyebrow">Your subjects</span>
                  <h3>Switch quickly</h3>
                </div>
              </div>
              <div className="mobile-subject-sheet__list">
                {supportedSelected.map((subject) => {
                  const meta = subjectMetaForLabel(subject);
                  if (!meta || !meta.supported) return null;
                  const label = displaySubjectName(subject, subjectNicknames);
                  return (
                    <button
                      key={subject}
                      className={subject === activeSubject ? "subject-nav-item subject-nav-item--active" : "subject-nav-item"}
                      onClick={() => selectAndClose(subject)}
                      data-subject={subjectDataValue(subject)}
                      style={{ "--subject-accent": meta.accent } as CSSProperties}
                    >
                      <meta.Icon size={18} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="mobile-subject-sheet__section">
              <details className="mobile-subject-sheet__unsupported" open={unsupportedOpen}>
                <summary>Unsupported subjects</summary>
                <div className="mobile-subject-sheet__unsupported-list">
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
                        onClick={() => (selected ? selectAndClose(subject) : toggleUnsupportedAndClose(subject))}
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
                </div>
              </details>
            </section>

            <section className="mobile-subject-sheet__section">
              <div className="mobile-subject-sheet__utility">
                <button className="secondary-button" onClick={() => { onAddSubject(); onClose(); }}>
                  <Plus size={16} /> Edit subjects
                </button>
                <button className="primary-button" onClick={() => { onUpload(); onClose(); }} disabled={!uploadEnabled}>
                  <UploadCloud size={16} /> Upload paper
                </button>
                <button className="secondary-button" onClick={() => { onSettings(); onClose(); }}>
                  <Settings2 size={16} /> Settings
                </button>
                <button className="secondary-button" onClick={() => { onVersion(); onClose(); }}>
                  <Sparkles size={16} /> {versionText}
                </button>
                <button className="secondary-button" onClick={() => { onCredits(); onClose(); }}>
                  <Info size={16} /> Credits
                </button>
                {activeMeta?.supported ? (
                  <a className="secondary-button" href={activeMeta.specUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} /> Specification
                  </a>
                ) : null}
              </div>
            </section>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
