import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Serial. These tests share one database, and the write-skew test needs two
    // genuinely concurrent transactions it controls itself — parallel files would
    // inject unrelated concurrency and make 40001 failures nondeterministic.
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
