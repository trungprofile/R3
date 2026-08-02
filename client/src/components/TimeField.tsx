// A time, chosen from a list that is only there when you ask for it.
//
// What this replaces: a grid of 35 always-visible buttons (half-hour steps, 5am to
// 10pm) rendered twice on the publish form, once for Starts and once for Ends. It
// was built that way on purpose — §1 principle 5 rules out "fragile controls", and
// a native time input on a phone is exactly that. But 70 buttons is its own kind of
// unusable, and QA asked for 15-minute steps, which would have made it 138.
//
// So: a button showing the current time, and a list that opens under it. The
// closed state is two controls on the form instead of seventy. The open state is
// still a plain list of big tappable rows, still no dropdown widget, still nothing
// that depends on a drag or a long-press.
//
// Keyboard and screen reader: the trigger is `aria-expanded` + `aria-controls`,
// the list is a `listbox` of `option`s, Up/Down move, Enter/Space pick, Escape
// closes and returns focus to the trigger. That is the listbox pattern, spelled
// out rather than imported, because dependencies are lead-owned (D5).

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export interface TimeFieldProps {
  label: string;
  /** `HH:MM`, pantry-local wall clock. `null` before anything is chosen. */
  value: string | null;
  /** `HH:MM` values, in order. The caller filters — an end time list is normally
   *  the times after the chosen start. */
  options: readonly string[];
  /** How a `HH:MM` is said out loud: "9:00 AM". Passed in so this component holds
   *  no formatting opinion and the screens keep their single formatter. */
  format: (value: string) => string;
  onSelect: (time: string) => void;
  /** Shown on the trigger when `value` is null. */
  placeholder?: string;
  disabled?: boolean;
}

export function TimeField({
  label,
  value,
  options,
  format,
  onSelect,
  placeholder = 'Pick a time',
  disabled = false,
}: TimeFieldProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  // Which row the keyboard is on. Distinct from `value`: you can move through the
  // list without committing, and Escape leaves the committed value alone.
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Opening lands on the current value, not the top of the list. Someone nudging
  // 9:00 to 9:15 should not have to travel from 5am to get there.
  const openList = () => {
    const index = value === null ? 0 : Math.max(0, options.indexOf(value));
    setActiveIndex(index);
    setOpen(true);
  };

  // Scroll the active row into view before paint, so opening on a value 30 rows
  // down does not show the top of the list for a frame first.
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    });
  }, [open, activeIndex]);

  // A click anywhere else closes it. Without this the list stays open behind the
  // next thing the user touches.
  useEffect(() => {
    if (!open) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown);
  }, [open]);

  const commit = (time: string) => {
    onSelect(time);
    close(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const picked = options[activeIndex];
        if (picked !== undefined) commit(picked);
        break;
      }
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      default:
        break;
    }
  };

  const activeOption = options[activeIndex];

  return (
    <div className="r3-timefield">
      <span className="r3-timefield__label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="r3-timefield__trigger"
        disabled={disabled || options.length === 0}
        aria-labelledby={`${id}-label ${id}-trigger`}
        id={`${id}-trigger`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={value === null ? 'r3-timefield__placeholder' : undefined}>
          {value === null ? placeholder : format(value)}
        </span>
        <span className="r3-timefield__caret" aria-hidden="true" />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          className="r3-timefield__list"
          role="listbox"
          aria-labelledby={`${id}-label`}
          aria-activedescendant={activeOption ? `${id}-opt-${activeOption}` : undefined}
          tabIndex={-1}
        >
          {options.map((option, index) => {
            const selected = option === value;
            return (
              <li
                key={option}
                id={`${id}-opt-${option}`}
                role="option"
                aria-selected={selected}
                data-active={index === activeIndex}
                className={`r3-timefield__option${selected ? ' r3-timefield__option--selected' : ''}${
                  index === activeIndex ? ' r3-timefield__option--active' : ''
                }`}
                onPointerDown={(event) => {
                  // Pointer-down, not click: the document listener above fires
                  // first on click and would close the list before it lands.
                  event.preventDefault();
                  commit(option);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {format(option)}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
