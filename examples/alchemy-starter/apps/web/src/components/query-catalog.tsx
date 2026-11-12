import { Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { BenchmarkReport } from "@ducklings/alchemy-shared/contract";
import type { QueryDefinition, QueryCategory } from "@ducklings/alchemy-shared/queries";
import { formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";

const CATEGORY_VARIANT: Record<
  QueryCategory,
  "default" | "success" | "violet" | "warning" | "danger" | "outline" | "info"
> = {
  scan: "info",
  aggregate: "success",
  join: "violet",
  window: "warning",
  cte: "danger",
  metadata: "outline",
  quantile: "default",
  timeseries: "info",
};

export function QueryCatalog({
  queries,
  report,
  selectedId,
  runningId,
  onSelect,
  onRun,
}: {
  readonly queries: readonly QueryDefinition[];
  readonly report: BenchmarkReport | null;
  readonly selectedId: string;
  readonly runningId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onRun: (id: string) => void;
}) {
  const metricsById = new Map(
    (report?.queries ?? []).map((query) => [query.id, query]),
  );

  return (
    <Card className="min-h-0">
      <CardHeader>
        <CardTitle>Catalogue</CardTitle>
        <CardDescription>
          {queries.length} fixed statements. Click a row to inspect its result, or run
          it on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[560px] overflow-y-auto">
          {queries.map((query, index) => {
            const metrics = metricsById.get(query.id);
            const selected = query.id === selectedId;
            return (
              <div key={query.id}>
                {index > 0 ? <Separator /> : null}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(query.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(query.id);
                    }
                  }}
                  className={cn(
                    "group flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
                    selected && "bg-muted/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={CATEGORY_VARIANT[query.category]}>
                      {query.category}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {query.title}
                    </span>
                    <span className="text-[11px] tabular text-muted-foreground">
                      {metrics ? formatMs(metrics.medianMs) : "—"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 opacity-60 group-hover:opacity-100"
                      aria-label={`Run ${query.title}`}
                      disabled={runningId === query.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRun(query.id);
                      }}
                    >
                      <Play className="size-3" />
                    </Button>
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {query.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
