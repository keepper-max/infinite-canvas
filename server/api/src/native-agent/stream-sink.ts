/** Coalesce only while persistence is busy. No timer, retry or dropped deltas. */
export function streamSink(emit: (text: string) => Promise<void>) {
  let pending = "",
    active: Promise<void> | undefined;
  let failed = false,
    failure: unknown;
  const drain = async () => {
    while (pending) {
      const text = pending;
      pending = "";
      await emit(text);
    }
  };
  return {
    push(text: string) {
      if (failed) throw failure;
      pending += text;
      if (!active) {
        active = drain()
          .catch((error) => {
            failed = true;
            failure = error;
          })
          .finally(() => {
            active = undefined;
          });
      }
    },
    async flush() {
      await active;
      if (failed) throw failure;
      if (pending) await drain();
    },
  };
}
