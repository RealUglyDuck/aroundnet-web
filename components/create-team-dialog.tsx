"use client";

import * as React from "react";
import { Search, Plus, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/components/auth-provider";
import { searchPlayers } from "@/lib/supabase/queries";
import { createTeam, addTeamMember } from "@/lib/supabase/mutations";

type Player = { id: string; name: string; city: string | null };

export function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (teamId: string) => void;
}) {
  const { user } = useAuth();
  const [name, setName] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Player[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [members, setMembers] = React.useState<Player[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Debounced player search.
  React.useEffect(() => {
    if (!user || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancel = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchPlayers(query, user.id);
      if (!cancel) {
        setResults(r.filter((p) => !members.some((m) => m.id === p.id)));
        setSearching(false);
      }
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [query, user, members]);

  async function submit() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const teamId = await createTeam(name, user.id);
      for (const m of members) {
        await addTeamMember(teamId, m.id).catch(() => {});
      }
      // reset
      setName("");
      setMembers([]);
      setQuery("");
      onCreated(teamId);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create a team">
        <div className="space-y-4">
          <Field label="Team name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Team Stockholm"
              autoFocus
            />
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium">Add members</p>
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
              />
              <Input
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search players by name…"
              />
              {searching && (
                <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              )}
              {results.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-small border border-divider bg-surface-high shadow-xl">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setMembers((m) => [...m, p]);
                          setQuery("");
                          setResults([]);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface"
                      >
                        <span>
                          {p.name}
                          {p.city && (
                            <span className="text-text-secondary"> · {p.city}</span>
                          )}
                        </span>
                        <Plus size={15} className="text-accent" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              You&apos;ll be added as captain automatically.
            </p>
          </div>

          {members.length > 0 && (
            <div className="space-y-1.5">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-small bg-surface px-3 py-2 text-sm"
                >
                  {m.name}
                  <button
                    onClick={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
                    className="text-text-secondary hover:text-text-primary"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={saving || !name.trim()}>
              {saving ? <Spinner /> : "Create team"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
