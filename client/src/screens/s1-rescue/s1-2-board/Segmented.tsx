// A segmented control — S1.2 asks for one by name ("Filter is a simple segmented
// control: All · Open · Mine (no dropdown)") and `ui-ux-spec.md §3` has no such
// contract, so it is built here rather than in `components/`, which another lane
// owns. Recorded under the report's `Assumed:`.
//
// It is a row of big buttons, which is exactly what §1 principle 5 asks for in
// place of a dropdown: min 44×44px targets, no fragile control, current choice
// visible without opening anything. `aria-pressed` rather than a tablist, because
// these filter one list in place; they do not switch panels.

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  /** Names the group for a screen reader — the buttons alone say "All / Open / Mine". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="r3-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={
            option.value === value ? 'r3-segmented__item is-selected' : 'r3-segmented__item'
          }
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
