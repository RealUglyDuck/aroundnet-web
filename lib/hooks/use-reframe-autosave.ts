"use client";

import * as React from "react";
import { upsertReframeDocument } from "@/lib/supabase/mutations";
import { DEFAULT_TARGET, serializeDoc, type ReframeDoc } from "@/lib/reframe/model";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** How long the editor stays quiet before a write goes out. */
const DEBOUNCE_MS = 2000;

/**
 * A save has to outlast this before the header admits to it. Below it the
 * "Saving…" label would be a flicker, and showing it costs two re-renders of
 * the whole editor tree.
 */
const SAVING_LABEL_MS = 400;

/**
 * A document nobody has touched. Merely opening a clip to watch it should not
 * put a row in the table, so the first real edit is what creates one.
 */
function isPristine(doc: ReframeDoc): boolean {
  return (
    doc.keyframes.length === 0 &&
    doc.segments.length === 0 &&
    doc.target.width === DEFAULT_TARGET.width &&
    doc.target.height === DEFAULT_TARGET.height
  );
}

/**
 * Keep the reframe document in Supabase, without anyone having to press a
 * button.
 *
 * `fingerprint` identifies the source video (lib/reframe/fingerprint.ts) and is
 * null until it has been computed; nothing is written before then.
 *
 * `markSaved` is handed back so the editor can declare a document already
 * current — it calls this right after restoring one from the server, which is
 * what stops the restore immediately writing itself back.
 */
export function useReframeAutosave({
  doc,
  fingerprint,
  userId,
}: {
  doc: ReframeDoc | null;
  fingerprint: string | null;
  userId: string | null;
}) {
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);

  // What the server holds, in both forms. The document identity is the cheap
  // gate on the hot path; the string is the authoritative comparison and is
  // only ever computed inside flush().
  const lastSavedDocRef = React.useRef<ReframeDoc | null>(null);
  const lastSavedJsonRef = React.useRef<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pending write, read by the debounce timer and the visibility flush.
  const pendingRef = React.useRef<{
    doc: ReframeDoc;
    fingerprint: string;
    userId: string;
  } | null>(null);

  const markSaved = React.useCallback((saved: ReframeDoc | null) => {
    lastSavedDocRef.current = saved;
    lastSavedJsonRef.current = saved ? serializeDoc(saved) : null;
  }, []);

  const flush = React.useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // The real comparison, once per debounce rather than once per edit.
    const json = serializeDoc(pending.doc);
    lastSavedDocRef.current = pending.doc;
    if (json === lastSavedJsonRef.current) return;

    // "Saving…" only appears if the write is slow enough to be worth
    // mentioning. A fast save then sets "saved" over "saved", which React
    // discards — so the common case re-renders the editor zero times.
    savingTimerRef.current = setTimeout(() => setStatus("saving"), SAVING_LABEL_MS);
    try {
      await upsertReframeDocument({
        userId: pending.userId,
        fingerprint: pending.fingerprint,
        sourceName: pending.doc.source.name,
        duration: pending.doc.source.duration,
        width: pending.doc.source.width,
        height: pending.doc.source.height,
        doc: JSON.parse(json),
      });
      lastSavedJsonRef.current = json;
      setStatus("saved");
      setError(null);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not save your edit");
    } finally {
      if (savingTimerRef.current) {
        clearTimeout(savingTimerRef.current);
        savingTimerRef.current = null;
      }
    }
  }, []);

  // Queue a write whenever the document changes.
  //
  // This effect is on the editor's hot path — a keyframe drag commits a new
  // document on every rAF — so it must stay cheap. The only comparison here is
  // an identity check; serialising instead cost up to 2ms per frame on a big
  // document, which is most of a frame budget spent proving nothing changed.
  React.useEffect(() => {
    if (!doc || !fingerprint || !userId) return;
    if (doc === lastSavedDocRef.current) return;
    if (isPristine(doc) && lastSavedJsonRef.current === null) return;

    pendingRef.current = { doc, fingerprint, userId };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [doc, fingerprint, userId, flush]);

  // A hidden tab can be frozen or discarded outright — the compare viewer
  // learned this the hard way — so bank the pending edit on the way out rather
  // than waiting for a debounce that may never fire.
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  React.useEffect(
    () => () => {
      if (savingTimerRef.current) clearTimeout(savingTimerRef.current);
    },
    [],
  );

  return { status, error, markSaved, flush };
}
