"use client";

import * as React from "react";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  fetchOrganisationMembers,
  searchPlayers,
  type OrganisationMember,
} from "@/lib/supabase/queries";
import { addOrganisationMember, removeOrganisationMember } from "@/lib/supabase/mutations";
import type { OrgRole } from "@/lib/types";

const ROLE_TONE = {
  owner: "accent",
  admin: "warning",
  member: "neutral",
} as const;

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

type Player = { id: string; name: string; city: string | null };

/**
 * The member list for one organisation, collapsed by default.
 *
 * Add/remove is shown only to owners and admins — the same people
 * `is_org_admin()` lets through — so the UI never offers an action RLS will
 * reject with a 42501.
 */
export function OrganisationMembers({
  organisationId,
  viewerRole,
  currentUserId,
}: {
  organisationId: string;
  viewerRole: OrgRole;
  currentUserId: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [members, setMembers] = React.useState<OrganisationMember[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Player[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canManage = viewerRole === "owner" || viewerRole === "admin";

  const load = React.useCallback(() => {
    fetchOrganisationMembers(organisationId)
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load members"));
  }, [organisationId]);

  // Only fetch once the card is actually opened — the profile page can show
  // several organisations at once.
  React.useEffect(() => {
    if (open && members === null) load();
  }, [open, members, load]);

  // Debounced search, excluding anyone already in the organisation. Every state
  // update happens inside the timeout rather than in the effect body, so the
  // effect never sets state synchronously on render.
  React.useEffect(() => {
    if (!canManage) return;
    const q = query.trim();
    let cancel = false;
    const t = setTimeout(async () => {
      if (q.length < 2) {
        if (!cancel) setResults([]);
        return;
      }
      if (!cancel) setSearching(true);
      const r = await searchPlayers(q, currentUserId);
      if (!cancel) {
        setResults(r.filter((p) => !(members ?? []).some((m) => m.playerId === p.id)));
        setSearching(false);
      }
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [query, canManage, currentUserId, members]);

  const ownerCount = (members ?? []).filter((m) => m.role === "owner").length;

  /**
   * The last owner may not remove themselves. Nothing in the database prevents
   * it, and the result is an organisation nobody can ever administer again —
   * is_org_admin() would return false for everyone, permanently locking both
   * org edits and membership changes.
   */
  function removable(m: OrganisationMember): boolean {
    if (!canManage) return false;
    if (m.playerId !== currentUserId) return true;
    return !(m.role === "owner" && ownerCount === 1);
  }

  async function add(p: Player) {
    setBusy(true);
    setError(null);
    try {
      await addOrganisationMember(organisationId, p.id);
      setQuery("");
      setResults([]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't add ${p.name}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: OrganisationMember) {
    setBusy(true);
    setError(null);
    try {
      await removeOrganisationMember(m.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't remove ${m.name}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-xs text-text-secondary hover:text-text-primary"
      >
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {members === null
          ? "Members"
          : `${members.length} ${members.length === 1 ? "member" : "members"}`}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {members === null ? (
            <Spinner className="text-text-secondary" />
          ) : (
            <ul className="divide-y divide-divider">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm">{m.name}</span>
                    {m.playerId === currentUserId && (
                      <span className="shrink-0 text-xs font-medium text-accent">You</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                    {removable(m) && (
                      <button
                        type="button"
                        onClick={() => remove(m)}
                        disabled={busy}
                        aria-label={`Remove ${m.name}`}
                        className="text-text-secondary hover:text-destructive disabled:opacity-40"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
              />
              <Input
                className="pl-9 text-sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Add member — search by name…"
              />
              {searching && (
                <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              )}
              {results.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-small border border-divider bg-surface-high shadow-xl">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => add(p)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface disabled:opacity-40"
                      >
                        <span>
                          {p.name}
                          {p.city && <span className="text-text-secondary"> · {p.city}</span>}
                        </span>
                        <Plus size={14} className="text-accent" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
