// HTTP async functions for Cloudflare Workers
// This file is included via --js-library in the Emscripten build

mergeInto(LibraryManager.library, {
    // Async HEAD request using fetch()
    // Using Asyncify.handleAsync for explicit async handling in CF Workers
    em_async_head_request: function(url_ptr, header_count, header_array) {
        var url = UTF8ToString(url_ptr);

        // Parse headers from the header array (must be done synchronously before Asyncify)
        var headers = {};
        for (var i = 0; i < header_count * 2; i += 2) {
            var ptr1 = HEAP32[(header_array >> 2) + i];
            var ptr2 = HEAP32[(header_array >> 2) + i + 1];
            try {
                var headerName = UTF8ToString(ptr1);
                var headerValue = UTF8ToString(ptr2);
                // Skip problematic headers for CORS/fetch
                if (headerName === "Host" || headerName === "User-Agent") continue;
                headers[headerName] = headerValue;
            } catch (error) {
                console.warn("Error parsing header:", error);
            }
        }

        return Asyncify.handleAsync(function() {
            return fetch(url, {
                method: "HEAD",
                headers: headers
            }).then(function(response) {
                // Build response headers string
                var responseHeaders = "";
                response.headers.forEach(function(value, name) {
                    responseHeaders += name + ": " + value + "\r\n";
                });

                var headerBytes = new TextEncoder().encode(responseHeaders);
                var headerLen = headerBytes.length;
                var resultPtr = _malloc(12 + headerLen);

                // Packet layout:
                // [0..3]   status code
                // [4..7]   header length
                // [8..11]  body length (always 0 for HEAD)
                HEAPU8[resultPtr] = response.status & 0xFF;
                HEAPU8[resultPtr + 1] = (response.status >> 8) & 0xFF;
                HEAPU8[resultPtr + 2] = (response.status >> 16) & 0xFF;
                HEAPU8[resultPtr + 3] = (response.status >> 24) & 0xFF;

                HEAPU8[resultPtr + 4] = headerLen & 0xFF;
                HEAPU8[resultPtr + 5] = (headerLen >> 8) & 0xFF;
                HEAPU8[resultPtr + 6] = (headerLen >> 16) & 0xFF;
                HEAPU8[resultPtr + 7] = (headerLen >> 24) & 0xFF;

                HEAPU8[resultPtr + 8] = 0;
                HEAPU8[resultPtr + 9] = 0;
                HEAPU8[resultPtr + 10] = 0;
                HEAPU8[resultPtr + 11] = 0;

                HEAPU8.set(headerBytes, resultPtr + 12);

                return resultPtr;
            }).catch(function(error) {
                console.error("Fetch HEAD error:", error.name, error.message, error.stack);
                var errorBytes = new TextEncoder().encode(error && error.message ? error.message : "HEAD request failed");
                var resultPtr = _malloc(12 + errorBytes.length);

                // status = 0 signals a request-level error
                HEAPU8[resultPtr] = 0;
                HEAPU8[resultPtr + 1] = 0;
                HEAPU8[resultPtr + 2] = 0;
                HEAPU8[resultPtr + 3] = 0;

                HEAPU8[resultPtr + 4] = 0;
                HEAPU8[resultPtr + 5] = 0;
                HEAPU8[resultPtr + 6] = 0;
                HEAPU8[resultPtr + 7] = 0;

                HEAPU8[resultPtr + 8] = errorBytes.length & 0xFF;
                HEAPU8[resultPtr + 9] = (errorBytes.length >> 8) & 0xFF;
                HEAPU8[resultPtr + 10] = (errorBytes.length >> 16) & 0xFF;
                HEAPU8[resultPtr + 11] = (errorBytes.length >> 24) & 0xFF;
                HEAPU8.set(errorBytes, resultPtr + 12);

                return resultPtr;
            });
        });
    },

    // Async general request using fetch()
    // Using Asyncify.handleAsync for explicit async handling in CF Workers
    em_async_request: function(url_ptr, method_ptr, header_count, header_array, body_ptr, body_len) {
        var url = UTF8ToString(url_ptr);
        var method = UTF8ToString(method_ptr);

        // Parse headers (must be done synchronously before Asyncify)
        var headers = {};
        for (var i = 0; i < header_count * 2; i += 2) {
            var ptr1 = HEAP32[(header_array >> 2) + i];
            var ptr2 = HEAP32[(header_array >> 2) + i + 1];
            try {
                var headerName = UTF8ToString(ptr1);
                var headerValue = UTF8ToString(ptr2);
                if (headerName === "Host" || headerName === "User-Agent") continue;
                headers[headerName] = headerValue;
            } catch (error) {
                console.warn("Error parsing header:", error);
            }
        }

        // Prepare fetch options — use plain object for headers to preserve empty values
        // (the Headers API drops empty-string values, breaking S3 signature verification)
        var fetchOptions = {
            method: method,
            headers: headers
        };

        // Add body if present (must be done synchronously before Asyncify)
        if (body_ptr && body_len > 0) {
            var bodyData = new Uint8Array(body_len);
            for (var i = 0; i < body_len; i++) {
                bodyData[i] = HEAPU8[body_ptr + i];
            }
            fetchOptions.body = bodyData;
        }

        console.log(">>", method, url.substring(url.lastIndexOf('/') + 1));
        return Asyncify.handleAsync(function() {
            return fetch(url, fetchOptions).then(function(response) {
                return response.arrayBuffer().then(function(responseBody) {
                    if (method !== "GET" || !response.ok) {
                        console.log("<<", method, response.status, url.substring(url.lastIndexOf('/')));
                    }

                    var bodyBytes = new Uint8Array(responseBody);
                    var bodyLen = bodyBytes.length;
                    var responseHeaders = "";
                    response.headers.forEach(function(value, name) {
                        responseHeaders += name + ": " + value + "\r\n";
                    });
                    var headerBytes = new TextEncoder().encode(responseHeaders);
                    var headerLen = headerBytes.length;

                    if (!response.ok) {
                        var errBody = "";
                        try {
                            errBody = new TextDecoder().decode(bodyBytes.subarray(0, Math.min(bodyLen, 500)));
                        } catch (_error) {
                            errBody = "<non-text response body>";
                        }
                        console.error("HTTP error:", method, url.substring(url.lastIndexOf('/')), response.status, errBody);
                    }

                    // Packet layout:
                    // [0..3]   status code
                    // [4..7]   header length
                    // [8..11]  body length
                    // [12..]   header bytes, then body bytes
                    var resultPtr = _malloc(12 + headerLen + bodyLen);

                    HEAPU8[resultPtr] = response.status & 0xFF;
                    HEAPU8[resultPtr + 1] = (response.status >> 8) & 0xFF;
                    HEAPU8[resultPtr + 2] = (response.status >> 16) & 0xFF;
                    HEAPU8[resultPtr + 3] = (response.status >> 24) & 0xFF;

                    HEAPU8[resultPtr + 4] = headerLen & 0xFF;
                    HEAPU8[resultPtr + 5] = (headerLen >> 8) & 0xFF;
                    HEAPU8[resultPtr + 6] = (headerLen >> 16) & 0xFF;
                    HEAPU8[resultPtr + 7] = (headerLen >> 24) & 0xFF;

                    HEAPU8[resultPtr + 8] = bodyLen & 0xFF;
                    HEAPU8[resultPtr + 9] = (bodyLen >> 8) & 0xFF;
                    HEAPU8[resultPtr + 10] = (bodyLen >> 16) & 0xFF;
                    HEAPU8[resultPtr + 11] = (bodyLen >> 24) & 0xFF;

                    HEAPU8.set(headerBytes, resultPtr + 12);
                    HEAPU8.set(bodyBytes, resultPtr + 12 + headerLen);

                    return resultPtr;
                });
            }).catch(function(error) {
                console.error("Fetch error:", error.name, error.message, error.stack);
                var errorBytes = new TextEncoder().encode(error && error.message ? error.message : "Request failed");
                var bodyLen = errorBytes.length;
                var resultPtr = _malloc(12 + bodyLen);

                // status = 0 signals a request-level error so DuckDB retries
                HEAPU8[resultPtr] = 0;
                HEAPU8[resultPtr + 1] = 0;
                HEAPU8[resultPtr + 2] = 0;
                HEAPU8[resultPtr + 3] = 0;

                HEAPU8[resultPtr + 4] = 0;
                HEAPU8[resultPtr + 5] = 0;
                HEAPU8[resultPtr + 6] = 0;
                HEAPU8[resultPtr + 7] = 0;

                HEAPU8[resultPtr + 8] = bodyLen & 0xFF;
                HEAPU8[resultPtr + 9] = (bodyLen >> 8) & 0xFF;
                HEAPU8[resultPtr + 10] = (bodyLen >> 16) & 0xFF;
                HEAPU8[resultPtr + 11] = (bodyLen >> 24) & 0xFF;
                HEAPU8.set(errorBytes, resultPtr + 12);

                return resultPtr;
            });
        });
    },

    // Check if we're in a browser environment (has XMLHttpRequest)
    em_has_xhr: function() {
        return (typeof XMLHttpRequest !== "undefined") ? 1 : 0;
    },

    // Debug: called when Asyncify detects an unreachable instruction
    em_asyncify_stop_unwind: function() {
        console.error("Asyncify: stop_unwind called, state:", Asyncify.state);
        var err = new Error();
        console.error("JS stack:", err.stack);
    }
});
