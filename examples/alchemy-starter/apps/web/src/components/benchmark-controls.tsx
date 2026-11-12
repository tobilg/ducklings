import { RefreshCw, RotateCcw, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function BenchmarkControls({
  iterations,
  onIterationsChange,
  onRun,
  running,
  onReset,
  resetting,
  error,
}: {
  readonly iterations: number;
  readonly onIterationsChange: (value: number) => void;
  readonly onRun: () => void;
  readonly running: boolean;
  readonly onReset: () => void;
  readonly resetting: boolean;
  readonly error: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="size-4 text-muted-foreground" />
          Benchmark
        </CardTitle>
        <CardDescription>
          Runs every catalogue query sequentially, one browser-timed
          `/api/query` round trip per sample. Each sample gets a fresh DuckDB
          database, so the benchmark measures the per-request path.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Iterations
          </span>
          <Input
            type="number"
            min={1}
            max={5}
            value={iterations}
            onChange={(event) =>
              onIterationsChange(
                Math.min(5, Math.max(1, Number(event.target.value) || 1)),
              )
            }
          />
        </label>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={onRun}
            disabled={running || resetting}
          >
            <RefreshCw className={running ? "animate-spin" : undefined} />
            {running ? "Running…" : "Run benchmark"}
          </Button>
          <Button
            variant="outline"
            onClick={onReset}
            disabled={running || resetting}
            aria-label="Reset engine"
          >
            <RotateCcw className={resetting ? "animate-spin" : undefined} />
          </Button>
        </div>
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
