#pragma once

#include "duckdb/main/http/http_util.hpp"

namespace duckdb {

// Browser-style transport provider. httpfs wraps it in its own util, which keeps httpfs settings,
// secrets and retries; this class only replaces the transport.
class HTTPWasmUtil : public HTTPUtil {
public:
    unique_ptr<HTTPClient> InitializeClient(HTTPParams &http_params, const string &proto_host_port) override;

    string GetName() const override;
};

// Factory function to create the WASM HTTP utility
shared_ptr<HTTPUtil> CreateWasmHTTPUtil();

} // namespace duckdb
