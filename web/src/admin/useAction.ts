import { useCallback, useState } from "react";

/**
 * The busy flag, the last confirmation and the last failure an admin write
 * keeps, with the one way to run the write so the three stay in step: the
 * button goes busy, the last answer clears, a throw becomes the error the
 * screen shows, and busy always comes back down — every task used to spell
 * this out by hand, and not always the same way.
 *
 * The write sets its own confirmation with `setNotice`, at the moment the old
 * code did, so nothing appears before its request has actually landed. A screen
 * that keeps the last confirmation up while a new attempt runs passes
 * `keepNotice`.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (work: () => Promise<void>, { keepNotice = false }: { keepNotice?: boolean } = {}) => {
      setBusy(true);
      setError(null);
      if (!keepNotice) setNotice(null);
      try {
        await work();
      } catch (failure) {
        setError((failure as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, notice, error, run, setNotice, setError };
}
