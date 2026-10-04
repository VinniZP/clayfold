import { useState } from "react";
import { errorText, saveFile, type DownloadedFile } from "./api";

/** Runs a download; `busy` names the one in progress, `error` holds the last failure. */
export function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, load: () => Promise<DownloadedFile>) => {
    setBusy(key);
    setError(null);
    try {
      saveFile(await load());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}
