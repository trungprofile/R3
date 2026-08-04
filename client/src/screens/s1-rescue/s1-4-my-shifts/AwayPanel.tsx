// "When I'm away" — what the driver has declared, and the form that adds to it.
//
// The explanation at the top is S1.4's, verbatim, and it is load-bearing: a driver
// who marks themselves away over a run they own is refused (I20's declaration
// gate), and this sentence is what tells them that before they try.
//
// Withdrawing sends no notification (state A64), so nothing here says one goes
// out. Declaring does notify the coordinator; the save toast says so.
//
// MOUNTED BY THE BOARD SINCE D49 (`/board?tab=away`), not by this folder's screen —
// which is why it imports its own stylesheet rather than relying on `MyShiftsScreen`
// having been rendered first. It still belongs here: it is S1.4's own half of the
// spec, and where a panel is mounted is a navigation decision, not an ownership one.

import { useCallback, useState } from 'react';
import {
  Button,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  SkeletonRows,
} from '../../../components/index.ts';
import { useAsyncData, useToast } from '../../../app/index.ts';
import { AwayForm } from './AwayForm.tsx';
import { fetchMyTimeAway, withdrawTimeAway } from './data.ts';
import { COPY, failureMessage, groupBlocks } from './logic.ts';
import type { BlockView } from './logic.ts';
import './my-shifts.css';

function BlockRow({ block, onRemove }: { block: BlockView; onRemove: () => void }) {
  return (
    <ListItem>
      <ListRow
        title={block.label}
        side={
          <Button variant="secondary" onClick={onRemove}>
            Remove
          </Button>
        }
      />
    </ListItem>
  );
}

export function AwayPanel() {
  const toast = useToast();
  const load = useCallback((signal: AbortSignal) => fetchMyTimeAway(signal), []);
  const state = useAsyncData(load);
  const [pending, setPending] = useState<BlockView | null>(null);
  const [removing, setRemoving] = useState(false);
  const now = new Date();

  const remove = async (block: BlockView) => {
    setRemoving(true);
    try {
      await withdrawTimeAway(block.id);
      setPending(null);
      toast.success(COPY.removed);
      state.reload();
    } catch (cause) {
      setPending(null);
      toast.error(failureMessage(cause));
    } finally {
      setRemoving(false);
    }
  };

  let list;
  if (state.error) {
    list = <ErrorBlock error={state.error} onRetry={state.reload} />;
  } else if (state.data === null) {
    // Nothing at all under 300ms (§6).
    list = state.showLoading ? <SkeletonRows rows={2} label="Loading your time away" /> : null;
  } else {
    const { upcoming, past } = groupBlocks(state.data.blocks, now);
    list =
      upcoming.length === 0 && past.length === 0 ? (
        <EmptyState title="You haven't marked any time away.">
          Add the days or hours you can't drive, below.
        </EmptyState>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <>
              <h2 className="s14-heading">Coming up</h2>
              <List label="Time away coming up">
                {upcoming.map((block) => (
                  <BlockRow key={block.id} block={block} onRemove={() => setPending(block)} />
                ))}
              </List>
            </>
          ) : null}
          {past.length > 0 ? (
            <>
              <h2 className="s14-heading">Earlier</h2>
              <List label="Earlier time away">
                {past.map((block) => (
                  <BlockRow key={block.id} block={block} onRemove={() => setPending(block)} />
                ))}
              </List>
            </>
          ) : null}
        </>
      );
  }

  return (
    <>
      <p className="s14-explain">{COPY.explain}</p>
      {list}
      <AwayForm now={now} onSaved={state.reload} />
      {pending ? (
        <ConfirmModal
          question={COPY.removeQuestion}
          consequence={`${pending.label}. ${COPY.removeConsequence}`}
          confirmLabel="Remove"
          busy={removing}
          onConfirm={() => void remove(pending)}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
