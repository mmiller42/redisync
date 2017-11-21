import Cache from './Cache'
import assert from 'assert'
import { castArray } from '../utils'

const defaultComposeArguments = value => JSON.stringify(value)
const defaultRevive = data => JSON.parse(data)

module.exports = class ValueCache extends Cache {
  constructor(
    redisync,
    channel,
    { key, composeArguments = defaultComposeArguments, revive = defaultRevive, load = true } = {}
  ) {
    super(redisync, channel)

    assert(typeof key === 'string', 'options.key argument must be a string')
    assert(
      typeof composeArguments === 'function',
      'options.composeArguments argument must be a function'
    )
    assert(typeof revive === 'function', 'options.revive argument must be a function')

    this._key = key

    this._composeArguments = value => {
      const args = castArray(composeArguments(value))
      assert(args.length >= 1, 'composeArguments must return an array with length of at least 1')
      assert(
        args.every(arg => typeof arg === 'string'),
        'composeArguments must return an array of strings'
      )

      return args
    }

    this._revive = revive
  }

  load() {
    return this._load([['get', this._key]], ([[, value]]) => value)
  }

  initialize(value) {
    return this._initialize([['set', this._key, ...this._composeArguments(value)]])
  }

  clear(broadcast = true) {
    return this._clear([['del', this._key]], broadcast)
  }

  set(value) {
    const args = this._composeArguments(value)
    const [serializedValue] = args
    return this._publish('set', serializedValue, [['set', this._key, ...args]])
  }

  _getInitialState() {
    return null
  }

  _consume(state, op, payload) {
    switch (op) {
      case 'load': {
        const value = payload
        return this._revive(value)
      }
      case 'set': {
        const value = payload
        return this._revive(value)
      }
      case 'clear': {
        return null
      }
      default: {
        return state
      }
    }
  }
}
