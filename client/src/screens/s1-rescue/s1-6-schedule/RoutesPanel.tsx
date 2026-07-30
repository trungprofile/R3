// The route builder — "a route is an ordered list of stores" (S1.6, PRD cap 4).
//
// REORDERING HAS TWO AFFORDANCES AND THEY ARE ONE OPERATION:
//
//   * Drag-and-drop, which `product-requirement.md` cap 4 and `ui-ux-spec.md S1.6`
//     both name explicitly. Native HTML5 drag events, so no dependency is added
//     (build-plan §3/D5) and nothing here is a hand-rolled pointer drag — §1.5's
//     "no fragile controls" rules that out, and it is what got drag rejected for
//     S1.5 (A117).
//   * Move up / Move down buttons on every row, which is not a fallback but the
//     required equivalent: HTML5 drag events do not fire on touch AT ALL, and the
//     responsive matrix marks Scheduling "usable" on a tablet; a keyboard user has
//     no drag gesture either, and §1's accessibility floor does not lift because
//     the canonical device has a mouse.
//
// Both go through the same pure functions (`moveStopTo`, `moveStop`), so the two
// cannot drift into disagreeing about what an order is. A `stops` save REPLACES the
// whole ordered list, so add, remove and reorder land in one request and the server
// assigns the positions.
//
// Editing a template never reaches a run already under way: I6 snapshots a shift's
// stops when it starts, which is why this screen can be edited freely mid-week.

import { useCallback, useState } from 'react';
import {
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  SkeletonRows,
  TextInput,
} from '../../../components/index.ts';
import { useAsyncData, useToast } from '../../../app/index.ts';
import type { DonorSummary, RouteDetail } from '../../../api/shared.ts';
import { ChoiceList } from './controls.tsx';
import {
  createRoute,
  fetchDonors,
  fetchRoutes,
  removeRoute,
  restoreRoute,
  updateRoute,
} from './api.ts';
import {
  COPY,
  EMPTY_ROUTE,
  addStop,
  addableDonors,
  buildRouteCreate,
  buildRouteUpdate,
  failureMessage,
  moveStop,
  moveStopTo,
  removeStop,
  routeFormOf,
  validateRoute,
} from './logic.ts';
import type { RouteForm as RouteFormState, StopDraft } from './logic.ts';

