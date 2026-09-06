import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";

export function FeatureCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody className="flex gap-3 p-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-small bg-accent-muted text-accent">
          <Icon size={18} />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">{children}</p>
        </div>
      </CardBody>
    </Card>
  );
}
