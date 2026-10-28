/**
 * Quiet exit when the reader of stdout goes away (`inkos lint study | head`):
 * writing to a closed pipe raises EPIPE as an `error` event on the stream, which
 * would otherwise crash with an unhandled stack trace. Other stream errors still throw.
 */
export function exitQuietlyOnEpipe(
  stream: NodeJS.WritableStream = process.stdout,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") exit(0);
    else throw error;
  });
}
