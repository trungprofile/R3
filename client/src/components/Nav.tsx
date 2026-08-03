// Navigation chrome — bottom nav (§3) and the desktop left nav (§4).
//
// Presentational only. WHICH items exist is derived from the signed-in user's
// tier and duties in `app/nav.ts`; this file just draws whatever it is handed.
// Keeping the two apart is what stops a duty rule being re-decided per device.
//
// §3: bottom nav is <=4 items, 56px tall, and icon + label ALWAYS — no icon-only
// nav for a population that should never have to guess what a glyph means.
//
// Both draw a flat list. `SideNav` still TAKES sections because the shape is what
// lets the shell hand the same value to either one; it no longer draws a heading,
// because D30 left nothing to head — one entry per capability, in one run.

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

/** One run of nav items. `heading` is `null` everywhere since D30 and is no longer
 *  drawn; it stays on the type so no caller's signature had to change with it. */
export interface NavSectionView {
  heading: string | null;
  items: readonly NavItemView[];
}

export interface SideNavProps {
  sections: readonly NavSectionView[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Tapping the mark goes home. Optional: the shell knows where home is, this
   *  component does not, and a masthead that silently does nothing is worse than
   *  one that is plainly inert. */
  onSelectHome?: () => void;
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

export function SideNav({ sections, activeId, onSelect, onSelectHome }: SideNavProps) {
  // The pantry's mark lives HERE and not in the top bar (D32). The mark is dark type
  // on a white ground, and §3 pins the top bar to --structural-dark — put there it
  // needs a white plate, which reads as a sticker rather than a masthead. The sidebar
  // is already a light surface, so the mark sits on its own ground and the words
  // inside it are legible. Intrinsic size stops a reflow when the image lands late.
  //
  // The mark carries the pantry's NAME set in type, so it must never be decorative:
  // whichever element is focusable owns that name, and the image goes `alt=""` when
  // the button above it does. Tapping it goes home, the convention every masthead
  // follows — and a second route to Home is the point, not a duplicate to prune.
  const logo = (
    <img
      className="r3-sidenav__logo"
      src="/agfp-logo.png"
      width={300}
      height={83}
      alt={onSelectHome ? '' : 'Amazing Grace Food Pantry'}
    />
  );

  return (
    <nav className="r3-sidenav" aria-label="Main">
      <div className="r3-sidenav__brand">
        {onSelectHome ? (
          <button
            type="button"
            className="r3-sidenav__brandbutton"
            onClick={onSelectHome}
            aria-label="Amazing Grace Food Pantry, home"
          >
            {logo}
          </button>
        ) : (
          logo
        )}
      </div>
      {sections.map((section, index) => (
        <div key={`nav-run-${index}`} className="r3-sidenav__group">
          {section.items.map((item) => {
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
        </div>
      ))}
    </nav>
  );
}
