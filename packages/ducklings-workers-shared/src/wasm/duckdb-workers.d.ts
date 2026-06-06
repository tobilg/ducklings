// Type declarations for Emscripten-generated DuckDB module (workers build with Asyncify)
declare const DuckDBModule: (config?: Record<string, unknown>) => Promise<EmscriptenModule>;

interface EmscriptenModule {
  ccall: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
    opts?: { async?: boolean }
  ) => unknown | Promise<unknown>;
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[]
  ) => (...args: unknown[]) => unknown;
  getValue: (ptr: number, type: string) => number;
  setValue: (ptr: number, value: number, type: string) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, outPtr: number, maxBytesToWrite: number) => void;
  lengthBytesUTF8: (str: string) => number;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  stackAlloc: (size: number) => number;
  stackSave: () => number;
  stackRestore: (ptr: number) => void;
  HEAPU8: Uint8Array;
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
}

export default DuckDBModule;
