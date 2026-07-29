// Segmented control — `ui-ux-spec.md §3`.
//
// A row of big buttons where exactly one is chosen, standing in for the dropdown
// §1.5 rules out: every option is visible without opening anything, and each is a
// 44px target rather than a fragile control.
//
// It has TWO ARIA modes because it does two jobs, and the difference is not
// cosmetic:
//
//   'filter' (default) — narrows a list that stays on screen (S1.2's All · Open ·
//     Mine). `role="group"` + `aria-pressed`: these are toggles, and every one of
//     them is in the tab order, because a keyboard user reaching the third option
//     must not have to change the filter twice on the way.
//
//   'tabs' — switches which panel is mounted (S1.4's My runs / When I'm away, and
//     S1.8's admin shell). `role="tablist"` + `aria-selected` + `aria-controls`,
//     which obliges the rest of the WAI-ARIA tab pattern: ONE stop in the tab
//     order (roving tabindex), arrows to move between tabs, Home/End to the ends.
//     A `role="tablist"` without that is worse than no role at all — it promises a
//     screen-reader user an interaction the widget does not implement.
//
// The two modes look identical. The selected item is `--action-fill` with a
// `--text-on-brand` label (5.0:1, §2's stated pairing) in both — §2 sanctions
// orange as fill AND as a selected bar, so this is a house choice rather than a
// rule: the fill is legible at arm's length in a truck, which is §1's whole
// posture, and one control with two looks is the duplication this component was
// promoted to end.

import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedBase<T extends string> {
  /** Names the group for a screen reader — the labels alone say "All / Open / Mine". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * `idPrefix` is required in `tabs` mode and absent in `filter` mode, enforced by
 * the union: `aria-controls` has to point at a real panel id, and a tab that
 * points nowhere is the failure this shape makes unrepresentable.
 */
export type SegmentedProps<T extends string> = SegmentedBase<T> &
  ({ mode?: 'filter' } | { mode: 'tabs'; idPrefix: string });

/** The id `aria-controls` points at. Exported so the panel cannot drift from the tab. */
export function tabId(idPrefix: string, value: string): string {
  return `${idPrefix}-tab-${value}`;
}

export function panelId(idPrefix: string, value: string): string {
  return `${idPrefix}-panel-${value}`;
}

/**
 * Spread onto the element the tabs control. Pairs with `mode="tabs"`; keeping both
 * halves of the wiring in one file is what stops an `aria-controls` pointing at an
 * id nobody renders.
 */
export function tabPanelProps(idPrefix: string, value: string) {
  return {
    role: 'tabpanel' as const,
    id: panelId(idPrefix, value),
    'aria-labelledby': tabId(idPrefix, value),
    // A panel is not focusable content on its own, but it must be reachable: after
    // arrowing to a tab, the next Tab press has to land somewhere.
    tabIndex: 0,
  };
}

export function Segmented<T extends string>(props: SegmentedProps<T>) {
  const { label, options, value, onChange } = props;
  const asTabs = props.mode === 'tabs';
  const idPrefix = props.mode === 'tabs' ? props.idPrefix : null;
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  // Arrow keys move the selection AND the focus together, which is the automatic-
  // activation form of the pattern. Correct here because switching panels is free:
  // both are already-loaded local state, so there is nothing to regret arrowing past.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!asTabs) return;
    const index = options.findIndex((option) => option.value === value);
    if (index < 0) return;

    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + options.length) % options.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = options.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const target = options[next]!.value;
    onChange(target);
    buttons.current.get(target)?.focus();
  }

  return (
    <div
      className="r3-segmented"
      role={asTabs ? 'tablist' : 'group'}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) buttons.current.set(option.value, node);
              else buttons.current.delete(option.value);
            }}
            type="button"
            className={selected ? 'r3-segmented__item is-selected' : 'r3-segmented__item'}
            onClick={() => onChange(option.value)}
            {...(asTabs && idPrefix
              ? {
                  role: 'tab' as const,
                  id: tabId(idPrefix, option.value),
                  'aria-selected': selected,
                  'aria-controls': panelId(idPrefix, option.value),
                  // Roving tabindex: the tablist is one stop, arrows do the rest.
                  tabIndex: selected ? 0 : -1,
                }
              : { 'aria-pressed': selected })}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
