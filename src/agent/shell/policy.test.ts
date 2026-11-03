import { describe, expect, it } from 'vitest';
import { foregroundYieldMs } from './policy';

describe('只扫描可信命令位置，未知语法保守默认', () => {
  it.each([
    ['npm run dev', 10_000],
    ['npm run start', 10_000],
    ['pnpm --filter web dev', 10_000],
    ['npm run dev:build', 45_000],
    ['npm run start-once', 45_000],
    ['npm run "dev"', 45_000],
    ['echo "npm run dev"', 45_000],
    ["'npm run dev'", 45_000],
    ['echo npm run dev', 45_000],
    ['echo --watch', 45_000],
    ['node -e "npm run dev"', 45_000],
    ['vitest --watch=false', 180_000],
    ['jest --watchAll=false', 180_000],
    ['vitest --watch', 10_000],
    ['# npm run dev\necho ok', 45_000],
    ['echo ok # npm run dev', 45_000],
    ['cat <<EOF\nnpm run dev\nEOF', 45_000],
    ["cat <<'EOF'\nnpm run dev\nEOF", 45_000],
    ['echo $((1&2))', 45_000],
    ['echo "x; npm run dev"', 45_000],
    ['printf hi && npm run dev', 10_000],
    ['npm test; npm run build', 180_000],
    ['env npm run dev', 10_000],
    ['npx vite', 10_000],
    ['pnpm exec tsc', 180_000],
    ['npm run dev --help', 45_000],
    ['echo "unterminated; npm run dev', 45_000],
  ])('%s → %s', (command, expected) => expect(foregroundYieldMs(command)).toBe(expected));

  it.each([
    ['& npm.exe run dev', 10_000],
    ['Write-Output "npm run dev"', 45_000],
    ["Write-Output @'\nnpm run dev\n'@", 45_000],
    ['# npm run dev\nGet-Process', 45_000],
    ['Write-Output $(1 -band 2)', 45_000],
  ])('PowerShell: %s → %s', (command, expected) =>
    expect(foregroundYieldMs(command, 'powershell')).toBe(expected)
  );
});
