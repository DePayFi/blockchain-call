(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('ethers'), require('@depay/web3-blockchains')) :
  typeof define === 'function' && define.amd ? define(['exports', 'ethers', '@depay/web3-blockchains'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Web3Client = {}, global.ethers, global.Web3Blockchains));
})(this, (function (exports, ethers, Blockchains) { 'use strict';

  function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

  var Blockchains__default = /*#__PURE__*/_interopDefaultLegacy(Blockchains);

  const getContractArguments = ({ contract, method, params })=>{
    let fragment = contract.interface.fragments.find((fragment) => {
      return fragment.name == method
    });

    if(params instanceof Array) {
      return params
    } else if (params instanceof Object) {
      return fragment.inputs.map((input) => {
        return params[input.name]
      })
    }
  };

  var estimateEVM = ({ provider, from, to, value, method, api, params }) => {
    if(typeof api == "undefined"){
      return provider.estimateGas({ from, to, value })
    } else {
      let contract = new ethers.ethers.Contract(to, api, provider);
      let contractMethod = contract.estimateGas[method];
      let contractArguments = getContractArguments({ contract, method, params });
      if(contractArguments) {
        return contractMethod(...contractArguments, { from, value })
      } else {
        return contractMethod({ from, value })
      }
    }
  };

  const BATCH_INTERVAL = 10;
  const CHUNK_SIZE = 99;

  class StaticJsonRpcBatchProvider extends ethers.ethers.providers.JsonRpcProvider {

    constructor(url, network, endpoints, failover) {
      super(url);
      this._network = network;
      this._endpoint = url;
      this._endpoints = endpoints;
      this._failover = failover;
    }

    detectNetwork() {
      return Promise.resolve(Blockchains__default["default"].findByName(this._network).id)
    }

    requestChunk(chunk, endpoint) {
      
      const request = chunk.map((inflight) => inflight.request);

      return ethers.ethers.utils.fetchJson(endpoint, JSON.stringify(request))
        .then((result) => {
          // For each result, feed it to the correct Promise, depending
          // on whether it was a success or error
          chunk.forEach((inflightRequest, index) => {
            const payload = result[index];
            if (payload.error) {
              const error = new Error(payload.error.message);
              error.code = payload.error.code;
              error.data = payload.error.data;
              inflightRequest.reject(error);
            }
            else {
              inflightRequest.resolve(payload.result);
            }
          });
        }).catch((error) => {
          if(error && error.code == 'SERVER_ERROR') {
            const index = this._endpoints.indexOf(this._endpoint)+1;
            this._failover();
            this._endpoint = index >= this._endpoints.length ? this._endpoints[0] : this._endpoints[index];
            this.requestChunk(chunk, this._endpoint);
          } else {
            chunk.forEach((inflightRequest) => {
              inflightRequest.reject(error);
            });
          }
        })
    }
      
    send(method, params) {

      const request = {
        method: method,
        params: params,
        id: (this._nextId++),
        jsonrpc: "2.0"
      };

      if (this._pendingBatch == null) {
        this._pendingBatch = [];
      }

      const inflightRequest = { request, resolve: null, reject: null };

      const promise = new Promise((resolve, reject) => {
        inflightRequest.resolve = resolve;
        inflightRequest.reject = reject;
      });

      this._pendingBatch.push(inflightRequest);

      if (!this._pendingBatchAggregator) {
        // Schedule batch for next event loop + short duration
        this._pendingBatchAggregator = setTimeout(() => {
          // Get the current batch and clear it, so new requests
          // go into the next batch
          const batch = this._pendingBatch;
          this._pendingBatch = null;
          this._pendingBatchAggregator = null;
          // Prepare Chunks of CHUNK_SIZE
          const chunks = [];
          for (let i = 0; i < Math.ceil(batch.length / CHUNK_SIZE); i++) {
            chunks[i] = batch.slice(i*CHUNK_SIZE, (i+1)*CHUNK_SIZE);
          }
          chunks.forEach((chunk)=>{
            // Get the request as an array of requests
            chunk.map((inflight) => inflight.request);
            return this.requestChunk(chunk, this._endpoint)
          });
        }, BATCH_INTERVAL);
      }

      return promise
    }

  }

  let _window;

  let getWindow = () => {
    if(_window) { return _window }
    if (typeof global == 'object') {
      _window = global;
    } else {
      _window = window;
    }
    return _window
  };

  const getAllProviders = ()=> {
    if(getWindow()._Web3ClientProviders == undefined) {
      getWindow()._Web3ClientProviders = {};
    }
    return getWindow()._Web3ClientProviders
  };

  const setProvider$1 = (blockchain, provider)=> {
    if(getAllProviders()[blockchain] === undefined) { getAllProviders()[blockchain] = []; }
    const index = getAllProviders()[blockchain].indexOf(provider);
    if(index > -1) {
      getAllProviders()[blockchain].splice(index, 1);
    }
    getAllProviders()[blockchain].unshift(provider);
  };

  const setProviderEndpoints$1 = async (blockchain, endpoints, detectFastest = true)=> {
    
    getAllProviders()[blockchain] = endpoints.map((endpoint, index)=>
      new StaticJsonRpcBatchProvider(endpoint, blockchain, endpoints, ()=>{
        if(getAllProviders()[blockchain].length === 1) {
          setProviderEndpoints$1(blockchain, endpoints, detectFastest);
        } else {
          getAllProviders()[blockchain].splice(index, 1);
        }
      })
    );
    
    let provider;
    let window = getWindow();

    if(
      window.fetch == undefined ||
      (typeof process != 'undefined' && process['env'] && process['env']['NODE_ENV'] == 'test') ||
      (typeof window.cy != 'undefined') ||
      detectFastest === false
    ) {
      provider = getAllProviders()[blockchain][0];
    } else {
      
      let responseTimes = await Promise.all(endpoints.map((endpoint)=>{
        return new Promise(async (resolve)=>{
          let timeout = 900;
          let before = new Date().getTime();
          setTimeout(()=>resolve(timeout), timeout);
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ method: 'net_version', id: 1, jsonrpc: '2.0' })
          });
          if(!response.ok) { return resolve(999) }
          let after = new Date().getTime();
          resolve(after-before);
        })
      }));

      const fastestResponse = Math.min(...responseTimes);
      const fastestIndex = responseTimes.indexOf(fastestResponse);
      provider = getAllProviders()[blockchain][fastestIndex];
    }
    
    setProvider$1(blockchain, provider);
  };

  const getProvider$1 = async (blockchain)=> {

    let providers = getAllProviders();
    if(providers && providers[blockchain]){ return providers[blockchain][0] }
    
    let window = getWindow();
    if(window._Web3ClientGetProviderPromise && window._Web3ClientGetProviderPromise[blockchain]) { return await window._Web3ClientGetProviderPromise[blockchain] }

    if(!window._Web3ClientGetProviderPromise){ window._Web3ClientGetProviderPromise = {}; }
    window._Web3ClientGetProviderPromise[blockchain] = new Promise(async(resolve)=> {
      await setProviderEndpoints$1(blockchain, Blockchains__default["default"][blockchain].endpoints);
      resolve(getWindow()._Web3ClientProviders[blockchain][0]);
    });

    return await window._Web3ClientGetProviderPromise[blockchain]
  };

  const getProviders$1 = async(blockchain)=>{

    let providers = getAllProviders();
    if(providers && providers[blockchain]){ return providers[blockchain] }
    
    let window = getWindow();
    if(window._Web3ClientGetProvidersPromise && window._Web3ClientGetProvidersPromise[blockchain]) { return await window._Web3ClientGetProvidersPromise[blockchain] }

    if(!window._Web3ClientGetProvidersPromise){ window._Web3ClientGetProvidersPromise = {}; }
    window._Web3ClientGetProvidersPromise[blockchain] = new Promise(async(resolve)=> {
      await setProviderEndpoints$1(blockchain, Blockchains__default["default"][blockchain].endpoints);
      resolve(getWindow()._Web3ClientProviders[blockchain]);
    });

    return await window._Web3ClientGetProvidersPromise[blockchain]
  };

  var EVM = {
    getProvider: getProvider$1,
    getProviders: getProviders$1,
    setProviderEndpoints: setProviderEndpoints$1,
    setProvider: setProvider$1,
  };

  let supported = ['ethereum', 'bsc', 'polygon', 'fantom', 'velas'];
  supported.evm = ['ethereum', 'bsc', 'polygon', 'fantom', 'velas'];
  supported.solana = [];

  function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }
  let getCacheStore = () => {
    if (getWindow()._Web3ClientCacheStore == undefined) {
      resetCache();
    }
    return getWindow()._Web3ClientCacheStore
  };

  let getPromiseStore = () => {
    if (getWindow()._Web3ClientPromiseStore == undefined) {
      resetCache();
    }
    return getWindow()._Web3ClientPromiseStore
  };

  let resetCache = () => {
    getWindow()._Web3ClientCacheStore = {};
    getWindow()._Web3ClientPromiseStore = {};
    getWindow()._Web3ClientProviders = {};
    getWindow()._Web3ClientGetProviderPromise = undefined;
  };

  let set = function ({ key, value, expires }) {
    getCacheStore()[key] = {
      expiresAt: Date.now() + expires,
      value,
    };
  };

  let get = function ({ key, expires }) {
    let cachedEntry = getCacheStore()[key];
    if (_optionalChain([cachedEntry, 'optionalAccess', _ => _.expiresAt]) > Date.now()) {
      return cachedEntry.value
    }
  };

  let getPromise = function({ key }) {
    return getPromiseStore()[key]
  };

  let setPromise = function({ key, promise }) {
    getPromiseStore()[key] = promise;
    return promise
  };

  let deletePromise = function({ key }) {
    getPromiseStore()[key] = undefined; 
  };

  let cache = function ({ call, key, expires = 0 }) {
    return new Promise((resolve, reject)=>{
      let value;
      key = JSON.stringify(key);
      
      // get existing promise (of a previous pending request asking for the exact same thing)
      let existingPromise = getPromise({ key });
      if(existingPromise) { 
        return existingPromise
          .then(resolve)
          .catch(reject)
      }

      setPromise({ key, promise: new Promise((resolveQueue, rejectQueue)=>{
        if (expires === 0) {
          return call()
            .then((value)=>{
              resolve(value);
              resolveQueue(value);
            })
            .catch((error)=>{
              reject(error);
              rejectQueue(error);
            })
        }
        
        // get cached value
        value = get({ key, expires });
        if (value) {
          resolve(value);
          resolveQueue(value);
          return value
        }

        // set new cache value
        call()
          .then((value)=>{
            if (value) {
              set({ key, value, expires });
            }
            resolve(value);
            resolveQueue(value);
          })
          .catch((error)=>{
            reject(error);
            rejectQueue(error);
          });
        })
      }).then(()=>{
        deletePromise({ key });
      }).catch(()=>{
        deletePromise({ key });
      });
    })
  };

  const getProvider = async (blockchain)=>{

    if(supported.evm.includes(blockchain)) {


      return await EVM.getProvider(blockchain)


    } else if(supported.solana.includes(blockchain)) ; else {
      throw 'Unknown blockchain: ' + blockchain
    }
  };

  const getProviders = async (blockchain)=>{

    if(supported.evm.includes(blockchain)) {


      return await EVM.getProviders(blockchain)


    } else if(supported.solana.includes(blockchain)) ; else {
      throw 'Unknown blockchain: ' + blockchain
    }
  };

  const setProvider = (blockchain, provider)=>{

    resetCache();

    if(supported.evm.includes(blockchain)) {


      return EVM.setProvider(blockchain, provider)


    } else if(supported.solana.includes(blockchain)) ; else {
      throw 'Unknown blockchain: ' + blockchain
    }
  };

  const setProviderEndpoints = (blockchain, endpoints, detectFastest)=>{

    resetCache();

    if(supported.evm.includes(blockchain)) {


      return EVM.setProviderEndpoints(blockchain, endpoints, detectFastest)


    } else if(supported.solana.includes(blockchain)) ; else {
      throw 'Unknown blockchain: ' + blockchain
    }
  };

  let estimate = async function ({ blockchain, from, to, value, method, api, params, cache: cache$1 }) {
    if(!supported.includes(blockchain)) { throw 'Unknown blockchain: ' + blockchain }
    if(typeof value == 'undefined') { value = '0'; }

    const provider = await getProvider(blockchain);
    
    return await cache({
      expires: cache$1 || 0,
      key: [blockchain, from, to, value, method, params],
      call: async()=>estimateEVM({ provider, from, to, value, method, api, params })
    })
  };

  let paramsToContractArgs = ({ contract, method, params }) => {
    let fragment = contract.interface.fragments.find((fragment) => {
      return fragment.name == method
    });

    return fragment.inputs.map((input, index) => {
      if (Array.isArray(params)) {
        return params[index]
      } else {
        return params[input.name]
      }
    })
  };

  const contractCall = ({ address, api, method, params, provider, block }) => {
    let contract = new ethers.ethers.Contract(address, api, provider);
    let args = paramsToContractArgs({ contract, method, params });
    return contract[method](...args, { blockTag: block })
  };

  const balance = ({ address, provider }) => {
    return provider.getBalance(address)
  };

  const transactionCount = ({ address, provider }) => {
    return provider.getTransactionCount(address)
  };

  const singleRequest = ({ blockchain, address, api, method, params, block, provider }) =>{
    if (api) {
      return contractCall({ address, api, method, params, provider, block })
    } else if (method === 'latestBlockNumber') {
      return provider.getBlockNumber()
    } else if (method === 'balance') {
      return balance({ address, provider })
    } else if (method === 'transactionCount') {
      return transactionCount({ address, provider })
    }
  };

  var requestEVM = async ({ blockchain, address, api, method, params, block, timeout, strategy = 'fallback' }) => {

    if(strategy === 'fastest') {

      return Promise.race((await EVM.getProviders(blockchain)).map((provider)=>{

        const request = singleRequest({ blockchain, address, api, method, params, block, provider });
      
        if(timeout) {
          const timeoutPromise = new Promise((_, reject)=>setTimeout(()=>{ reject(new Error("Web3ClientTimeout")); }, timeout));
          return Promise.race([request, timeoutPromise])
        } else {
          return request
        }
      }))

    } else { // failover

      const provider = await EVM.getProvider(blockchain);
      const request = singleRequest({ blockchain, address, api, method, params, block, provider });
      
      if(timeout) {
        timeout = new Promise((_, reject)=>setTimeout(()=>{ reject(new Error("Web3ClientTimeout")); }, timeout));
        return Promise.race([request, timeout])
      } else {
        return request
      }
    }
  };

  var parseUrl = (url) => {
    if (typeof url == 'object') {
      return url
    }
    let deconstructed = url.match(/(?<blockchain>\w+):\/\/(?<part1>[\w\d]+)(\/(?<part2>[\w\d]+)*)?/);

    if(deconstructed.groups.part2 == undefined) {
      if(deconstructed.groups.part1.match(/\d/)) {
        return {
          blockchain: deconstructed.groups.blockchain,
          address: deconstructed.groups.part1
        }
      } else {
        return {
          blockchain: deconstructed.groups.blockchain,
          method: deconstructed.groups.part1
        }
      }
    } else {
      return {
        blockchain: deconstructed.groups.blockchain,
        address: deconstructed.groups.part1,
        method: deconstructed.groups.part2
      }
    }
  };

  const request = async function (url, options) {
    
    const { blockchain, address, method } = parseUrl(url);
    const { api, params, cache: cache$1, block, timeout, strategy } = (typeof(url) == 'object' ? url : options) || {};

    return await cache({
      expires: cache$1 || 0,
      key: [blockchain, address, method, params, block],
      call: async()=>{
        if(supported.evm.includes(blockchain)) {


          return await requestEVM({ blockchain, address, api, method, params, block, strategy, timeout })


        } else if(supported.solana.includes(blockchain)) ; else {
          throw 'Unknown blockchain: ' + blockchain
        }  
      }
    })
  };

  const simulate = undefined;

  exports.estimate = estimate;
  exports.getProvider = getProvider;
  exports.getProviders = getProviders;
  exports.request = request;
  exports.resetCache = resetCache;
  exports.setProvider = setProvider;
  exports.setProviderEndpoints = setProviderEndpoints;
  exports.simulate = simulate;

  Object.defineProperty(exports, '__esModule', { value: true });

}));
