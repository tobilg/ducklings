/**
 * Vitest setup file for browser package tests.
 * Configures web-worker polyfill.
 */
import { defineWebWorkers } from '@vitest/web-worker/pure';

// Enable web worker support in Node.js
defineWebWorkers({ clone: 'none' });
