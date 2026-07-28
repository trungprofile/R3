// Vite resolves a `.css` import to a side effect (the stylesheet is injected in
// dev, extracted in the build). TypeScript needs to be told the module exists.
//
// Declared here rather than by pulling in `vite/client`, which also declares
// globals this program has no use for.

declare module '*.css';
