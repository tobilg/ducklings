import { Database, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EngineStatus } from "@ducklings/alchemy-shared/contract";
import { cn } from "@/lib/utils";

export function Header({
  status,
  onRefresh,
  refreshing,
}: {
  readonly status: EngineStatus | null;
  readonly onRefresh: () => void;
  readonly refreshing: boolean;
}) {
  const ready = status?.initialized ?? false;

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
            <Database className="size-4 text-primary" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold tracking-tight">
              Ducklings <span className="text-muted-foreground">/</span>{" "}
              Benchmark Lab
            </h1>
            <p className="text-[11px] text-muted-foreground">
              DuckDB WASM · R2 Parquet · Alchemy · Effect
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Badge
            variant={ready ? "success" : "warning"}
            className="gap-1.5 font-mono"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                ready ? "bg-emerald-400" : "bg-amber-400",
              )}
            />
            {ready ? `ready · ${status?.version}` : "cold"}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            Refresh
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <a
              href="https://github.com/tobilg/ducklings"
              target="_blank"
              rel="noreferrer"
              aria-label="Ducklings on GitHub"
            >
              <ExternalLink />
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
