// Big list row — `ui-ux-spec.md §3`.
//
// >=56px tall, name/title left, status chip right, and THE FULL ROW is the
// target — not a link inside it. Used for shifts, names and stores, which is
// most of what R3 shows. §1 principle 4: tap your name from a list, do not type.
//
// `Card` lives here too: both are the containers everything else sits in.

import type { ReactNode } from 'react';

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  /** Right-hand slot — normally one `StatusChip`. */
  side?: ReactNode;
  /** Omit to render a row that is information only, with no target. */
  onClick?: () => void;
  /** Accessible name when the title alone is not a sentence. */
  ariaLabel?: string;
}

export function ListRow({ title, subtitle, meta, side, onClick, ariaLabel }: ListRowProps) {
  const body = (
    <>
      <span className="r3-row__main">
        <span className="r3-row__title">{title}</span>
        {subtitle ? (
          <>
            <br />
            <span className="r3-row__subtitle">{subtitle}</span>
          </>
        ) : null}
        {meta ? (
          <>
            <br />
            <span className="r3-row__meta">{meta}</span>
          </>
        ) : null}
      </span>
      {side ? <span className="r3-row__side">{side}</span> : null}
    </>
  );

  if (!onClick) {
    return (
      <div className="r3-row r3-row--static" {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="r3-row"
      onClick={onClick}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
    >
      {body}
    </button>
  );
}

/** A list of `ListRow`s. Semantic list markup so a screen reader announces the
 *  count — the board is long and "1 of 14" is orientation. */
export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="r3-list" {...(label ? { 'aria-label': label } : {})}>
      {children}
    </ul>
  );
}

export function ListItem({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

/** Card — `--surface-paper`, 12px radius, 1px border (§3). */
export function Card({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <section className="r3-card" {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}>
      {children}
    </section>
  );
}
