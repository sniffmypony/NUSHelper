# NUSHelper website design rules ("Notebook")

Every change to the website follows these rules. The shared pieces live in
`src/styles.css` (tokens, motion variables, keyframes) and
`src/components/` (see §4). Use those instead of one-off styles; if a
pattern appears twice, it belongs in a shared component.

The look: warm paper, ink-black text, one deep pine accent for actions, and
marigold kept for one meaning only: **now** (the current time, today, what's
next). The content is already colourful (seven calendar categories, module
colours, money states), so everything around it stays quiet.

## 1. Colour

- **OKLCH tokens only.** Every colour is a CSS custom property in
  `src/styles.css`, exposed to Tailwind as `bg-*`, `text-*`, `border-*`,
  `ring-*`. Never write a raw colour in a component.
- **Light and dark are designed separately.** Light is warm paper (hue
  75–85, chroma ≤ 0.015). Dark is a warm charcoal: depth comes from lighter
  surfaces (`canvas` → `surface` → `raised`), not shadows, and text is
  off-white to cut glare. Accent and state colours are lighter in dark mode,
  with dark text on filled accents.
- **Pine is the only action colour.** One filled primary button per view.
  Secondary buttons are outlined, quiet ones are text only. Links and
  selected rows use `accent-text` / `accent-soft`.
- **Marigold means now.** `now` marks today's date, the current time line,
  the "Now" badge and items due within a day. It is never used for
  decoration or as a button.
- **States always carry an icon and a word.** `ok`, `warn`, `danger` and
  `info` each have a `-soft` fill. "Not logged" or "no data" is neutral,
  never danger. Red is for errors, overdue work and destructive actions.
- **Contrast** (checked with an OKLCH-to-sRGB calculator):
  - Text on its surface: `ink` 15:1, `muted` ≥ 6.4:1, `faint` ≥ 4.5:1.
  - Field borders (`field`) and the focus ring: ≥ 3:1.
  - A new token needs the same check.
- **Mix colours in OKLab** (`color-mix(in oklab, …)`). Mixing in OKLCH
  interpolates hue and turns tints beige on the warm surfaces.

### Tokens

| Token                                                                                         | Use                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `canvas`, `surface`, `raised`, `sunken`                                                       | page; panels; popovers, sheets, dialogs, toasts; wells and your chat bubbles' ground |
| `hover`, `pressed`                                                                            | translucent fills for hover and pressed                                              |
| `line`, `line-strong`                                                                         | dividers and panel borders (decorative)                                              |
| `field`                                                                                       | input, select and tick-box borders (≥ 3:1)                                           |
| `ink`, `muted`, `faint`                                                                       | text: main, secondary, hints and empty states                                        |
| `accent`, `accent-hover`, `accent-press`, `on-accent`                                         | primary actions; focus ring                                                          |
| `accent-soft`, `accent-text`                                                                  | selected rows and days, links, active tabs                                           |
| `now`, `now-soft`, `on-now`                                                                   | today, the time line, "Now" and due-within-a-day                                     |
| `ok`, `warn`, `danger`, `info` (+ `-soft`), `on-danger`                                       | states; filled danger buttons only inside confirmations                              |
| `bubble`                                                                                      | your own chat messages                                                               |
| `chart-bar`, `chart-focus`                                                                    | quiet bars; the bar in focus (pine)                                                  |
| `cat-class`, `cat-event`, `cat-exam`, `cat-deadline`, `cat-reminder`, `cat-task`, `cat-spend` | calendar categories                                                                  |

## 2. Categories

Each calendar category has one hue at a shared lightness and chroma, and
its own lucide icon (`category.tsx`), so none looks heavier and colour is
never the only cue:

| Category | Icon          |
| -------- | ------------- |
| class    | GraduationCap |
| event    | CalendarDays  |
| exam     | PenLine       |
| deadline | Flag          |
| reminder | Bell          |
| task     | CircleCheck   |
| spending | Wallet        |

- **Lists** show the category as its icon next to the item (`CategoryIcon`),
  with a screen-reader label. Rows are never fully tinted.
- **Dense grids** show a dot (`Dot`). The calendar has a legend.
- **Blocks** use a tint and a 3 px bar of the colour (`.tint .tint-class`):
  timetable lessons and finals.
- **Module codes** are neutral chips with a coloured dot (`Pill`).

## 3. Type, space and shape

