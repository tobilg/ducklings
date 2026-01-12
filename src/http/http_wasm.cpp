#include "http_wasm.hpp"

#include <emscripten.h>
#include <cstring>

namespace duckdb {

// ============================================================================
// External JavaScript functions (defined in http_async.js)
// These are provided via --js-library in the build
// ============================================================================

extern "C" {
    // Async HEAD request using fetch() - for Cloudflare Workers
    extern char* em_async_head_request(const char* url_ptr, int header_count, char** header_array);

    // Async general request using fetch() - for Cloudflare Workers
    extern char* em_async_request(const char* url_ptr, const char* method_ptr, int header_count, char** header_array, const char* body_ptr, int body_len);

    // Check if XMLHttpRequest is available (browser vs workers)
    extern int em_has_xhr();
}

// ============================================================================
// Synchronous JavaScript functions using EM_ASM_PTR (for browsers)
// ============================================================================

// Sync HEAD request using XMLHttpRequest - works in browsers
static char* em_sync_head_request(const char* url, int header_count, char** header_array) {
    return (char*)EM_ASM_PTR({
        var url = UTF8ToString($0);
        var headerCount = $1;
        var headerArray = $2;

        if (typeof XMLHttpRequest === "undefined") {
            return 0;
        }

        var xhr = new XMLHttpRequest();
        xhr.open("HEAD", url, false);

        // Set headers
        for (var i = 0; i < headerCount * 2; i += 2) {
            var ptr1 = HEAP32[(headerArray >> 2) + i];
            var ptr2 = HEAP32[(headerArray >> 2) + i + 1];
            try {
                var headerName = UTF8ToString(ptr1);
                var headerValue = UTF8ToString(ptr2);
                if (headerName === "Host") headerName = "X-Host-Override";
                if (headerName === "User-Agent") headerName = "X-User-Agent";
                xhr.setRequestHeader(headerName, headerValue);
            } catch (error) {
                console.warn("Error setting header:", error);
            }
        }

        try {
            xhr.send(null);
        } catch (error) {
            console.error("XHR HEAD error:", error);
            return 0;
        }

        if (xhr.status === 0 || xhr.status >= 400) {
            console.error("HEAD error:", xhr.status, xhr.statusText);
            return 0;
        }

        var responseHeaders = xhr.getAllResponseHeaders();
        var headerBytes = new TextEncoder().encode(responseHeaders);
        var len = headerBytes.length;
        var resultPtr = _malloc(len + 4);

        Module.HEAPU8[resultPtr] = len & 0xFF;
        Module.HEAPU8[resultPtr + 1] = (len >> 8) & 0xFF;
        Module.HEAPU8[resultPtr + 2] = (len >> 16) & 0xFF;
        Module.HEAPU8[resultPtr + 3] = (len >> 24) & 0xFF;
        Module.HEAPU8.set(headerBytes, resultPtr + 4);

        return resultPtr;
    }, url, header_count, header_array);
}

// Sync general request using XMLHttpRequest - works in browsers
static char* em_sync_request(const char* url, const char* method, int header_count, char** header_array, const char* body, int body_len) {
    return (char*)EM_ASM_PTR({
        var url = UTF8ToString($0);
        var method = UTF8ToString($1);
        var headerCount = $2;
        var headerArray = $3;
        var bodyPtr = $4;
        var bodyLen = $5;

        if (typeof XMLHttpRequest === "undefined") {
            return 0;
        }

        var xhr = new XMLHttpRequest();
        xhr.open(method, url, false);
        xhr.responseType = "arraybuffer";

        // Set headers
        for (var i = 0; i < headerCount * 2; i += 2) {
            var ptr1 = HEAP32[(headerArray >> 2) + i];
            var ptr2 = HEAP32[(headerArray >> 2) + i + 1];
            try {
                var headerName = UTF8ToString(ptr1);
                var headerValue = UTF8ToString(ptr2);
                if (headerName === "Host") headerName = "X-Host-Override";
                if (headerName === "User-Agent") headerName = "X-User-Agent";
                xhr.setRequestHeader(headerName, headerValue);
            } catch (error) {
                console.warn("Error setting header:", error);
            }
        }

        try {
            if (bodyPtr && bodyLen > 0) {
                var bodyData = new Uint8Array(bodyLen);
                for (var i = 0; i < bodyLen; i++) {
                    bodyData[i] = Module.HEAPU8[bodyPtr + i];
                }
                xhr.send(bodyData);
            } else {
                xhr.send(null);
            }
        } catch (error) {
            console.error("XHR error:", error);
            return 0;
        }

        if (xhr.status === 0 || xhr.status >= 400) {
            console.error("Request error:", xhr.status, xhr.statusText);
            return 0;
        }

        var responseBody = new Uint8Array(xhr.response);
        var len = responseBody.length;
        var resultPtr = _malloc(len + 4);

        Module.HEAPU8[resultPtr] = len & 0xFF;
        Module.HEAPU8[resultPtr + 1] = (len >> 8) & 0xFF;
        Module.HEAPU8[resultPtr + 2] = (len >> 16) & 0xFF;
        Module.HEAPU8[resultPtr + 3] = (len >> 24) & 0xFF;
        Module.HEAPU8.set(responseBody, resultPtr + 4);

        return resultPtr;
    }, url, method, header_count, header_array, body, body_len);
}

// ============================================================================
// HTTP Client implementation
// ============================================================================

class HTTPWasmClient : public HTTPClient {
public:
    HTTPWasmClient(HTTPFSParams &http_params, const string &proto_host_port) {
        host_port = proto_host_port;
        // Check once at construction if we have XHR available
        use_sync_xhr = (em_has_xhr() == 1);
        if (use_sync_xhr) {
            printf("HTTPWasmClient: Using synchronous XMLHttpRequest (browser mode)\n");
        } else {
            printf("HTTPWasmClient: Using async fetch with Asyncify (workers mode)\n");
        }
    }

