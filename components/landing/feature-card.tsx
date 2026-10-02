import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";

export function FeatureCard({
  icon: Icon,
  title,
  pro = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Marks a feature that needs AroundNet Pro in the iOS app. */
  pro?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody className="flex gap-3 p-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-small bg-accent-muted text-accent">
          <Icon size={18} />
        </span>
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold">
            {title}
            {pro && <Badge tone="accent">Pro</Badge>}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">{children}</p>
        </div>
      </CardBody>
    </Card>
  );
}