export function RoutesPanel() {
  const [showArchived, setShowArchived] = useState(false);
  const loadRoutes = useCallback(
    (signal: AbortSignal) => fetchRoutes(showArchived, signal),
    [showArchived],
  );
  const routes = useAsyncData<RouteDetail[]>(loadRoutes);
  const [form, setForm] = useState<RouteFormState | null>(null);

  return (
    <div className="s16-panel">
      <div className="s16-panel__head">
        <h2 className="s16-heading">{COPY.routesHeading}</h2>
        {form === null ? (
          <Button variant="primary" onClick={() => setForm(EMPTY_ROUTE)}>
            {COPY.routeNew}
          </Button>
        ) : null}
      </div>

      {form !== null ? (
        <>
          <RouteBuilder
            form={form}
            onChange={setForm}
            onSaved={() => {
              routes.reload();
              setForm(null);
            }}
            onClose={() => setForm(null)}
          />
        </>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setShowArchived((current) => !current)}
        >
          {showArchived ? COPY.routeHideArchived : COPY.routeShowArchived}
        </Button>
      )}

      <RouteList
        routes={routes.data ?? []}
        showLoading={routes.showLoading}
        error={routes.error}
        onRetry={routes.reload}
        selectedId={form?.routeId ?? null}
        onOpen={(route) => setForm(routeFormOf(route))}
        onRestored={routes.reload}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list, and its three states (§3)
// ---------------------------------------------------------------------------

function RouteList({
  routes,
  showLoading,
  error,
  onRetry,
  selectedId,
  onOpen,
  onRestored,
}: {
  routes: readonly RouteDetail[];
  showLoading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  onOpen: (route: RouteDetail) => void;
  onRestored: () => void;
}) {
  const toast = useToast();

  if (showLoading && routes.length === 0) {
    return <SkeletonRows rows={3} label="Loading routes" />;
  }
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (routes.length === 0) {
    return <EmptyState title={COPY.routeEmpty}>{COPY.routeEmptyBody}</EmptyState>;
  }

  const restore = async (route: RouteDetail) => {
    try {
      await restoreRoute(route.id);
      toast.success(COPY.routeRestored);
      onRestored();
    } catch (cause) {
      toast.error(failureMessage(cause));
    }
  };

  return (
    <List label={COPY.routesHeading}>
      {[...routes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((route) => (
          <ListItem key={route.id}>
            {/* An archived route is not editable from here — restoring it first is
                the deliberate step, since I21 hides a soft-deleted record from new
                use rather than from history. */}
            {route.active ? (
              <ListRow
                title={route.name}
                subtitle={COPY.stopCount(route.stops.length)}
                meta={route.stops.map((stop) => stop.donorName).join(' → ')}
                onClick={() => onOpen(route)}
                ariaLabel={
                  route.id === selectedId ? `${route.name} — open above` : route.name
                }
              />
            ) : (
              <ListRow
                title={route.name}
                subtitle={COPY.stopCount(route.stops.length)}
                meta={<span className="s16-run__tag">{COPY.routeArchived}</span>}
                side={
                  <Button variant="secondary" onClick={() => void restore(route)}>
                    {COPY.routeRestore}
                  </Button>
                }
              />
            )}
          </ListItem>
        ))}
    </List>
  );
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

function RouteBuilder({
  form,
  onChange,
  onSaved,
  onClose,
}: {
  form: RouteFormState;
  onChange: (form: RouteFormState) => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const loadDonors = useCallback((signal: AbortSignal) => fetchDonors(signal), []);
  const donors = useAsyncData<DonorSummary[]>(loadDonors);

  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const addable = addableDonors(donors.data ?? [], form.stops);

  const save = async () => {
    const invalid = validateRoute(form);
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      if (form.routeId === null) {
        const body = buildRouteCreate(form);
        if (body === null) return;
        await createRoute(body);
      } else {
        const body = buildRouteUpdate(form);
        if (body === null) return;
        await updateRoute(form.routeId, body);
      }
      toast.success(COPY.routeSaved);
      onSaved();
    } catch (cause) {
      setProblem(failureMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (form.routeId === null) return;
    setSaving(true);
    setProblem(null);
    try {
      // I21 decides which removal happened; the screen reports which rather than
      // asking staff to choose between them.
      const { outcome } = await removeRoute(form.routeId);
      toast.success(outcome === 'DELETED' ? COPY.routeDeleted : COPY.routeArchivedToast);
      setRemoving(false);
      onSaved();
    } catch (cause) {
      setRemoving(false);
      setProblem(failureMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const drop = (to: number) => {
    if (dragFrom !== null) onChange({ ...form, stops: moveStopTo(form.stops, dragFrom, to) });
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <Card ariaLabel={form.routeId === null ? COPY.routeNew : form.name}>
      <h3 className="s16-heading">{form.routeId === null ? COPY.routeNew : form.name}</h3>

      <TextInput
        label={COPY.routeName}
        value={form.name}
        onChange={(name) => {
          setProblem(null);
          onChange({ ...form, name });
        }}
      />

      <h4 className="s16-label">{COPY.routeStops}</h4>
      <p className="s16-hint">{COPY.dragHint}</p>

      {form.stops.length === 0 ? (
        <p className="s16-hint">{COPY.routeStopsEmpty}</p>
      ) : (
        <ol className="s16-stops">
          {form.stops.map((stop, index) => (
            <StopRow
              key={stop.donorId}
              stop={stop}
              index={index}
              total={form.stops.length}
              isOver={dragOver === index}
              onDragStart={() => setDragFrom(index)}
              onDragEnter={() => setDragOver(index)}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onDrop={() => drop(index)}
              onMove={(delta) => onChange({ ...form, stops: moveStop(form.stops, index, delta) })}
              onRemove={() =>
                onChange({ ...form, stops: removeStop(form.stops, stop.donorId) })
              }
            />
          ))}
        </ol>
      )}

      {donors.error ? <ErrorBlock error={donors.error} onRetry={donors.reload} /> : null}

      <ChoiceList
        label={COPY.routeAdd}
        items={addable.map((donor) => ({
          id: donor.id,
          label: donor.name,
          ...(donor.address !== null ? { detail: donor.address } : {}),
        }))}
        value={null}
        onSelect={(donorId) => {
          const donor = addable.find((candidate) => candidate.id === donorId);
          if (donor) {
            setProblem(null);
            onChange({ ...form, stops: addStop(form.stops, donor) });
          }
        }}
        empty={COPY.routeAddEmpty}
      />

      {problem ? (
        <p className="s16-problem" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="s16-actions">
        <Button variant="primary" loading={saving} onClick={() => void save()}>
          {COPY.routeSave}
        </Button>
        {form.routeId !== null ? (
          <Button variant="danger" onClick={() => setRemoving(true)}>
            {COPY.routeRemove}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {removing ? (
        <ConfirmModal
          question={COPY.routeRemoveQuestion}
          consequence={COPY.routeRemoveConsequence}
          confirmLabel={COPY.routeRemoveGo}
          busy={saving}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(false)}
        />
      ) : null}
    </Card>
  );
}

/**
 * One store on the route.
 *
 * The row is the drag source and the drop target, with a large handle as the visual
 * affordance: making only the handle draggable means a mouse user who grabs the row
 * itself gets nothing, which is worse than a forgiving target. The handle is
 * `aria-hidden` because it announces nothing a screen-reader user can act on — the
 * two buttons are what they use, and they are the same operation.
 */
function StopRow({
  stop,
  index,
  total,
  isOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onMove,
  onRemove,
}: {
  stop: StopDraft;
  index: number;
  total: number;
  isOver: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={`s16-stop${isOver ? ' s16-stop--over' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      // Without preventDefault the browser refuses the drop outright.
      onDragOver={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <span className="s16-stop__handle" aria-hidden="true">
        ⠿
      </span>
      <span className="s16-stop__position" aria-hidden="true">
        {index + 1}
      </span>
      <span className="s16-stop__body">
        <span className="s16-stop__name">{stop.donorName}</span>
        {stop.donorAddress !== null ? (
          <span className="s16-stop__address">{stop.donorAddress}</span>
        ) : null}
        {/* I21: a deactivated store is kept on the route and flagged, never dropped
            out from under staff. */}
        {!stop.donorActive ? (
          <span className="s16-run__tag s16-run__tag--warn">{COPY.routeGoneStore}</span>
        ) : null}
      </span>
      <span className="s16-stop__actions">
        {index > 0 ? (
          <Button
            variant="secondary"
            onClick={() => onMove(-1)}
            aria-label={`${COPY.moveUp}: ${stop.donorName}`}
          >
            {COPY.moveUp}
          </Button>
        ) : null}
        {index < total - 1 ? (
          <Button
            variant="secondary"
            onClick={() => onMove(1)}
            aria-label={`${COPY.moveDown}: ${stop.donorName}`}
          >
            {COPY.moveDown}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={onRemove}
          aria-label={`${COPY.removeStop}: ${stop.donorName}`}
        >
          {COPY.removeStop}
        </Button>
      </span>
    </li>
  );
}
