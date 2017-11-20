import { EventEmitter } from 'events'
import Redisync from '../Redisync'
import assert from 'assert'

module.exports = class Cache {
  constructor(redisync, channel) {
    assert(redisync instanceof Redisync, 'redisync argument must be an instance of Redisync')
    assert(typeof channel === 'string', 'channel argument must be a string')
    this._redisync = redisync
    this._channel = channel
    this._emitter = new EventEmitter()

    this._initializeConsumer()
    this._state = this._getInitialState()
  }

  get() {
    return this._state
  }

  subscribe(listener) {
    this._emitter.on('change', listener)
  }

  unsubscribe(listener) {
    this._emitter.removeListener('change', listener)
  }

  async _load(commands, parseResults) {
    const { producer } = this._redisync
    const results = await producer.multi(commands).exec()
    this._state = this._consume(this.get(), 'load', parseResults(results))
  }

  async _initialize(commands) {
    await this.clear(false)
    const { producer } = this._redisync
    await this._publish('reload', undefined, commands)
    await new Promise(resolve => this._emitter.once('reloaded', resolve))
  }

  async _clear(commands, broadcast = false) {
    if (broadcast) {
      await this._publish('clear', undefined, commands)
    } else {
      const { producer } = this._redisync
      await producer.multi(commands).exec()
    }
  }

  async _publish(op, payload, commands) {
    const { producer } = this._redisync

    await producer
      .multi([...commands, ['publish', this._channel, JSON.stringify({ op, payload })]])
      .exec()
  }

  _initializeConsumer() {
    const { consumer } = this._redisync
    consumer.subscribe(this._channel)
    consumer.on('message', async (eventChannel, message) => {
      if (eventChannel === this._channel) {
        const { op, payload = null } = JSON.parse(message)

        if (op === 'reload') {
          try {
            await this.load()
          } catch (err) {
            this._emitter.emit('error', err)
          }
          return
        }

        this._state = this._consume(this.get(), op, payload)
        this._emitter.emit('change', this.get())

        if (op === 'load') {
          this._emitter.emit('reloaded', this.get())
        }
      }
    })
  }
}