- **Font:** Inter Variable, self-hosted (`@fontsource-variable/inter`).
  Numbers that line up use `.tnum` (tabular figures).
- **Scale:** 12 px labels (uppercase, +6% tracking) · 13 meta · 14 UI body ·
  15 reading (chat replies) · 16 panel titles · 24/28 page titles. Weights
  400, 500 and 600 only.
- **Radius:**
  - 12 px panels
  - 8 px buttons and fields
  - 6 px chips and badges
  - 16 px dialogs and sheets
  - Nested corners: inner radius = outer − padding.
- **Panels are flat:** surface, a hairline border, no shadow. Shadows
  (`shadow-pop`) are only for things that float: popovers, sheets, dialogs,
  toasts. Don't wrap every section in a card. Inside a panel, group with
  dividers and small uppercase headings.
- **Touch targets:**
  - Buttons and icon buttons are 40 px on touch screens and 32–36 px with a
    mouse (`@media (pointer: fine)`).
  - Tick boxes draw 22 px inside a 40 px target.
  - Actions that appear on hover are always visible on touch screens.
- **Icons:** lucide line icons, 16–18 px. Stroke 1.75 next to regular text,
  2 next to semibold. No emoji in UI (the bot's emoji are stripped from
  calendar titles).

## 4. Shared components

| Component                                                                                         | File            | For                                                                                                   |
| ------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `Panel`, `Card`, `Row`                                                                            | `ui.tsx`        | sections; settings-style divided panels; labelled setting rows                                        |
| `Button` (primary, secondary, quiet, danger, danger-quiet; md, sm), `IconButton`                  | `ui.tsx`        | every button; icon buttons need a `label`                                                             |
| `Input`, `Select`, `Textarea`, `Field`                                                            | `ui.tsx`        | form fields; `invalid` + `shake` for refused input                                                    |
| `Badge`, `SourceBadge`, `Notice`                                                                  | `ui.tsx`        | state labels; inline feedback with icon (errors are announced)                                        |
| `PageHeader`, `Metric`, `EmptyState`, `Empty`, `Skeleton`, `PageSkeleton`, `LoadError`, `useLoad` | `page.tsx`      | page furniture; every page loads with `useLoad`, shows a skeleton, and a failed load offers Try again |
| `FeedbackProvider`, `useFeedback`, `useRemovable`                                                 | `feedback.tsx`  | toasts and Undo                                                                                       |
| `ConfirmProvider`, `useConfirm`                                                                   | `dialog.tsx`    | confirmations for what can't be undone                                                                |
| `Segmented`                                                                                       | `Segmented.tsx` | segmented controls and small tab sets (radio group, arrow keys)                                       |
| `Tick`                                                                                            | `Tick.tsx`      | tick boxes for to-dos and tasks                                                                       |
| `Shell`                                                                                           | `Shell.tsx`     | navigation: sidebar (≥ 1024 px), icon rail (768–1023 px), bottom tabs and More sheet (phones)         |
| `Shake`, `SwapIcon`, `Accordion`, `ScrollFade`, `Tooltip`, `SPRING`, `DUR`                        | `motion.tsx`    | motion helpers                                                                                        |
| `CATEGORY`, `CategoryIcon`, `Dot`, `Pill`                                                         | `category.tsx`  | calendar categories                                                                                   |

### Safe changes

- **Reversible changes use Undo, not a question.** `useRemovable().remove()`
  ticks or hides the row at once and shows an Undo toast. The request goes
  to the server only when the toast closes (or the page is closed), so Undo
  needs nothing from the server. Used for:
  - ticking off to-dos and tasks
  - deleting tasks and repeating items
  - removing birthdays
  - cancelling reminders