    void Initialize(HTTPParams &params) override {}

    string host_port;
    bool use_sync_xhr;

    unique_ptr<HTTPResponse> Get(GetRequestInfo &info) override {
        return DoRequest("GET", info.url, info.headers, nullptr, 0, info.content_handler);
    }

    unique_ptr<HTTPResponse> Head(HeadRequestInfo &info) override {
        return DoHeadRequest(info.url, info.headers);
    }

    unique_ptr<HTTPResponse> Post(PostRequestInfo &info) override {
        auto result = DoRequest("POST", info.url, info.headers, info.buffer_in, info.buffer_in_len, nullptr);
        if (result && result->status == HTTPStatusCode::OK_200) {
            info.buffer_out += result->body;
        }
        return result;
    }

    unique_ptr<HTTPResponse> Put(PutRequestInfo &info) override {
        return DoRequest("PUT", info.url, info.headers, info.buffer_in, info.buffer_in_len, nullptr);
    }

    unique_ptr<HTTPResponse> Delete(DeleteRequestInfo &info) override {
        return DoRequest("DELETE", info.url, info.headers, nullptr, 0, nullptr);
    }

private:
    string NormalizeUrl(const string &url) {
        string path = url;
        if (path[0] == '/') {
            path = host_port + url;
        }
        if ((path.rfind("https://", 0) != 0) && (path.rfind("http://", 0) != 0)) {
            path = "https://" + path;
        }
        return path;
    }

    char** PrepareHeaders(const HTTPHeaders &headers, int &count) {
        count = 0;
        for (auto &h : headers) {
            count++;
        }

        char **z = (char **)(void *)malloc(count * sizeof(char*) * 2);

        int i = 0;
        for (auto &h : headers) {
            z[i] = (char *)malloc(h.first.size() + 1);
            memset(z[i], 0, h.first.size() + 1);
            memcpy(z[i], h.first.c_str(), h.first.size());
            i++;
            z[i] = (char *)malloc(h.second.size() + 1);
            memset(z[i], 0, h.second.size() + 1);
            memcpy(z[i], h.second.c_str(), h.second.size());
            i++;
        }
        return z;
    }

    void FreeHeaders(char **z, int count) {
        for (int i = 0; i < count * 2; i++) {
            free(z[i]);
        }
        free(z);
    }

