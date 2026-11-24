# NUSHelper website design rules

Every change to the website follows these rules. The shared pieces that
implement them live in `src/styles.css` (colours, motion) and
`src/components/` (Button, Input, Card, Shake, Tooltip, SwapIcon,
Accordion, ScrollFade, Icon). Use those rather than one-off styles.

## 1. Motion: physical and subtle

- **Nothing appears from nothing.** Entrances start almost full size:
  `scale(0.97)` and `opacity: 0`, settling into place
  (`animate-settle`). Never grow from zero.
- **Buttons give tactile feedback.** Pressed buttons shrink to `0.97` over
  150 ms with an ease-out (`Button` does this).
- **Animation carries meaning.**
  - A rejected input shakes like a head shake as well as turning red
    (`Shake`). The error text is always shown too.
  - Moving through steps or levels slides in the direction of travel
    (`animate-slide-from-right` / `-left`) instead of fading: the next
    month, or opening a chat on a phone.
- **Accordions without JavaScript.** Use `<details>` (`Accordion`) with
  `interpolate-size: allow-keywords` so `height: auto` animates. Support
  (MDN data, Nov 2026): Chrome/Edge 129+ only; Safari and Firefox open
  instantly, which is acceptable. Never fake it with JS height measuring.
- **Performance.** Animate only `transform`, `opacity` and `filter`. Never
  `top`, `left`, `width` or `height` (except the accordion above).
- **Animate only when it helps.**
  - Transitions are switched off while the theme changes, so the page
    doesn't fade every colour at once.
  - Only the first tooltip waits (500 ms); others shown soon after appear
    instantly.
  - `prefers-reduced-motion: reduce` turns movement into plain fades, and
    the liquid logo becomes a still image.
- **Easing and timing:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`.
  150 ms for presses and icon swaps, 200–250 ms for entrances and slides.

## 2. Visual detail

- **Nested corners.** Inner radius = outer radius − padding, so curves
  stay parallel. For example:
  - composer: 16 px outer, 8 px padding → 8 px chip
  - chat reply: 20 px outer, 12 px padding → 8 px cards
- **Translucent borders.** Borders are `oklch(0 0 0 / 0.12)` in light
  mode and `oklch(1 0 0 / 0.10)` in dark mode (`border-line`), never
  solid greys.
- **Icons match the text.** Line icons from `lucide-react`, with stroke
  width matched to the text beside them:
  - 1.75 next to regular/medium text
  - 2 next to semibold

  Emoji only appear inside content (the bot's own messages), never as UI
  icons.

- **Icon swaps morph.** The outgoing icon fades with a blur while the new
  one comes in (`SwapIcon`).
- **Scrollable rows fade at the edges.** A mask gradient hints that there
  is more (`ScrollFade`), and only on the side that has more.
- **Photos on white** use `mix-blend-mode: multiply` so the white
  disappears into the page.

## 3. Colour

- **OKLCH only.** All colours are OKLCH tokens in `src/styles.css`. Equal
  `L` really looks equally light, so the calendar's category dots share
  one lightness and chroma.
- **Gradients use `in oklch`** (no grey middle).
- **Dark mode shows depth with lighter surfaces,** not shadows:
  `canvas` → `surface` → `raised` get lighter. Shadows are off in dark
  mode.
- **60 : 30 : 10, with a real colour in each band.** Greys alone are not
  the 30%.
  - **60% dominant:** `canvas` and `surface`. A calm, lightly blue-tinted
    off-white (light) or deep navy (dark).
  - **30% secondary: NUS blue** (`nav`, `brand`, `brand-soft`,
    `brand-text`). Used for:
    - the sidebar and phone top bar
    - card and panel headers, the calendar's weekday row, week chips
    - secondary buttons, borders (blue-tinted), secondary text
    - your own chat messages
  - **10% accent: NUS orange** (`accent`). Used for:
    - main buttons
    - today's date and the selected day
    - the active page's marker and icon
    - links and key highlights

    Never large backgrounds. Orange buttons use dark text (`on-accent`) so
    they stay readable.
- **Categories add controlled variety.** Each calendar type has its own hue
  at one lightness and chroma, shown as a tinted pill with a bar of the
  colour (`pill pill-event`), or as a dot:
  - event (cyan)
  - exam (purple)
  - deadline (red)
  - reminder (pink)
  - class (indigo)
  - task (teal)
  - spending (green)
- **Light, Dark or System** theme, chosen in Settings (or the top bar),
  stored in the browser. `System` follows the device.

## Tokens (use these Tailwind names)

| Token                                                                                         | Use                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `canvas`                                                                                      | page background                                                   |
| `nav`, `nav-ink`, `nav-muted`, `nav-hover`, `nav-active`                                      | the NUS-blue navigation                                           |
| `brand`, `brand-soft`, `brand-text`                                                           | the 30% NUS blue elsewhere                                        |
| `surface`                                                                                     | cards, panels                                                     |
| `raised`                                                                                      | popovers, menus, tooltips (lighter than surface in dark)          |
| `sunken`                                                                                      | inset areas: code, form trays, chips                              |
| `hover`                                                                                       | translucent hover fill                                            |
| `line`, `line-strong`                                                                         | borders (translucent); inputs use `line-strong`                   |
| `ink`, `muted`, `faint`                                                                       | text: main, secondary, hints                                      |
| `accent`, `accent-hover`, `accent-text`, `accent-soft`, `on-accent`                           | the 10% (NUS orange)                                              |
| `danger`, `ok`, `warn` (+ `-soft`)                                                            | states                                                            |
| `cat-event`, `cat-exam`, `cat-deadline`, `cat-reminder`, `cat-class`, `cat-task`, `cat-spend` | calendar categories (equal L and C); `pill pill-<type>` for items |
