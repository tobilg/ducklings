/**
 * Package version constants
 *
 * These are injected at build time via tsup's define option.
 *
 * @packageDocumentation
 */

declare const __PACKAGE_NAME__: string;
declare const __PACKAGE_VERSION__: string;

/** Package name for CDN URL generation */
export const PACKAGE_NAME =
  typeof __PACKAGE_NAME__ !== 'undefined' ? __PACKAGE_NAME__ : '@ducklings/browser';

/** Package version for CDN URL generation */
export const PACKAGE_VERSION =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : '1.4.3';