- **Irreversible or far-reaching changes ask first** with `useConfirm()`.
  The confirm button names the action ("Delete event", "Sign out
  everywhere"), never "OK". Used for:
  - deleting a Google Calendar event or a chat
  - replacing or turning off a key
  - disconnecting Google
  - signing out everywhere

  Never use `window.confirm` or `window.prompt`.

- **Settings keeps dangerous actions apart.** "Sign out everywhere" sits in
  its own red-tinted band, and key replacement is a secondary button, never
  the primary. Saved secrets are never shown: only their last four
  characters and when they were set.

## 5. Motion

Motion is for meaning: a change of state, where something went, or feedback
to an action. Never decoration, and never a wait before a frequent action.

- **Tools.**
  - **CSS** for hover, focus, press and simple entrances.
  - **Motion** (`motion/react`, through `LazyMotion` with `m` components;
    `domMax` loads after first paint) for:
    - exits (`AnimatePresence`)
    - layout reflow (`layout`)
    - shared indicators (`layoutId`)
    - the draggable sheet
  - **Web Animations** for the shake.
- **Durations** (`--dur-*` in CSS, `DUR` in JS):
  - 120 ms: presses, hovers, icon swaps
  - 180 ms: toasts, popovers, list items, page entrance
  - 240 ms: panels, chart bars
  - 320 ms: month slide, phone sheet

  Exits take about 70% of the entrance.

- **Easing:**
  - `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)` for entrances
  - `--ease-in` `cubic-bezier(0.5, 0, 0.75, 0)` for exits
  - `--ease-move` `cubic-bezier(0.65, 0, 0.35, 1)` for on-screen moves
- **Springs** (`SPRING`):
  - `snap` {0.22 s, bounce 0}: layout reflow, nav and tab indicators,
    segmented controls
  - `sheet` {0.32 s, bounce 0.05}: the More sheet
  - `tick` {0.2 s, bounce 0.25}: only the tick mark

  No other overshoot.

- **Pages** fade in and rise 4 px over 180 ms. The old page leaves at once,
  so navigation never waits. The sidebar's current-page background and the
  phone tab's indicator slide to the new item.
- **Lists:**
  - No stagger on load.
  - Ticked rows hold 280 ms with the tick showing, then fade out while the
    rest reflow (`layout`).
  - New rows fade in.
- **Spatial moves:**
  - The next month slides in from the right and the previous one from the
    left.
  - Opening a chat on a phone slides in from the right; Back slides from the
    left.
  - The More sheet rises from the bottom and can be dragged down.
- **Feedback:**
  - Buttons press to 0.97.
  - Refused input shakes (6 px, 300 ms), turns red and shows its error text.
  - Success is a toast, or an icon swap (`SwapIcon`) for copy and pin.
- **Toasts** rise 8 px. Their countdown bar shrinks with `scaleX`. Hovering
  or focusing a toast pauses it, and when the bar ends the toast closes and
  the waiting change is sent.
- **Dialogs** use native `<dialog>`, which traps focus and closes on Escape.
  They scale in from 0.97 with `@starting-style`, and focus starts on Cancel.
- **Loading and streaming:**
  - Skeletons have the content's shape and pulse in opacity only.
  - Streamed chat text has no per-word animation, just a blinking caret at
    the end.
  - The status line pulses in opacity.
  - Charts grow their bars once (`scaleY`) when a month appears.
- **Accordions** use `<details>` with `interpolate-size` (Chrome/Edge 129+;
  elsewhere they open instantly). It animates height, so keep it to small
  panels.
- **Performance:** only `transform`, `opacity` and `filter` animate.
  Measured at 4× CPU slowdown on a phone viewport:
  - layout shift (CLS) is 0
  - the slowest frames come from React rendering a new month, not from the
    animations
- **Theme switching** turns transitions off for that moment, so colours
  change at once instead of fading page-wide.
- **Reduced motion:** `<MotionConfig reducedMotion="user">` and the CSS
  media query remove all movement (slides, rises, scales, the bar growth,
  the shake, the sheet's slide). Fades of 120 ms remain, and pulses and the
  caret stop. Everything is still understandable with motion off.

## 6. Layout and pages

- **Today is the reference page.** Its order, by what matters first:
  1. Now / Next (marigold edge)
  2. Due soon
  3. To-dos
  4. Today's timeline (finished items muted, a marigold "now" line)
  5. Spending
  6. The next six days

  Phones follow that order. Desktop puts to-dos and spending in a sticky
  right column.

- **Phones:**
  - Bottom tabs: Today, Calendar, Tasks, Chat, More.
  - Content is padded clear of the tab bar and the home indicator.
  - Toasts sit above the tab bar.
- **Accessibility:**
  - One visible focus style (2 px pine outline, 2 px offset).
  - A skip link.
  - `aria-current` on the current page and day.
  - `aria-pressed` on toggles.
  - Loading regions are `aria-busy`; errors use `role="alert"`; other
    feedback uses `role="status"`.
- **Light, Dark or System** theme, chosen in Settings or the More sheet (or
  the sidebar's theme row), stored in the browser.
