# Past Paper Worker Feature Sprint Design

## Goal

Implement the prompt-driven feature sprint across the existing React/Vite frontend and Cloudflare Worker without changing the app's core storage model or turning the sprint into a ground-up rewrite. The landing page brand can stay close to the current visual direction, but the subject-product shell should be treated as a navigation and density-system rebuild.

## Design Read

This is a subject-focused study product UI for returning students, with a compact, high-clarity interface language, leaning toward extending the existing visual system rather than redesigning the brand surface.

## Scope Split

The sprint will ship on one branch in three linked slices, each leaving the app in a runnable state:

1. Slice 1 (`A-D`): foundation UI and shell
2. Slice 2 (`E-I`): local study intelligence and preferences
3. Slice 3 (`J-L`): AI review helpers, sharing, and Worker integration

This split is required because the prompt spans four different risk classes:

- layout and responsive shell changes
- local-only domain logic and persistence
- AI-assisted review features with daily limits
- backend route and KV-backed sharing work

## Current-State Findings

The current app has a workable product foundation, but the sprint lands on top of a few architectural realities:

- [src/App.tsx](C:/Users/MSI/Documents/past paper worker/src/App.tsx) owns most product state, routing, sidebar markup, settings, landing, dashboard, review, and toast orchestration.
- [src/styles.css](C:/Users/MSI/Documents/past paper worker/src/styles.css) contains nearly all layout and responsive rules, including the current compact-density overrides and sidebar styling.
- [src/lib/storage.ts](C:/Users/MSI/Documents/past paper worker/src/lib/storage.ts) already persists reduced screenshot thumbnails by keeping `thumbnailDataUrl` while stripping full-size `dataUrl`.
- [worker/index.ts](C:/Users/MSI/Documents/past paper worker/worker/index.ts) currently exposes only `/api/ai`, `/api/feedback`, and `/api/debug/env`.
- Supported-subject metadata already exists in [src/subjectMeta.ts](C:/Users/MSI/Documents/past paper worker/src/subjectMeta.ts), but current accent values do not match the requested fixed subject-color palette.
- The existing "density" setting only applies a handful of component-level overrides and does not act as a true spacing/font token system.

## Non-Goals

- No server database or user accounts.
- No personalization algorithm or AI recommendation system.
- No landing-page brand overhaul.
- No full rewrite of [src/App.tsx](C:/Users/MSI/Documents/past paper worker/src/App.tsx) before feature work starts.
- No modal-based share view editing or long-lived recommendation dismissal state.

## Architecture

### 1. Shell-First Refactor

The sprint should preserve the existing top-level app state in `App.tsx`, but extract the highest-risk UI surfaces into focused helpers and components so the shell can change without destabilizing review and paper-processing flows.

Expected boundaries:

- shell/navigation components
- dashboard enhancement components
- review enhancement components
- pure data registries under `src/data/`
- pure local helpers under `src/lib/`
- Worker share-route helpers inside `worker/index.ts` plus tests

This is intentionally not a full app rewrite. State stays in the existing app root while view logic and pure domain logic are split outward.

### 2. Density System

Density becomes a document-level token system by applying `data-density="comfortable"` or `data-density="compact"` on `<html>`, not by adding more app-shell modifier classes.

Implementation rules:

- define the requested spacing/font/sidebar custom properties on `:root`
- scope the two token sets to `[data-density="comfortable"]` and `[data-density="compact"]`
- mirror the saved `dashboardDensity` preference to `document.documentElement.dataset.density` in a React effect
- update the setting immediately on change with no page reload
- migrate layout spacing, row padding, card padding, and small-text sizes in `styles.css` from hardcoded values to token-driven values

Comfortable mode should remain visually equivalent to the current feel. Compact mode should visibly increase information density without overflow or clipped controls.

### 3. Subject Accent System

Subject accents become additive contextual tokens, not a replacement for the global theme accent. The following custom properties will be introduced:

