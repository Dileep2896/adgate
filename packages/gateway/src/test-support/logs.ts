import type { DestinationStream } from 'pino';

/** An in-memory pino destination so tests can assert on emitted log lines. */
export const collectLogs = (): { lines: string[]; stream: DestinationStream } => {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write: (line: string) => {
        lines.push(line);
      },
    },
  };
};
