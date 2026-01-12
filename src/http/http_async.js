// HTTP async functions for Cloudflare Workers
// This file is included via --js-library in the Emscripten build

mergeInto(LibraryManager.library, {
    // Async HEAD request using fetch()
    // Using Asyncify.handleAsync for explicit async handling in CF Workers
    em_async_head_request: function(url_ptr, header_count, header_array) {
        var url = UTF8ToString(url_ptr);

        console.log("em_async_head_request called for:", url);

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

        console.log("Fetching HEAD", url, "with headers:", JSON.stringify(headers));

        return Asyncify.handleAsync(function() {
            return fetch(url, {
                method: "HEAD",
                headers: headers
            }).then(function(response) {
                console.log("HEAD response received, status:", response.status, response.statusText);

                if (!response.ok) {
                    console.error("HEAD error:", response.status, response.statusText);
                    return 0;
                }

                // Build response headers string
                var responseHeaders = "";
                response.headers.forEach(function(value, name) {
                    responseHeaders += name + ": " + value + "\r\n";
                });
                console.log("Response headers length:", responseHeaders.length);

                // Copy to WASM memory
                var headerBytes = new TextEncoder().encode(responseHeaders);
                var len = headerBytes.length;
                var resultPtr = _malloc(len + 4);

                // Store length (little-endian)
                HEAPU8[resultPtr] = len & 0xFF;
                HEAPU8[resultPtr + 1] = (len >> 8) & 0xFF;
                HEAPU8[resultPtr + 2] = (len >> 16) & 0xFF;
                HEAPU8[resultPtr + 3] = (len >> 24) & 0xFF;

                // Copy header data
                HEAPU8.set(headerBytes, resultPtr + 4);

                console.log("em_async_head_request returning ptr:", resultPtr);
                return resultPtr;
            }).catch(function(error) {
                console.error("Fetch HEAD error:", error.name, error.message, error.stack);
                return 0;
            });
        });
    },

    // Async general request using fetch()
    // Using Asyncify.handleAsync for explicit async handling in CF Workers
    em_async_request: function(url_ptr, method_ptr, header_count, header_array, body_ptr, body_len) {
        var url = UTF8ToString(url_ptr);
        var method = UTF8ToString(method_ptr);

        console.log("em_async_request called:", method, url);

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

        // Prepare fetch options
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

        console.log("Fetching", method, url);

        return Asyncify.handleAsync(function() {
            return fetch(url, fetchOptions).then(function(response) {
                console.log("Response status:", response.status);

                if (!response.ok && method !== "HEAD") {
                    console.error("Request error:", response.status, response.statusText);
                    return 0;
                }

                // Get response body
                return response.arrayBuffer().then(function(responseBody) {
                    var bodyBytes = new Uint8Array(responseBody);
                    var len = bodyBytes.length;

                    console.log("Response body length:", len);

                    // Allocate memory: 4 bytes for length + body
                    var resultPtr = _malloc(len + 4);

                    // Store length (little-endian)
                    HEAPU8[resultPtr] = len & 0xFF;
                    HEAPU8[resultPtr + 1] = (len >> 8) & 0xFF;
                    HEAPU8[resultPtr + 2] = (len >> 16) & 0xFF;
                    HEAPU8[resultPtr + 3] = (len >> 24) & 0xFF;

                    // Copy body data
                    HEAPU8.set(bodyBytes, resultPtr + 4);

                    console.log("em_async_request returning ptr:", resultPtr);
                    return resultPtr;
                });
            }).catch(function(error) {
                console.error("Fetch error:", error.name, error.message, error.stack);
                return 0;
            });
        });
    },

    // Check if we're in a browser environment (has XMLHttpRequest)
    em_has_xhr: function() {
        return (typeof XMLHttpRequest !== "undefined") ? 1 : 0;
    }
});
