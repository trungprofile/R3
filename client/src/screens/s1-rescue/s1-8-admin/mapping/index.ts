// The AGFP→NTFB matching, S1.8's fourth panel (D17, overriding D11).
//
// One import for the Admin screen. `MappingEditor.tsx` is also importable directly
// and that is a supported path, not an accident — both resolve to the same
// component, and the exported name is `MappingEditor` either way.

export { MappingEditor } from './MappingEditor.tsx';
export type { MappingEditorProps } from './MappingEditor.tsx';
export * from './mapping.ts';
