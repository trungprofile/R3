// The two tabs S1.4 specifies ("My runs" and "When I'm away").
//
// Built here rather than imported: `components/index.ts` has no tab or segmented
// control, and `components/` belongs to another owner (build-plan §3). If a second
// screen turns out to want this, the lead promotes it — one screen wanting it is
// not the signal.
//
// Two big buttons and no animation: §1.2 puts the minimum target at 44px, and §1.5
// rules out anything that hides an option behind a gesture.

export interface TabDef<Id extends string> {
  id: Id;
  label: string;
}

export interface TabsProps<Id extends string> {
  tabs: readonly TabDef<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  label: string;
}

export function Tabs<Id extends string>({ tabs, active, onSelect, label }: TabsProps<Id>) {
  return (
    <div className="s14-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`s14-tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`s14-panel-${tab.id}`}
          className={`s14-tab${tab.id === active ? ' s14-tab--active' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