- `--subject-bio: #22c55e`
- `--subject-chem: #f59e0b`
- `--subject-phys: #3b82f6`
- `--subject-cs: #a855f7`

Subject-scoped surfaces should receive a `data-subject` attribute whose value maps to one of:

- `biology`
- `chemistry`
- `physics`
- `computer-science`

These accents apply only within subject-owned UI:

- sidebar active subject state
- subject dashboard header strip
- paper card left border
- focus mode top bar chip
- grade estimate chip and related accents

Settings, landing, global navigation, and general shell chrome remain theme-accented.

## Slice 1 Design (`A-D`)

### A. Compact / Comfortable Density

Design intent:

- density affects every core surface, not only wrapper padding
- compact uses the requested tighter tokens for cards, rows, chips, headers, and sidebar width
- comfortable preserves the current feel closely enough that it does not read as a redesign

Primary surfaces affected:

- app shell grid and gutters
- subject sidebar widths and section spacing
- dashboard cards and paper cards
- settings sections and preference controls
- review cards and question nav tiles
- focus mode layout spacing
- modals, chips, and summary blocks

### B. Sidebar Reform

The sidebar becomes a three-zone navigation shell.

Zone 1: Header

- expanded: icon + wordmark + collapse button
- collapsed: centered collapse button only
- mobile: replaced by a top bar and hamburger trigger

Zone 2: Subject Rail

- supported subjects first
- each row shows icon, subject short label or nickname, and paper-count chip in expanded mode
- add-subject button anchored at the bottom of the rail section
- unsupported subjects remain available but should not collapse their labels into single initials

Zone 3: Utility Footer

- upload button
- settings
- version/changelog
- credits

Rules:

- fixed separators between zones
- icon-only collapsed state with browser `title` plus floating hover label
- no text-only metrics in collapsed mode
- no score strings or orphaned text in icon mode
- mobile replaces the persistent sidebar with a top bar plus bottom sheet at `<= 767px`
- `768px-1023px`: collapsed by default
- `>= 1024px`: use saved preference

Bug-specific acceptance:

- expanded subject cards never render blank
- collapsed header never shows unanchored icons
- unsupported subject names get at least `120px` worth of name space and can wrap to two lines
- badge/chip content must not starve subject-name width

### C. Subject Colour Coding

This is layered into the shell rebuild, not implemented as a separate pass. Any subject-owned container that renders header strips, paper cards, or focus chips should opt into subject data attributes and consume the new subject tokens.

### D. Paper Thumbnail Preview

Use the existing screenshot thumbnail persistence rather than inventing another storage path.

Behavior:

- render a `40x56` card thumbnail at the top-right of each dashboard paper card
- use the stored `thumbnailDataUrl` when available
- otherwise render a placeholder with a document icon
- enlarge to `80x113` on hover with a `transform` transition
- lazy-load visible thumbnails with `IntersectionObserver`

Implementation note:

Thumbnail resolution logic should live in a pure helper, while the observer and viewport behavior should live in a small paper-card enhancement component or hook.

## Slice 2 Design (`E-I`)

### E. Paper Recommendation

Add [src/data/paperRegistry.ts](C:/Users/MSI/Documents/past paper worker/src/data/paperRegistry.ts) as a static curated registry for the supported subjects.

Behavior:

1. After a marked attempt is viewed, gather registry entries for the same subject.
2. Exclude papers already uploaded or attempted.
3. Pick one random remaining paper.
4. If none remain, pick the paper attempted longest ago.
5. Render a dismissible recommendation card beneath the attempt summary.

Constraints:

- no AI
- no persistent dismissal
- recommendation logic remains under 80 lines
- PMT link always targets the generic past-paper landing page

### F. Landing Page Personalisation

The landing route stays visually familiar, but gets a compact returning-user header above the fold when stored attempt data exists.

Behavior split:

- no attempts stored: existing landing page unchanged
- attempts stored: prepend a compact returning-user block

Returning-user block content:

