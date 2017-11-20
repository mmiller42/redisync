import { HashCache, ValueCache } from './caches'
import Redis from 'ioredis'

module.exports = class Redisync {
  constructor(...args) {
    this._redisArgs = args
    this._consumer = null
    this._producer = null
  }

  get consumer() {
    if (!this._consumer) {
      this._consumer = new Redis(...this._redisArgs)
    }
    return this._consumer
  }

  get producer() {
    if (!this._producer) {
      this._producer = new Redis(...this._redisArgs)
    }
    return this._producer
  }

  createHashCache(channel, options) {
    return this.createCache(HashCache, channel, options)
  }

  createValueCache(channel, options) {
    return this.createCache(ValueCache, channel, options)
  }

  createCache(Constructor, channel, options) {
    return new Constructor(this, channel, options)
  }
}
