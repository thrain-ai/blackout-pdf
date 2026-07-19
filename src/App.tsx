import { useCallback, useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import Landing from "./components/Landing.tsx";
import Editor from "./components/Editor.tsx";
import { loadPdf } from "./pdf/loader.ts";
import { activateFromUrl, isLicensed } from "./license.ts";

export interface LoadedDoc {
  doc: PDFDocumentProxy;
  filename: string;
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justActivated, setJustActivated] = useState(false);
  const [pro, setPro] = useState(false);

  useEffect(() => {
    (async () => {
      const activated = await activateFromUrl();
      if (activated) {
        setJustActivated(true);
        setPro(true);
      } else {
        setPro(await isLicensed());
      }
    })();
  }, []);

  const openFile = useCallback(async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      const doc = await loadPdf(await file.arrayBuffer());
      setLoaded({ doc, filename: file.name });
    } catch (e) {
      console.error(e);
      // Surface the underlying cause — "make sure it's a PDF" hid real
      // browser-compat failures and made bug reports undiagnosable.
      const detail =
        e instanceof Error && e.message ? ` (${e.message})` : "";
      setError(
        `Couldn't open that file${detail}. Password-protected PDFs aren't supported yet — if this is a normal PDF, please email support with your browser version.`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    loaded?.doc.destroy();
    setLoaded(null);
  }, [loaded]);

  return loaded ? (
    <Editor
      key={loaded.filename}
      loaded={loaded}
      onClose={reset}
      pro={pro}
      onActivated={() => setPro(true)}
    />
  ) : (
    <>
      {justActivated && (
        <div className="activated-banner">
          ✓ Pro activated on this device — unlimited pages. Thank you!
        </div>
      )}
      <Landing onFile={openFile} loading={loading} error={error} pro={pro} />
    </>
  );
}