- "Welcome back"
- subject stat chips with subject short label or nickname, paper count, and average percentage
- continue button for the last active subject
- text link to reveal the full landing page below the fold

Constraint:

- personalized header JSX remains under 60 lines

### G. Predicted Grade

Add [src/data/gradeBoundaries.ts](C:/Users/MSI/Documents/past paper worker/src/data/gradeBoundaries.ts) with static latest-published boundaries for the supported subjects.

Behavior:

- require at least 2 completed marked attempts in a subject
- aggregate marks scored and marks available across those attempts
- convert aggregate percent into a working estimate against the chosen subject boundary table
- render a grade chip with subject accent and a small between-bands progress bar
- click/tap opens a popover, not a modal

Popover content:

- current boundary table
- editable override fields
- save-to-localStorage override per subject
- note citing the default source year and exam board

If fewer than 2 attempts exist, show a muted placeholder occupying the same slot.

### H. Achievement Unlocks

Add [src/data/achievements.ts](C:/Users/MSI/Documents/past paper worker/src/data/achievements.ts) with the provided static definitions.

Unlock boundaries:

- after upload
- after marking completes
- on app open for streak checks

Persistence:

- store unlocked IDs locally with the existing key naming convention
- never duplicate an unlock toast

Display:

- special achievement toast variant with amber/gold accent
- icon left, bold title, description below
- queue multiple unlocks `800ms` apart

This should extend the current toast system instead of introducing a second notification system.

### I. Custom Subject Nicknames

Extend the existing preferences object rather than storing nicknames in a separate preferences silo.

Add:

- `subjectNicknames: Record<SupportedSubject, string>`

Settings UI:

- collapsible "Custom nicknames (optional)" panel in the Subjects section
- one input per supported subject
- placeholder uses the current default short label
- max length 12

Nicknames replace short labels only in:

- subject rail
- subject dashboard header
- subject stat chips
- focus mode top bar

Official names remain unchanged for storage, exports, and AI prompts.

## Slice 3 Design (`J-L`)

### J. Follow-Up Question Mode

Use the existing AI infrastructure rather than introducing a parallel Claude client path. The frontend should prepare a minimal prompt payload and route it through the existing AI proxy stack.

Prompt inputs:

- truncated question stem
- truncated flat mark-scheme points
- truncated student answer

Output:

- one short follow-up question string

UI:

- secondary action under review feedback
- inline follow-up card with close button

Rate limiting:

- shared local counter with Section K
- key: `claude-feature-uses:{dateString}`
- max 3 combined uses per day
- reset by date-string rollover

### K. Mark Scheme Explainer

This shares the same rate-limit pool and the same AI transport path as Section J.

Per-point behavior:

- add `?` button to each mark-scheme point row
- request plain-English explanation from Claude via the existing AI route
- render inline expansion below the row
- show loading and inline retry-friendly error state

When limit is exhausted:

- dim `?` buttons and follow-up controls
- set `cursor: not-allowed`
- expose tooltip copy noting the daily limit and reset timing

### L. Shareable Attempt Link

This is the only part of the sprint that adds Worker persistence.

Worker changes:

- add `SHARE_KV` binding to [wrangler.jsonc](C:/Users/MSI/Documents/past paper worker/wrangler.jsonc)
- extend [worker/index.ts](C:/Users/MSI/Documents/past paper worker/worker/index.ts) with:
  - `POST /api/share`
  - `GET /api/share/{id}`
- validate incoming payload shape and limits before writing KV
- generate a 7-character alphanumeric ID
- store payload for 30 days

Frontend changes:

- add share button to review action row
- POST the minimal payload
- copy returned URL to clipboard on success
- show toast on success/failure
- detect `/share/{id}` route in the SPA and render a read-only share summary

The shared payload intentionally excludes answer text, mark-scheme text, and personal data.

## Data Model and Persistence

### Existing Stores to Extend

- `past-paper-worker:preferences:v1`
- `past-paper-worker:data:v1`
- existing selected-subject and active-subject keys

### New Permanent Local Keys

