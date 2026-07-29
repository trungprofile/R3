// The component contracts of `ui-ux-spec.md §3`, in one import.
//
// Screens build from these. A screen that needs a control not listed here should
// check §3 first — the set is deliberately small, because "no fragile controls"
// (§1.5) is a rule about what does NOT exist as much as what does.

import './components.css';

export { Button } from './Button.tsx';
export type { ButtonProps, ButtonVariant } from './Button.tsx';

export { Segmented, tabPanelProps, tabId, panelId } from './Segmented.tsx';
export type { SegmentedOption, SegmentedProps } from './Segmented.tsx';

export { ListRow, List, ListItem, Card } from './ListRow.tsx';
export type { ListRowProps } from './ListRow.tsx';

export { StatusChip, PushStateChip } from './StatusChip.tsx';
export type { StatusChipProps } from './StatusChip.tsx';

export { TextInput } from './TextInput.tsx';
export type { TextInputProps } from './TextInput.tsx';

export { NumericKeypad } from './NumericKeypad.tsx';
export type { NumericKeypadProps } from './NumericKeypad.tsx';

export { Modal, ConfirmModal } from './Modal.tsx';
export type { ModalProps, ConfirmModalProps } from './Modal.tsx';

export { ToastList } from './Toast.tsx';
export type { ToastKind, ToastMessage } from './Toast.tsx';

export { TopBar } from './TopBar.tsx';
export type { TopBarProps } from './TopBar.tsx';

export { BottomNav, SideNav } from './Nav.tsx';
export type { NavItemView, NavProps } from './Nav.tsx';

export { InboxRow } from './InboxRow.tsx';
export type { InboxRowProps } from './InboxRow.tsx';

export { SkeletonRows, EmptyState, ErrorBlock, useDelayedLoading } from './blocks.tsx';
export type { EmptyStateProps, ErrorBlockProps } from './blocks.tsx';

export * from './icons.tsx';
