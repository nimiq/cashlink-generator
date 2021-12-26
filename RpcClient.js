const http = require('http');
const { BufferUtils } = require('@nimiq/core');

class RpcClient {
    constructor(host, port) {
        this._host = host;
        this._port = port;
    }

    async isConnected() {
        try {
            return !!await this.getBlockHeight();
        } catch (e) {
            return false;
        }
    }

    async getBlockHeight() {
        return this._jsonRpcFetch('blockNumber');
    }

    async getBalance(address) {
        return this._jsonRpcFetch('getBalance', address.toUserFriendlyAddress());
    }

    async getMempoolTransactions(includeTransactions = false) {
        return this._jsonRpcFetch('mempoolContent', includeTransactions);
    }

    async getTransactionReceipt(txHash) {
        return this._jsonRpcFetch('getTransactionReceipt', txHash);
    }

    async getTransactionsByAddress(address) {
        return this._jsonRpcFetch('getTransactionsByAddress', address.toUserFriendlyAddress());
    }

    async sendTransaction(transaction) {
        return this._jsonRpcFetch('sendRawTransaction', BufferUtils.toHex(transaction.serialize()));
    }

    // from JsonRpcServer in core
    async _jsonRpcFetch(method, ...params) {
        return new Promise((resolve, fail) => {
            while (params.length > 0 && typeof params[params.length - 1] === 'undefined') params.pop();
            const jsonrpc = JSON.stringify({
                jsonrpc: '2.0',
                id: 42,
                method: method,
                params: params
            });
            const headers = {'Content-Length': jsonrpc.length};
            const req = http.request({
                hostname: this._host,
                port: this._port,
                method: 'POST',
                headers: headers
            }, (res) => {
                if (res.statusCode === 401) {
                    fail(new Error(`Request Failed: Authentication Required. Status Code: ${res.statusCode}`));
                    res.resume();
                    return;
                }
                if (res.statusCode !== 200) {
                    fail(new Error(`Request Failed. ${res.statusMessage? `${res.statusMessage} - `
                        : ''}Status Code: ${res.statusCode}`));
                    res.resume();
                    return;
                }

                res.setEncoding('utf8');
                let rawData = '';
                res.on('error', fail);
                res.on('data', (chunk) => { rawData += chunk; });
                res.on('end', () => {
                    try {
                        const parse = JSON.parse(rawData);
                        if (parse.error) {
                            fail(parse.error.message);
                        } else {
                            resolve(parse.result);
                        }
                    } catch (e) {
                        fail(e);
                    }
                });
            });
            req.on('error', fail);
            req.write(jsonrpc);
            req.end();
        });
    }
}

module.exports = RpcClient;
