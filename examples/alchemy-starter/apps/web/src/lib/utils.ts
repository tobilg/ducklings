import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The one class-name merger: conditional classes plus Tailwind conflict
 *  resolution, the same shape shadcn generates. */
export const cn = (...inputs: ClassValue[]): string =>
  twMerge(clsx(inputs));
