export const APPLY_PATCH_LIMITS = {
  patchBytes: 1024 * 1024,
  files: 100,
  chunks: 1000,
  fileBytes: 4 * 1024 * 1024,
  totalReadBytes: 16 * 1024 * 1024,
  comparisons: 1_000_000,
} as const;
