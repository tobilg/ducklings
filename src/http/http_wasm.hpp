#pragma once

#include "httpfs_client.hpp"

namespace duckdb {

// WASM HTTP utility that uses XMLHttpRequest via Emscripten
class HTTPWasmUtil : public HTTPUtil {
public:
    unique_ptr<HTTPParams> InitializeParameters(optional_ptr<FileOpener> opener,
                                                optional_ptr<FileOpenerInfo> info) override {
        auto result = make_uniq<HTTPFSParams>(*this);
        result->Initialize(opener);
        return result;
    }

    unique_ptr<HTTPClient> InitializeClient(HTTPParams &http_params, const string &proto_host_port) override;

    string GetName() const override;
};

// Factory function to create the WASM HTTP utility
shared_ptr<HTTPUtil> CreateWasmHTTPUtil();

} // namespace duckdb
