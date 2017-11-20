import Cache from './Cache';
import assert from 'assert';
import { flatMap, isPlainObject, reassign, reduce } from '../utils';

const defaultComposeArguments = (field, value) => [field, JSON.stringify(value)];
const defaultRevive = (field, value) => [field, JSON.parse(value)];

module.exports = class HashCache extends Cache {
  constructor(redisync, channel, { key, composeArguments = defaultComposeArguments, revive = defaultRevive } = {}) {
    throw new Error('this is not implemented yet!')
    super(redisync, channel);

    assert(typeof key === 'string', 'options.key argument must be a string');
    assert(typeof composeArguments === 'function', 'options.composeArguments argument must be a function');
    assert(typeof revive === 'function', 'options.revive argument must be a function');

    this._key = key;

    this._composeArguments = (field, value) => {
      const args = composeArguments(field, value);
      assert(args.length >= 2, 'composeArguments must return an array with length of at least 2');
      assert(args.every(arg => typeof arg === 'string'), 'composeArguments must return an array of strings');

      return args;
    };

    this._revive = (field, value) => {
      const state = revive(field, value);
      assert(state.length === 2, 'revive must return an array with length of 2 (state key and value)');

      const [stateKey, stateValue] = state;
      assert(typeof stateKey === 'string', 'revive return an array with a string at position 0 (state key)');

      return [stateKey, stateValue];
    };
  }

  load() {
    return this._load([['hgetall', this._key]]);
  }

  initialize(values) {
    assert(isPlainObject(values), 'values argument must be a plain object');

    return this._initialize([
      ['hmset', this._key, ...flatMap(values, (value, field) => this._composeArguments(field, value))]
    ]);
  }

  clear(broadcast = true) {
    return this._clear([['del', this._key]], broadcast);
  }

  set(field, value) {
    const args = this._composeArguments(field, value);
    const [serializedField, serializedValue] = args;
    return this._publish('set', [serializedField, serializedValue], [['hset', this._key, ...args]]);
  }

  delete(field) {
    const args = this._composeArguments(field, null);
    const [serializedField] = args;
    return this._publish('delete', serializedField, [['hdel', this._key, ...args]]);
  }

  _getInitialState() {
    return Object.create(null);
  }

  _consume(op, payload) {
    switch (op) {
      case 'load': {
        const [[, data]] = payload;
        reassign(this.state, reduce(data, (newState, value, field) => {
          const [stateKey, stateValue] = this._revive(field, value);
          newState[stateKey] = stateValue;
          return newState;
        }, Object.create(null)));
        return this.state;
      }
      case 'clear': {
        reassign(this.state, null);
        return this.state;
      }
      case 'set': {
        const [field, value] = payload;
        this.state[field] = this._revive(field, value);
        return this.state;
      }
      case 'delete': {
        const field = payload;
        delete this.state[field];
        return this.state;
      }
      default: {
        return this.state;
      }
    }
  }
};
