// The coordinator→driver note (`Shift.staff_note`, PRD cap 11 channel 1).
//
// S1.3: "staff can add/edit it here (desktop view); driver sees it read-only."
// Which of those two a viewer gets is decided by their tier, not by their device —
// a coordinator on a phone still edits, and the owner on a desktop still reads.
//
// A driver with no note sees nothing at all: §1.7 keeps off screen anything the
// task does not need, and an empty "no note" box is exactly that. Staff see the
// empty state, because for them it is the thing to act on.

import { useEffect, useState } from 'react';
import { Button, Card, TextInput } from '../../../components/index.ts';
import { COPY } from './detail.ts';

export interface StaffNoteCardProps {
  note: string | null;
  /** Tier >= STAFF (I1). The server declares the same floor on the write. */
  editable: boolean;
  /** Resolves true when the note reached the server, so the editor stays open on a
   *  failure instead of pretending it saved. */
  onSave: (note: string | null) => Promise<boolean>;
}

export function StaffNoteCard({ note, editable, onSave }: StaffNoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  const [saving, setSaving] = useState(false);

  // A save replaces the shift; keep the field on the saved value.
  useEffect(() => setDraft(note ?? ''), [note]);

  if (!editable && note === null) return null;

  const save = async () => {
    setSaving(true);
    try {
      const trimmed = draft.trim();
      // Empty clears it: the server reads `null` as "clear" and an absent field as
      // "leave alone", so a staff member who deletes the text means the former.
      if (await onSave(trimmed === '' ? null : trimmed)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card ariaLabel={editable ? COPY.staffNoteEditLabel : COPY.staffNoteLabel}>
      <p className="s13-label">{editable ? COPY.staffNoteEditLabel : COPY.staffNoteLabel}</p>

      {editing ? (
        <div className="s13-note__editor">
          <TextInput
            label={COPY.staffNoteEditLabel}
            value={draft}
            onChange={setDraft}
            multiline
            disabled={saving}
          />
          <div className="s13-actions">
            <Button variant="secondary" loading={saving} onClick={() => void save()}>
              {COPY.saveStaffNote}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(note ?? '');
                setEditing(false);
              }}
            >
              {COPY.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="s13-note__body">{note ?? COPY.staffNoteEmpty}</p>
          {editable ? (
            <div className="s13-actions">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {note === null ? COPY.addStaffNote : COPY.editStaffNote}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
