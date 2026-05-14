import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTscOutput, type TscDiagnostic } from './parser';

const FIXTURES_DIR = join(__dirname, 'tsc-output-fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

describe('parseTscOutput', () => {
  it('01-basic: parses single-line file-located diagnostics', () => {
    const diags = parseTscOutput(loadFixture('01-basic.txt'));

    expect(diags).toHaveLength(3);

    const first = diags[0]!;
    expect(first).toEqual<TscDiagnostic>({
      source: 'tsc',
      file: 'src/lib/queue.ts',
      line: 42,
      column: 7,
      severity: 'error',
      rule: 'TS2322',
      message: "Type 'string' is not assignable to type 'number'.",
    });

    // Confirm warning severity is preserved.
    expect(diags[2]!.severity).toBe('warning');
    expect(diags[2]!.rule).toBe('TS6133');
  });

  it('02-multiline-continuation: appends nested-indent continuation lines to prior message', () => {
    const diags = parseTscOutput(loadFixture('02-multiline-continuation.txt'));

    // 3 distinct file-located diagnostics; continuation lines must NOT
    // become their own records.
    expect(diags).toHaveLength(3);

    const first = diags[0]!;
    expect(first.file).toBe('src/lib/foo.ts');
    expect(first.line).toBe(4);
    expect(first.column).toBe(7);
    expect(first.rule).toBe('TS2322');
    // The 2-space and 4-space continuation lines must both be attached.
    expect(first.message).toBe(
      [
        "Type 'A' is not assignable to type 'B'.",
        "  The types of 'foo.bar.baz' are incompatible between these types.",
        "    Type 'number' is not assignable to type 'string'.",
      ].join('\n')
    );

    // Second diagnostic has 2-, 4-, and 6-space continuations.
    const second = diags[1]!;
    expect(second.message.split('\n')).toHaveLength(4);
    expect(second.message).toContain("      Type 'string' is not assignable to type 'number'.");

    // Third is a single-line "and 47 more" message — no continuation.
    expect(diags[2]!.message).toContain('and 47 more');
    expect(diags[2]!.message.split('\n')).toHaveLength(1);
  });

  it('03-no-file-location: captures global diagnostics with null file/line/column', () => {
    const diags = parseTscOutput(loadFixture('03-no-file-location.txt'));

    expect(diags).toHaveLength(3);

    const first = diags[0]!;
    expect(first).toEqual<TscDiagnostic>({
      source: 'tsc',
      file: null,
      line: null,
      column: null,
      severity: 'error',
      rule: 'TS18003',
      message: expect.stringContaining('No inputs were found') as unknown as string,
    });

    expect(diags[1]!.rule).toBe('TS5023');
    expect(diags[1]!.file).toBeNull();

    // File-located diagnostic after globals still parses correctly.
    expect(diags[2]!.file).toBe('src/lib/queue.ts');
    expect(diags[2]!.line).toBe(42);
  });

  it('04-windows-paths: preserves drive-letter paths intact', () => {
    const diags = parseTscOutput(loadFixture('04-windows-paths.txt'));

    expect(diags).toHaveLength(3);

    const first = diags[0]!;
    expect(first).toEqual<TscDiagnostic>({
      source: 'tsc',
      file: 'C:\\Users\\dev\\repo\\src\\lib\\queue.ts',
      line: 42,
      column: 7,
      severity: 'error',
      rule: 'TS2322',
      message: "Type 'string' is not assignable to type 'number'.",
    });

    // Drive letter must not be truncated at its colon.
    expect(diags[1]!.file).toBe('D:\\projects\\app\\src\\app\\api\\route.ts');
    expect(diags[1]!.rule).toBe('TS1208');

    // Continuation line still attaches to the Windows-path diagnostic.
    expect(diags[2]!.file).toBe('C:\\Users\\dev\\repo\\src\\lib\\foo.ts');
    expect(diags[2]!.message).toBe(
      [
        "Type 'A' is not assignable to type 'B'.",
        "  Type 'number' is not assignable to type 'string'.",
      ].join('\n')
    );
  });

  it('ignores tsc summary lines and blank lines', () => {
    const text = [
      'src/lib/queue.ts(42,7): error TS2322: Type X.',
      '',
      'Found 1 error in 1 file.',
      '',
    ].join('\n');

    const diags = parseTscOutput(text);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.rule).toBe('TS2322');
  });
});
