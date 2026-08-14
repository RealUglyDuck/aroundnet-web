"use client";

import * as React from "react";
import { Search, Plus, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/components/auth-provider";
import { searchPlayers } from "@/lib/supabase/queries";
import { addOrganisationMember, createOrganisation } from "@/lib/supabase/mutations";

const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

type Player = { id: string; name: string; city: string | null };

export function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (orgId: string) => void;
}) {
  const { user } = useAuth();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Player[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [members, setMembers] = React.useState<Player[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Debounced player search — same shape as CreateTeamDialog. Passing the
  // current user as excludeId is what stops you picking yourself; you are
  // already the owner.
  React.useEffect(() => {
    if (!user) return;
    const q = query.trim();
    let cancel = false;
    const t = setTimeout(async () => {
      if (q.length < 2) {
        if (!cancel) setResults([]);
        return;
      }
      if (!cancel) setSearching(true);
      const r = await searchPlayers(q, user.id);
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

  function reset() {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setQuery("");
    setResults([]);
    setMembers([]);
  }

  async function submit() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      // Order matters: createOrganisation inserts the org and then the creator's
      // own owner row, which is what makes is_org_admin() true. Only after that
      // does RLS allow adding anyone else.
      const id = await createOrganisation(name, slug || toSlug(name), user.id);

      const failed: string[] = [];
      for (const m of members) {
        try {
          await addOrganisationMember(id, m.id);
        } catch {
          failed.push(m.name);
        }
      }

      onCreated(id);
      if (failed.length) {
        // The organisation exists — say who didn't make it rather than implying
        // the whole thing failed.
        setError(`Organisation created, but couldn't add: ${failed.join(", ")}`);
        setMembers([]);
      } else {
        reset();
        onOpenChange(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create organisation");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create an organisation">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving && name.trim() && slug.trim()) submit();
          }}
        >
          <Field label="Organisation name">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited) setSlug(toSlug(e.target.value));
              }}
              placeholder="e.g. Stockholm Roundnet"
              autoFocus
            />
          </Field>

          <Field label="Slug" hint="Used in URLs. Lowercase letters, numbers and hyphens.">
            <Input
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(toSlug(e.target.value));
              }}
              placeholder="stockholm-roundnet"
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
                          {p.city && <span className="text-text-secondary"> · {p.city}</span>}
                        </span>
                        <Plus size={15} className="text-accent" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              You&apos;ll be added as owner automatically. Members can run this
              organisation&apos;s tournaments.
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
                    type="button"
                    onClick={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
                    className="text-text-secondary hover:text-text-primary"
                    aria-label={`Remove ${m.name}`}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            {/* type="button": inside a form an untyped button defaults to submit. */}
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !name.trim() || !slug.trim()}>
              {saving ? <Spinner /> : "Create organisation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
