import { HardDrive } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DatasetStatus } from "@ducklings/alchemy-shared/contract";
import { formatBytes, formatMs, formatNumber, formatTime } from "@/lib/format";

const sourceVariant = (source: "r2" | "http" | "cache") =>
  source === "r2" ? "success" : source === "cache" ? "info" : "warning";

export function DatasetCard({
  dataset,
}: {
  readonly dataset: DatasetStatus | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4 text-muted-foreground" />
          {dataset?.title ?? "Dataset"}
        </CardTitle>
        <CardDescription>
          {dataset
            ? `${formatBytes(dataset.totalBytes)} · ${formatNumber(dataset.totalRows)} rows · loaded ${formatMs(dataset.loadMs)} at ${formatTime(dataset.loadedAt)}`
            : "TPC-H SF 0.01 Parquet, read from R2 or the public mirror."}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {dataset ? (
          <div className="border-t border-border/70">
            {dataset.files.map((file, index) => (
              <div key={file.name}>
                {index > 0 ? <Separator /> : null}
                <div className="flex items-center gap-2 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {file.name}
                  </span>
                  <span className="text-[11px] tabular text-muted-foreground">
                    {formatNumber(file.rows)} rows
                  </span>
                  <span className="w-16 text-right text-[11px] tabular text-muted-foreground">
                    {formatBytes(file.bytes)}
                  </span>
                  <Badge variant={sourceVariant(file.source)}>
                    {file.source}
                  </Badge>
                </div>
              </div>
            ))}
            <Separator />
            <div className="flex items-center justify-between px-4 py-2 text-[11px] text-muted-foreground">
              <span className="font-mono">{dataset.prefix}/</span>
              <span>{formatMs(dataset.loadMs)} load total</span>
            </div>
          </div>
        ) : (
          <p className="border-t border-border/70 px-4 py-6 text-xs text-muted-foreground">
            The dataset loads on the first query. Seed R2 with{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono">
              bun run seed
            </code>
            , or let the Worker fall back to the public mirror.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