New persistent local keys must follow the versioned naming convention:

- achievements storage key
- grade-boundary override key
- any new share-view or shell-specific cache only if absolutely required

Preferred approach:

- keep nicknames inside the existing preferences object
- keep recommendation dismissal in component state only
- keep grade-boundary overrides in a dedicated versioned key keyed by subject
- keep achievements in a dedicated versioned key

### Daily AI Limit Key

Use the prompt-specified non-versioned key exactly:

- `claude-feature-uses:{dateString}`

## Component and File Direction

The implementation should favor these new or extracted files:

- `src/data/paperRegistry.ts`
- `src/data/gradeBoundaries.ts`
- `src/data/achievements.ts`
- shell/sidebar component extraction from `App.tsx`
- helper modules for:
  - density/document syncing
  - subject nickname resolution
  - recommendation selection
  - grade estimate calculation
  - achievement unlocking
  - AI daily-limit tracking
  - share payload building and validation

This keeps pure logic testable outside the app monolith while allowing the app root to continue owning global state.

## Error Handling

- Density changes are best-effort UI preference updates and should never block app use.
- Share creation failures surface as inline toasts and do not break the review screen.
- Missing thumbnail data should quietly fall back to a placeholder state.
- AI follow-up/explainer failures should stay inline and isolated to the active review surface.
- Grade boundary override parsing must tolerate incomplete or invalid stored values by falling back to defaults.
- Achievement evaluation must be idempotent so repeated app loads do not double-fire.

## Testing Strategy

### Unit Coverage

Add or extend tests for pure logic:

- recommendation selection
- grade estimate mapping and override behavior
- achievement unlock predicates
- AI daily rate-limit behavior
- share payload validation

### Frontend Integration Coverage

Add or extend integration coverage for:

- density preference persistence
- returning-user landing branch
- sidebar responsive shell states
- share button success/failure flow
- review-screen AI controls disabled state

### Worker Coverage

Add Worker tests for:

- valid share payload POST
- invalid payload rejection
- share lookup success
- share lookup miss

### Browser Verification

After each slice, verify at:

- `375px`
- `768px`
- `1280px`

And in both density modes where applicable.

Required end-of-sprint verification remains:

- landing page in first-time and returning-user states
- onboarding
- dashboard
- paper list thumbnails
- recommendation card
- grade chip and popover
- focus mode
- review screen AI controls and share button
- achievement toast
- sidebar expanded, collapsed, and mobile bottom-sheet states
- settings modal
- share view

### Command Gate

Before completion, run:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

## Risks and Mitigations

### Risk: shell regressions from app-wide CSS changes

Mitigation:

- land the density-token system and shell refactor first
- verify breakpoints immediately after Slice 1

### Risk: `App.tsx` becomes harder to change while adding features

Mitigation:

- move pure helpers and new focused view components out of the root file as part of the sprint
- keep root state orchestration in place to avoid a rewrite

### Risk: AI features consume too much prompt/context

Mitigation:

- hard truncate prompt inputs to the requested lengths
- use a shared daily counter

### Risk: share feature introduces loose payload validation

Mitigation:

- validate on both client and Worker
- cap question count and mark ranges

## Rollout Order

1. Extract shell primitives and install document-level density handling.
2. Rebuild sidebar/mobile shell and apply subject accents.
3. Surface thumbnails and finish Slice 1 responsive verification.
4. Add registries and pure helpers for recommendations, grades, achievements, and nicknames.
5. Wire returning-user landing and settings additions.
6. Add AI helper controls with shared daily limit.
7. Add Worker share endpoints, share route, and share view.
8. Run full command and browser verification sweep.

## Acceptance Standard

The sprint is complete only when:

- all prompt sections `A-L` are implemented
- responsive and density verification passes at `375px`, `768px`, and `1280px`
- all requested local-only and Worker persistence rules are satisfied
- the command gate is clean
- the UI no longer exhibits the confirmed sidebar and truncation bugs described in the prompt
