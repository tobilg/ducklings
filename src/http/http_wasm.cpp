#include "http_wasm.hpp"

#include "duckdb/common/string_util.hpp"

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

static uint32_t ReadPacketU32(const char *packet, idx_t offset) {
    const auto *bytes = reinterpret_cast<const uint8_t *>(packet + offset);
    uint32_t value = 0;
    value |= bytes[0];
    value |= bytes[1] << 8;
    value |= bytes[2] << 16;
    value |= bytes[3] << 24;
    return value;
}

static void ParseResponseHeaders(const string &headers_str, HTTPHeaders &headers_out) {
    vector<string> header_lines = StringUtil::Split(headers_str, "\r\n");
    for (auto &line : header_lines) {
        size_t colon_pos = line.find(':');
        if (colon_pos == string::npos) {
            continue;
        }
        string name = line.substr(0, colon_pos);
        string value = line.substr(colon_pos + 1);
        while (!value.empty() && value[0] == ' ') {
            value = value.substr(1);
        }
        headers_out.Insert(name, value);
    }
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

        function buildPacket(status, headerBytes, bodyBytes) {
            var headerLen = headerBytes.length;
            var bodyLen = bodyBytes.length;
            var resultPtr = _malloc(12 + headerLen + bodyLen);

            Module.HEAPU8[resultPtr] = status & 0xFF;
            Module.HEAPU8[resultPtr + 1] = (status >> 8) & 0xFF;
            Module.HEAPU8[resultPtr + 2] = (status >> 16) & 0xFF;
            Module.HEAPU8[resultPtr + 3] = (status >> 24) & 0xFF;

            Module.HEAPU8[resultPtr + 4] = headerLen & 0xFF;
            Module.HEAPU8[resultPtr + 5] = (headerLen >> 8) & 0xFF;
            Module.HEAPU8[resultPtr + 6] = (headerLen >> 16) & 0xFF;
            Module.HEAPU8[resultPtr + 7] = (headerLen >> 24) & 0xFF;

            Module.HEAPU8[resultPtr + 8] = bodyLen & 0xFF;
            Module.HEAPU8[resultPtr + 9] = (bodyLen >> 8) & 0xFF;
            Module.HEAPU8[resultPtr + 10] = (bodyLen >> 16) & 0xFF;
            Module.HEAPU8[resultPtr + 11] = (bodyLen >> 24) & 0xFF;

            Module.HEAPU8.set(headerBytes, resultPtr + 12);
            Module.HEAPU8.set(bodyBytes, resultPtr + 12 + headerLen);
            return resultPtr;
        }

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
                // Browsers set User-Agent themselves; renaming it to a custom header would force a CORS preflight
                // that static hosts such as raw.githubusercontent.com reject.
                if (headerName === "User-Agent") continue;
                xhr.setRequestHeader(headerName, headerValue);
            } catch (error) {
                console.warn("Error setting header:", error);
            }
        }

        try {
            xhr.send(null);
        } catch (error) {
            console.error("XHR HEAD error:", error);
            var errorBytes = new TextEncoder().encode(error && error.message ? error.message : "HEAD request failed");
            return buildPacket(0, new Uint8Array(0), errorBytes);
        }

        var responseHeaders = xhr.getAllResponseHeaders();
        var headerBytes = new TextEncoder().encode(responseHeaders);
        var errorBytes = new Uint8Array(0);

        if (xhr.status === 0) {
            errorBytes = new TextEncoder().encode(xhr.statusText || "HEAD request failed");
            return buildPacket(0, new Uint8Array(0), errorBytes);
        }

        return buildPacket(xhr.status, headerBytes, errorBytes);
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

        function buildPacket(status, headerBytes, bodyBytes) {
            var headerLen = headerBytes.length;
            var bodyLen = bodyBytes.length;
            var resultPtr = _malloc(12 + headerLen + bodyLen);

            Module.HEAPU8[resultPtr] = status & 0xFF;
            Module.HEAPU8[resultPtr + 1] = (status >> 8) & 0xFF;
            Module.HEAPU8[resultPtr + 2] = (status >> 16) & 0xFF;
            Module.HEAPU8[resultPtr + 3] = (status >> 24) & 0xFF;

            Module.HEAPU8[resultPtr + 4] = headerLen & 0xFF;
            Module.HEAPU8[resultPtr + 5] = (headerLen >> 8) & 0xFF;
            Module.HEAPU8[resultPtr + 6] = (headerLen >> 16) & 0xFF;
            Module.HEAPU8[resultPtr + 7] = (headerLen >> 24) & 0xFF;

            Module.HEAPU8[resultPtr + 8] = bodyLen & 0xFF;
            Module.HEAPU8[resultPtr + 9] = (bodyLen >> 8) & 0xFF;
            Module.HEAPU8[resultPtr + 10] = (bodyLen >> 16) & 0xFF;
            Module.HEAPU8[resultPtr + 11] = (bodyLen >> 24) & 0xFF;

            Module.HEAPU8.set(headerBytes, resultPtr + 12);
            Module.HEAPU8.set(bodyBytes, resultPtr + 12 + headerLen);
            return resultPtr;
        }

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
                // Browsers set User-Agent themselves; renaming it to a custom header would force a CORS preflight
                // that static hosts such as raw.githubusercontent.com reject.
                if (headerName === "User-Agent") continue;
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
            var errorBytes = new TextEncoder().encode(error && error.message ? error.message : "Request failed");
            return buildPacket(0, new Uint8Array(0), errorBytes);
        }

        if (xhr.status === 0) {
            var requestErrorBytes = new TextEncoder().encode(xhr.statusText || "Request failed");
            return buildPacket(0, new Uint8Array(0), requestErrorBytes);
        }

        var responseHeaders = xhr.getAllResponseHeaders();
        var headerBytes = new TextEncoder().encode(responseHeaders);
        var responseBody = xhr.response ? new Uint8Array(xhr.response) : new Uint8Array(0);

        return buildPacket(xhr.status, headerBytes, responseBody);
    }, url, method, header_count, header_array, body, body_len);
}

