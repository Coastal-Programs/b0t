/**
 * Parser for `tsc --noEmit --pretty false` output.
 *
 * Used by the `/fix` slash command (see `.gg/commands/fix.md`, Stage 3a) to
 * convert tsc's line-based text output into normalized diagnostic records.
 *
 * Why hand-rolled and not `@aivenio/tsc-output-parser`:
 * - The output format is narrow (four shapes; see below). The fixtures in
 *   `tests/fix-command/tsc-output-fixtures/` cover every shape this repo
 *   has seen in the wild.
 * - The `/fix` command is a one-shot dev-time helper. Pulling in a
 *   third-party devDependency for it adds supply-chain surface for no
 *   meaningful capability gain.
 *
 * Handled shapes (with `--pretty false`):
 *
 *   1. File-located diagnostic:
 *        `<path>(<line>,<col>): error|warning TS####: <message>`
 *
 *   2. Continuation line: any non-empty line whose first character is a
 *      space, attached to the previous diagnostic's message with `\n`.
 *      Indentation can be 2/4/6+ spaces (nested incompatibility chains)
 *      so we anchor on "starts with whitespace", not a fixed depth.
 *
 *   3. Global diagnostic (no file location):
 *        `error|warning TS####: <message>`
 *      Common case: TS18003 ("No inputs were found"), TS5023 (unknown
 *      compiler option). These have no `file(line,col):` prefix; we emit
 *      them with `file: null, line: null, column: null` so the caller
 *      can surface them rather than silently dropping.
 *
 *   4. Windows-style paths with drive letter (`C:\foo\bar.ts(1,1):`).
 *      The leading capture is anchored on the trailing `(\d+,\d+):` so
 *      the drive-letter colon does not truncate the path.
 *
 * `--pretty true` adds ANSI colors and `~~~~~` underline highlight lines.
 * We never run tsc with `--pretty true` in the `/fix` pipeline (Stage 3a
 * explicitly passes `--pretty false`), so we do not need to handle them.
 */

export type Severity = 'error' | 'warning';

export interface TscDiagnostic {
  source: 'tsc';
  /** Absolute or repo-relative path. `null` for global (no-location) diagnostics. */
  file: string | null;
  /** 1-based. `null` for global diagnostics. */
  line: number | null;
  /** 1-based. `null` for global diagnostics. */
  column: number | null;
  severity: Severity;
  /** e.g. `TS2322`. */
  rule: string;
  /** First-line message plus any continuation lines, joined with `\n`. */
  message: string;
}

// Anchor the file-path capture on the trailing `(<digits>,<digits>):` so a
// Windows drive letter (e.g. `C:\foo\bar.ts`) is not truncated at the first
// colon. The greedy `.+` plus the anchored suffix is unambiguous.
//
// Indexed captures (not named) because the project targets ES2017, where
// named capturing groups are not yet syntactically supported.
//   1=file  2=line  3=column  4=severity  5=rule  6=message
const FILE_LINE_RE = /^(.+)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;

// Diagnostics with no file location, e.g. TS18003.
//   1=severity  2=rule  3=message
const GLOBAL_LINE_RE = /^(error|warning) (TS\d+): (.*)$/;

/**
 * Parse the combined stdout+stderr text of `tsc --noEmit --pretty false`.
 *
 * Lines that match neither shape are ignored (e.g. the trailing
 * `Found N errors in M files.` summary, blank lines).
 */
export function parseTscOutput(text: string): TscDiagnostic[] {
  const out: TscDiagnostic[] = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    if (raw.length === 0) continue;

    // Continuation: starts with whitespace AND we have a prior diagnostic
    // to attach it to. Depth is 2/4/6+ spaces for nested chains; we accept
    // any leading whitespace.
    if (/^\s/.test(raw) && out.length > 0) {
      const prev = out[out.length - 1]!;
      prev.message = `${prev.message}\n${raw}`;
      continue;
    }

    const fileMatch = FILE_LINE_RE.exec(raw);
    if (fileMatch) {
      out.push({
        source: 'tsc',
        file: fileMatch[1]!,
        line: Number.parseInt(fileMatch[2]!, 10),
        column: Number.parseInt(fileMatch[3]!, 10),
        severity: fileMatch[4] as Severity,
        rule: fileMatch[5]!,
        message: fileMatch[6]!,
      });
      continue;
    }

    const globalMatch = GLOBAL_LINE_RE.exec(raw);
    if (globalMatch) {
      out.push({
        source: 'tsc',
        file: null,
        line: null,
        column: null,
        severity: globalMatch[1] as Severity,
        rule: globalMatch[2]!,
        message: globalMatch[3]!,
      });
      continue;
    }

    // Unmatched: tsc summary lines like "Found 3 errors in 2 files." or
    // genuine garbage. Drop silently — the caller has the raw log.
  }

  return out;
}