    unique_ptr<HTTPResponse> DoRequest(const char *method, const string &url,
                                        const HTTPHeaders &headers,
                                        const_data_ptr_t body_data, idx_t body_len,
                                        std::function<void(const_data_ptr_t, idx_t)> content_handler) {
        unique_ptr<HTTPResponse> res;
        string path = NormalizeUrl(url);

        int header_count = 0;
        char **header_array = PrepareHeaders(headers, header_count);

        char *payload = nullptr;
        if (body_data && body_len > 0) {
            payload = (char *)malloc(body_len);
            memcpy(payload, body_data, body_len);
        }

        char *result = nullptr;

        if (use_sync_xhr) {
            // Browser mode: use synchronous XMLHttpRequest
            result = em_sync_request(path.c_str(), method, header_count, header_array, payload, (int)body_len);
        } else {
            // Workers mode: use async fetch via external JS library
            result = em_async_request(path.c_str(), method, header_count, header_array, payload, (int)body_len);
        }

        FreeHeaders(header_array, header_count);
        if (payload) free(payload);

        if (!result) {
            res = make_uniq<HTTPResponse>(HTTPStatusCode::NotFound_404);
            res->reason = "Request failed - check console for errors";
        } else {
            res = make_uniq<HTTPResponse>(HTTPStatusCode::OK_200);

            // Read length from first 4 bytes
            uint32_t len = 0;
            len |= ((uint8_t *)result)[0];
            len |= ((uint8_t *)result)[1] << 8;
            len |= ((uint8_t *)result)[2] << 16;
            len |= ((uint8_t *)result)[3] << 24;

            res->body = string(result + 4, len);

            if (content_handler) {
                content_handler((const_data_ptr_t)(result + 4), len);
            }

            free(result);
        }

        return res;
    }

    unique_ptr<HTTPResponse> DoHeadRequest(const string &url, const HTTPHeaders &headers) {
        unique_ptr<HTTPResponse> res;
        string path = NormalizeUrl(url);

        int header_count = 0;
        char **header_array = PrepareHeaders(headers, header_count);

        char *result = nullptr;

        if (use_sync_xhr) {
            // Browser mode: use synchronous XMLHttpRequest
            result = em_sync_head_request(path.c_str(), header_count, header_array);
        } else {
            // Workers mode: use async fetch via external JS library
            result = em_async_head_request(path.c_str(), header_count, header_array);
        }

        FreeHeaders(header_array, header_count);

        if (!result) {
            res = make_uniq<HTTPResponse>(HTTPStatusCode::NotFound_404);
            res->reason = "HEAD request failed";
        } else {
            res = make_uniq<HTTPResponse>(HTTPStatusCode::OK_200);

            // Read length
            uint32_t len = 0;
            len |= ((uint8_t *)result)[0];
            len |= ((uint8_t *)result)[1] << 8;
            len |= ((uint8_t *)result)[2] << 16;
            len |= ((uint8_t *)result)[3] << 24;

            // Parse response headers
            string headers_str(result + 4, len);
            vector<string> header_lines = StringUtil::Split(headers_str, "\r\n");

            for (auto &line : header_lines) {
                size_t colon_pos = line.find(':');
                if (colon_pos != string::npos) {
                    string name = line.substr(0, colon_pos);
                    string value = line.substr(colon_pos + 1);
                    // Trim leading space from value
                    while (!value.empty() && value[0] == ' ') {
                        value = value.substr(1);
                    }
                    res->headers.Insert(name, value);
                }
            }

            free(result);
        }

        return res;
    }
};

unique_ptr<HTTPClient> HTTPWasmUtil::InitializeClient(HTTPParams &http_params, const string &proto_host_port) {
    auto client = make_uniq<HTTPWasmClient>(http_params.Cast<HTTPFSParams>(), proto_host_port);
    return std::move(client);
}

string HTTPWasmUtil::GetName() const {
    return "WasmHTTPUtils";  // Must match what httpfs_extension.cpp checks for
}

// Factory function to create the WASM HTTP utility
shared_ptr<HTTPUtil> CreateWasmHTTPUtil() {
    return make_shared_ptr<HTTPWasmUtil>();
}

} // namespace duckdb
