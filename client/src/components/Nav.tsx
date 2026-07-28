// Navigation chrome — bottom nav (§3) and the desktop left nav (§4).
//
// Presentational only. WHICH items exist is derived from the signed-in user's
// tier and duties in `app/nav.ts`; this file just draws whatever it is handed.
// Keeping the two apart is what stops a duty rule being re-decided per device.
//
// §3: bottom nav is <=4 items, 56px tall, and icon + label ALWAYS — no icon-only
// nav for a population that should never have to guess what a glyph means.

import type { ReactNode } from 'react';

export interface NavItemView {
  id: string;
  label: string;
  icon: ReactNode;
}

export interface NavProps {
  items: readonly NavItemView[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function BottomNav({ items, activeId, onSelect }: NavProps) {
  return (
    <nav className="r3-bottomnav" aria-label="Main">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            className={`r3-bottomnav__item${active ? ' r3-bottomnav__item--active' : ''}`}
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'page' : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function SideNav({ items, activeId, onSelect }: NavProps) {
  return (
    <nav className="r3-sidenav" aria-label="Main">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            className={`r3-sidenav__item${active ? ' r3-sidenav__item--active' : ''}`}
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'page' : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
