#pragma once

#include "httpfs_client.hpp"

namespace duckdb {

// Keep httpfs settings and scoped secret lookup; replace only the transport.
class HTTPWasmUtil : public HTTPFSUtil {
public:
    unique_ptr<HTTPClient> InitializeClient(HTTPParams &http_params, const string &proto_host_port) override;

    string GetName() const override;
};

// Factory function to create the WASM HTTP utility
shared_ptr<HTTPUtil> CreateWasmHTTPUtil();

} // namespace duckdb
