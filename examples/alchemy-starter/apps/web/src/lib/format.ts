import * as DateTime from "effect/DateTime";

const numberFormat = new Intl.NumberFormat("en-US");

const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const formatNumber = (value: number): string =>
  numberFormat.format(value);

export const formatMs = (value: number): string =>
  value >= 1000
    ? `${(value / 1000).toFixed(2)} s`
    : value >= 10
      ? `${value.toFixed(1)} ms`
      : `${value.toFixed(2)} ms`;

export const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

/** `epochMs` is the wire representation; DateTime owns the formatting. */
export const formatTime = (epochMs: number): string =>
  DateTime.formatIntl(timeFormat)(DateTime.makeUnsafe(epochMs));
