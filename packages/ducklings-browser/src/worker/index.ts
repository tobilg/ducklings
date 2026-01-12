/**
 * DuckDB Worker Entry Point
 *
 * This file is the entry point for the Web Worker.
 * It sets up the DuckDBDispatcher and handles messages from the main thread.
 *
 * @packageDocumentation
 */

import { DuckDBDispatcher } from './dispatcher.js';

// Create the dispatcher instance
const dispatcher = new DuckDBDispatcher();

// Set up message handler
self.onmessage = (event: MessageEvent) => {
  dispatcher.onMessage(event);
};

// Signal that the worker is ready
self.postMessage({ type: 'WORKER_READY' });
