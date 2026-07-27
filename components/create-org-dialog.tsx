"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/components/auth-provider";
import { createOrganisation } from "@/lib/supabase/mutations";

const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createOrganisation(name, slug || toSlug(name), user.id);
      setName("");
      setSlug("");
      setSlugEdited(false);
      onCreated(id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create organisation");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create an organisation">
        <div className="space-y-4">
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={saving || !name.trim() || !slug.trim()}
            >
              {saving ? <Spinner /> : "Create organisation"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
