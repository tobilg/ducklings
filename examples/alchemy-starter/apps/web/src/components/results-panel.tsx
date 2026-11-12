import { Database, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Cell, QueryRun } from "@ducklings/alchemy-shared/contract";
import { formatBytes, formatMs, formatNumber } from "@/lib/format";

const renderCell = (cell: Cell) => {
  if (cell === null) {
    return <span className="text-muted-foreground/50">NULL</span>;
  }
  if (typeof cell === "number") {
    return (
      <span className="tabular">
        {Number.isInteger(cell) ? formatNumber(cell) : cell.toFixed(3)}
      </span>
    );
  }
  if (typeof cell === "boolean") {
    return <Badge variant={cell ? "success" : "outline"}>{String(cell)}</Badge>;
  }
  return <span title={cell}>{cell}</span>;
};

export function ResultsPanel({
  run,
  clientMs,
  loading,
}: {
  readonly run: QueryRun | null;
  readonly clientMs: number | null;
  readonly loading: boolean;
}) {
  return (
    <Card className="min-h-[420px]">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4 text-muted-foreground" />
              {run?.title ?? "Result"}
            </CardTitle>
            <CardDescription>
              {run
                ? `${formatNumber(run.rowCount)} rows${run.truncated ? " (showing first 200)" : ""} · ${run.columns.length} columns`
                : "Run a query to see its rows."}
            </CardDescription>
          </div>
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {run ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge variant="info" className="font-mono">
              client {clientMs === null ? "—" : formatMs(clientMs)}
            </Badge>
            <Badge variant="outline" className="font-mono">
              server{" "}
              {run.metrics.queryMs > 0
                ? formatMs(run.metrics.queryMs)
                : "—"}
            </Badge>
            <Badge variant="outline" className="font-mono">
              ≈ {formatBytes(run.metrics.bytes)}
            </Badge>
            <Badge
              variant={run.metrics.warm ? "success" : "warning"}
              className="font-mono"
            >
              {run.metrics.warm ? "warm" : "cold"}
            </Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {loading && !run ? (
          <div className="space-y-2 px-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-11/12" />
            <Skeleton className="h-6 w-10/12" />
            <Skeleton className="h-6 w-9/12" />
          </div>
        ) : null}
        {run ? (
          <div className="max-h-[420px] overflow-auto border-t border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  {run.columns.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <TableCell key={cellIndex}>
                        {renderCell(cell)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {!run && !loading ? (
          <div className="flex h-[300px] items-center justify-center text-xs text-muted-foreground">
            No result yet.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