// ============================================================================
// HTTP Client implementation
// ============================================================================

class HTTPWasmClient : public HTTPClient {
public:
    explicit HTTPWasmClient(const string &proto_host_port) : HTTPClient(proto_host_port) {
        host_port = proto_host_port;
        // Check once at construction if we have XHR available
        use_sync_xhr = (em_has_xhr() == 1);
    }

    void Initialize(HTTPParams &params) override {}

    string host_port;
    bool use_sync_xhr;

    unique_ptr<HTTPResponse> Get(GetRequestInfo &info) override {
        auto res = DoRequest("GET", info.url, BaseRequest::MergeHeaders(info.headers, info.params), nullptr, 0);
        info.bytes_received = res->body.size();
        // Same contract as httpfs's native client: error bodies stay on the response, a rejecting
        // response_handler stops the transfer, and content_handler receives the body instead of the response.
        if (res->status == HTTPStatusCode::INVALID || static_cast<int>(res->status) >= 400) {
            if (info.response_handler && res->status != HTTPStatusCode::INVALID) {
                info.response_handler(*res);
            }
            return res;
        }
        if (info.response_handler && !info.response_handler(*res)) {
            res->body.clear();
            return res;
        }
        if (info.content_handler) {
            string body = std::move(res->body);
            res->body.clear();
            info.content_handler(const_data_ptr_cast(body.data()), body.size());
        }
        return res;
    }

    unique_ptr<HTTPResponse> Head(HeadRequestInfo &info) override {
        return DoHeadRequest(info.url, BaseRequest::MergeHeaders(info.headers, info.params));
    }

    unique_ptr<HTTPResponse> Post(PostRequestInfo &info) override {
        auto result = DoRequest("POST", info.url, BaseRequest::MergeHeaders(info.headers, info.params),
                                info.buffer_in, info.buffer_in_len);
        if (result && result->status == HTTPStatusCode::OK_200) {
            info.buffer_out += result->body;
        }
        return result;
    }

    unique_ptr<HTTPResponse> Put(PutRequestInfo &info) override {
        auto headers = BaseRequest::MergeHeaders(info.headers, info.params);
        // S3 signs the content type, so it has to be sent even when the caller passed it separately.
        if (!info.content_type.empty() && !headers.HasHeader("Content-Type")) {
            headers.Insert("Content-Type", info.content_type);
        }
        return DoRequest("PUT", info.url, headers, info.buffer_in, info.buffer_in_len);
    }

    unique_ptr<HTTPResponse> Delete(DeleteRequestInfo &info) override {
        return DoRequest("DELETE", info.url, BaseRequest::MergeHeaders(info.headers, info.params), nullptr, 0);
    }

    unique_ptr<HTTPResponse> Options(OptionsRequestInfo &info) override {
        return DoRequest("OPTIONS", info.url, BaseRequest::MergeHeaders(info.headers, info.params), nullptr, 0);
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
                                        const_data_ptr_t body_data, idx_t body_len) {
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
            res = make_uniq<HTTPResponse>(HTTPStatusCode::INVALID);
            res->request_error = "Request failed - no response packet";
        } else {
            auto status_code = ReadPacketU32(result, 0);
            auto header_len = ReadPacketU32(result, 4);
            auto body_len = ReadPacketU32(result, 8);
            auto *header_ptr = result + 12;
            auto *body_ptr = header_ptr + header_len;

            if (status_code == 0) {
                res = make_uniq<HTTPResponse>(HTTPStatusCode::INVALID);
                res->request_error = string(body_ptr, body_len);
            } else {
                auto status = HTTPUtil::ToStatusCode(static_cast<int32_t>(status_code));
                res = make_uniq<HTTPResponse>(status);
                res->reason = HTTPUtil::GetStatusMessage(status);
                if (header_len > 0) {
                    ParseResponseHeaders(string(header_ptr, header_len), res->headers);
                }
                res->body = string(body_ptr, body_len);
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
            res = make_uniq<HTTPResponse>(HTTPStatusCode::INVALID);
            res->request_error = "HEAD request failed - no response packet";
        } else {
            auto status_code = ReadPacketU32(result, 0);
            auto header_len = ReadPacketU32(result, 4);
            auto body_len = ReadPacketU32(result, 8);
            auto *header_ptr = result + 12;
            auto *body_ptr = header_ptr + header_len;

            if (status_code == 0) {
                res = make_uniq<HTTPResponse>(HTTPStatusCode::INVALID);
                res->request_error = string(body_ptr, body_len);
            } else {
                auto status = HTTPUtil::ToStatusCode(static_cast<int32_t>(status_code));
                res = make_uniq<HTTPResponse>(status);
                res->reason = HTTPUtil::GetStatusMessage(status);
                if (header_len > 0) {
                    ParseResponseHeaders(string(header_ptr, header_len), res->headers);
                }
            }

            free(result);
        }

        return res;
    }
};

unique_ptr<HTTPClient> HTTPWasmUtil::InitializeClient(HTTPParams &http_params, const string &proto_host_port) {
    return make_uniq<HTTPWasmClient>(proto_host_port);
}

string HTTPWasmUtil::GetName() const {
    return "WasmHTTPUtils";  // httpfs wraps a provider with this name in its HTTPFS-Wasm util
}

// Factory function to create the WASM HTTP utility
shared_ptr<HTTPUtil> CreateWasmHTTPUtil() {
    return make_shared_ptr<HTTPWasmUtil>();
}

} // namespace duckdb
