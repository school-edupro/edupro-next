# @edupro/ui

Mobilise Design System for EduPro Next.

- `src/tokens/*.css`: the token files from the supplied design-system package, unchanged. Brand navy `#00265D`, cyan `#00A0C6`, Poppins headings, Source Sans 3 body, 8 px spacing scale, 6/10/16 px radii, navy-tinted shadows, 150/250 ms motion.
- `src/app.css`: the ERP application layer (shell, page anatomy, cards, buttons, badges, fields, tables, alerts, KPI tiles) written only with tokens.
- `src/components/*`: React components that compose the classes above. No inline colours or sizes.
- `.oxlintrc.json`: the design system's adherence rules (no raw hex, no raw px, only Poppins and Source Sans 3). Runs in `pnpm lint`.
- `assets/mobilise-logo.png`: the only official asset.

## Usage

```tsx
// app/layout.tsx
import '@edupro/ui/tokens.css';
import '@edupro/ui/app.css';
```

```tsx
import { PageHeader, Button, DataTable, Badge, toneForStatus } from '@edupro/ui';
```

## Rules

1. Tokens only. If a value is missing, add a token in `app.css` under `:root` with a name, never a raw value in a component.
2. One dark navy surface per screen: the sidebar. Content stays on white and pale blue bands.
3. Cards use a border or a shadow, never both.
4. Buttons are rounded rectangles (6 px). Pills are reserved.
5. Status colours mean status. Charts use navy and cyan.
6. Every interactive element has a visible focus ring and a 44 px touch target on mobile surfaces.
7. Lucide icons only, 1.75 px stroke. No emoji, no icon fonts.
8. Text goes through the i18n layer; components receive strings, never hard-code them.

## Roadmap

Sprint 3 adds Storybook, visual regression, the TanStack-based data table, drawer, dialog, toast and breadcrumbs. Official brand fonts, if supplied, replace the Google Fonts stand-ins in `tokens/fonts.css` with no other change.
