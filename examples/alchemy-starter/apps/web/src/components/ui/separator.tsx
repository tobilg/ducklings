import type * as React from "react";

import { cn } from "@/lib/utils";

export function Separator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="separator"
      data-slot="separator"
      className={cn("h-px w-full shrink-0 bg-border/70", className)}
      {...props}
    />
  );
}
