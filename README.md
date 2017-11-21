# redisync

A tool for synchronizing a centralized in-memory data cache across multiple Node.js applications using pub/sub.

Redisync allows you to share cache among multiple Node.js servers and restore it between restarts using Redis. It creates an in-memory copy of your cached data and keeps it in sync with data persisted to a Redis server.

## FAQ

### Should I use it?

Redis is already fast, so this might seem unnecessary. The goal of this project was to create a tool designed for extremely frequent reads to a small amount of cached data that is written to infrequently.

These are good use cases for Redisync:

* **An API that checks if a session ID has been revoked before every request.** The token must be verified during each and every API request -- in comparison, the session IDs are only written when users log in and out. A Redisync hash can be stored in memory mapping session IDs to a boolean indicating whether they are valid, and synced across all app servers.

* **A SSO API service that stores a user's permissions that an app API needs to reference.** The permission data is changed very infrequently, but the app API must verify every incoming request to confirm that the user has sufficient permissions -- preferably, without hitting the SSO API's endpoint every time it needs such data. A JWT payload might store a user's role IDs, while a Redisync hash maps role IDs to associated permissions.

* **An API service that needs to set the CORS origin header to a list of domains fetched from a database.** The domains are obtained through a costly SQL query that would be performed on every API request, but the data is rarely updated. The app might use a Redisync list to store the origin domains, and the list is modified only when an administrator updates the valid domains.

This project is **not** suited for:

* **Any data sets that will grow larger than a couple of MB.** All the data stored in Redis using Redisync is stored in memory in JavaScript objects. Redis or Postgres or Kafka will scale; Redisync will not. This means that in the first "good use case" example above, Redisync will not work for you if your app will have hundreds of thousands of active user sessions (or if stale sessions are not cleaned up).

* **Querying.** The data will be written to and read from Redis in basic formats like key/value pairs, hashes, and lists, which translate to JSON literals, dictionaries, and arrays on the Redisync side. While there are libraries for parsing and searching these data structures, if you need to traverse and join data together to produce the results you need, you might be better off with a SQL store.

* **Data storage.** Redis is a caching tool, not a database. It trades speed for reliability and doesn't synchronously write to disk. Redis should be a redundant key/value store, where the primary source of truth is a transactional, ACID-compliant SQL or noSQL database. Redisync is modeled around this in the sense that each Cache implementation offers an initialize method, with the expectation that you will need to query the data from somewhere else and repopulate Redis at any time with all the relevant data, if it is lost to disk failure, exceeding memory limit, etc. Redis was not designed to be a persistence store; prepare for, and expect, all data stored in it to be transient.

<details>
<summary><strong>More FAQ questions</strong></summary>

### Why not just Redis?

Using Redis alone to cache the data works just fine, but this project assumes your reads will be so frequent, writes so infrequent, and data set small enough, that it is more practical to cache the data in local memory within the application so it can be read synchronously.

### Why not a messaging queue?

A messaging queue would allow you to construct the data structure in memory by receiving event messages that provide instructions for assembling the data. The downside to this approach is when a dependent service needs to restart, or a new one spawned; in order to recreate the data structure, it has to replay all the messages since the beginning of time. For long-lived processes, a lot of events will accumulate.

This project is a hybrid approach: the latest data structure is persisted in Redis, while changes to the data are broadcasted as events using Redis' publish/subscribe system. So, when the app bootstraps, it loads the data into Redis, and then subscribes to updates. The Node.js server in charge of writing updates calls one simple function which both updates the data cached in Redis and publishes messages instructing consumers to mutate their local copies of the data store. For more complicated data structures like hashes and lists, the consumers of this event can update the pertinent data without reloading everything from Redis, but new services can immediately restore the current state of the store by reading the entire set from Redis.

### Why not just use objects in memory without Redis?

Small data sets are often useful to cache in memory; however, this approach does not scale when you have to share this data among multiple servers (i.e. horizontal scaling or multiple services that need access to the same data). This data is also lost if the server restarts for some reason.

### How does this scale with larger data sets?

It doesn't. Don't use this tool for any type of data that you expect to grow in size as your application gains traction. A nasty refactor is inevitable. This tool ultimately only works when everything you intend to store in Redis would also fit comfortably in memory on your server.

This project is only intended for those use cases where you would otherwise just cache data in local memory, if not for (a) the inability to horizontally scale, and (b) the inability to restore the cache upon restart.

</details>

## Installation

```sh
npm install redisync
```

## Usage

```js
import Redisync from 'redisync'

// Constructor takes the same parameters as `ioredis`
const redisync = new Redisync('redis://localhost:6379')

// Create a simple value cache. Redisync will save the value in the key "greeting" and publish
// messages to a channel called "greeting_changes"
const greeting = redisync.createValueCache('greeting_changes', { key: 'greeting' })

// On every API request, we can synchronously check the value as it has been read from Redis and cached
// in memory. (The value will be `null` until it has been retrieved.)
app.get('greeting', (req, res) => {
  const greetingMessage = greeting.get()
  res.send(greetingMessage)
})

// Later, we can change the downForMaintenance value and it should propagate to any other servers
// connected to the same Redis instance and subscribed to the same channel
greeting.set('Hello world!')
```

When a Redisync cache instance is created, it automatically subscribes to the channel and requests the current value from Redis. Until the current value is fetched, the result of [`ValueCache#get`](#get) will be `null`. If it is important to wait until the value is populated before continuing, you can subscribe to the cache and continue when the listener is executed.

```js
const greeting = redisync.createValueCache('greeting_changes', { key: 'greeting' })
greeting.subscribeOnce(greetingMessage => console.log(greetingMessage))
```

## API

### `Redisync`

Class which holds Redis clients. Cache objects are bound to this singleton instance to issue commands to Redis.

#### `#constructor(...args)`

|Parameter|Type|Description|Default|
|:--------|:---|:----------|:------|
|`...args`|*|All arguments passed to the `Redisync` constructor are forwarded to the [`ioredis`](https://github.com/luin/ioredis#connect-to-redis) constructor, so you may pass connection configuration as multiple parameters, a configuration object, or a connection URL.|*None*|

```js
const redisync = new Redisync('redis://localhost:6379')
```

#### `#createCache(Constructor, channel, options)`

Creates an instance of the given Cache, binding it to the Redisync instance. This can be used to instantiate custom Cache classes for maintaining other types of data in Redis by subclassing `Cache`.

|Parameter|Type|Description|Default|
|:--------|:---|:----------|:------|
|`Constructor`|class extends `Cache`|A subclass of `Cache` that will be constructed and passed this Redisync instance and the remaining arguments.|*None*|
|`channel`|string|The name of the Redis channel to publish to and subscribe from. This must be unique, [*across key spaces*](https://redis.io/topics/pubsub#database-amp-scoping).|*None*|
|`options`|object|A configuration object for the `Constructor` instance.|*None*|

Returns `Constructor` instance.

```js
const cache = redisync.createCache(Redisync.ValueCache, 'test_channel', {
  key: 'test_key',
})
```

#### `#createValueCache(channel, options)`

Creates an instance of [`ValueCache`](#valuecache), binding it to this Redisync instance.

The parameters passed to this function are the same as those passed to [`ValueCache#constructor`](#constructorredisync-channel-options), except that the first parameter (`redisync`) is passed by this function automatically.

Returns [`ValueCache`](#valuecache) instance.

```js
const cache = redisync.createValueCache('test_channel', {
  key: 'test_key',
})
```

### `ValueCache`

A Cache which can be used to store a simple value in a static key.

#### `#constructor(redisync, channel, options)`

*Please note that this class is usually instantiated via [`Redisync#createValueCache`](#createvaluecachechannel-options) rather than directly.*

|Parameter|Type|Description|Default|
|:--------|:---|:----------|:------|
|`redisync`|Redisync|The Redisync instance. This is usually passed by [`Redisync#createValueCache`](#createvaluecachechannel-options).|*None*|
|`channel`|string|The name of the Redis channel to publish to and subscribe from. This must be unique, [*across key spaces*](https://redis.io/topics/pubsub#database-amp-scoping).|*None*|
|`options`|object| |*None*|
|`options.key`|string|The key to store the value in in the Redis database. This must be unique for the Redis key space.|*None*|
|`[options.composeArguments]`|function(value: any): string\|string[]|A function that receives the value passed to [`#initialize`](#initializevalue) or [`#set`](#setvalue) and returns the arguments that should be passed to the Redis `SET` command, after `options.key`. You may return an array with additional arguments (e.g. to add an expiration command).|`value => JSON.stringify(value)`|
|`[options.revive]`|function(data: string): any|A function that receives the raw data from the Redis response and returns the data that will be returned by [`#get`](#get) (i.e. unserializes the data).|`value => JSON.parse(value)`|
|`[options.load]`|boolean|Set to false to not preload the current value from Redis when the Cache is instantiated. This can be used when you intend to overwrite the value and do not need to fetch the existing value.|`true`|

```js
const cache = redisync.createValueCache('recent_transaction_date', {
  key: 'recent_transaction_date',
  // Set key to expire in 5 minutes
  composeArguments: date => [String(date.getTime()), 'EX', '300'],
  revive: timestamp => new Date(Number(timestamp)),
})
```

#### `#clear([broadcast])`

Deletes the key from Redis.

|Parameter|Type|Description|Default|
|:--------|:---|:----------|:------|
|`[broadcast]`|boolean|If `true`, it will set the return value of [`#get`](#get) to `null` and publish an event so all other servers are set as well. Otherwise, the data is deleted from Redis only.|`true`|

Returns a Promise which resolves when the data is deleted.

```js
await cache.clear()
```

#### `#get()`

Returns the current in-memory value synchronously. Subsequent calls to this function will retrieve the latest value received from the subscriber.

Returns any type, the result of calling `options.revive` on the raw data returned from Redis.

```js
const theAnswer = cache.get()
```

#### `#initialize(value)`

Deletes existing data stored in this key in Redis and sets the data to the given value. This is effectively an alias of [`#set`](#setvalue) but may behave differently in other Cache implementations.

Generally this method is used to prepopulate an initially empty Redis key space -- so generally it is important that only one server call this method when bootstrapping.

See [`#set`](#setvalue) for parameters and return value.

```js
await cache.initialize(42)
```

#### `#load()`

Fetches the data from Redis and loads it into memory. This method should only be called at most once, when the app is bootstrapped. Subsequent changes to state will be reflected automatically. Usually this is called automatically when the cache is instantiated, unless configured not to.

Returns a Promise which resolves when the data is loaded into state.

```js
await cache.load()
```

#### `#set(value)`

Sets the data to the given value by serializing the value via `options.composeArguments` and committing it to Redis. When complete, the value returned from [`#get`](#get) will reflect calling `options.revive` on the value stored in Redis.

|Parameter|Type|Description|Default|
|:--------|:---|:----------|:------|
|`value`|any|The value to set.|*None*|

Returns a Promise which resolves when the data is loaded into state.

```js
await cache.set({ answer: 42 })
```

#### `#subscribe(listener)`

Attaches an event listener that will be executed whenever the state changes.

|Parameter|Type|Description|Default|
|:--------|:---|:----------|:------|
|`listener`|function(state: any)|A function called whenever the state changes. It is passed the result of the latest call to [`#get`](#get).|*None*|

#### `#subscribeOnce(listener)`

Attaches an event listener that will be executed the next time the state changes.

```js
cache.subscribeOnce(state => console.log('State changed!', state))
```

#### `#unsubscribe(listener)`

Detaches an event listener that will be executed whenever the state changes.

|Parameter|Type|Description|Default|
|:--------|:---|:----------|:------|
|`listener`|function(state: any)|The listener function to remove.|*None*|

```js
cache.unsubscribe(listener)
```

## Common problems and solutions

### Mutating state directly

If your value is an object, do not mutate it directly. These changes will not be persisted. Instead, use the [`ValueCache#set`](#setvalue) API or the equivalent for whichever Cache you are using.

```js
// DON'T do this. It will not be persisted to Redis or published to the channel
downForMaintenance.get().isDown = true

// Use the API to change the state
downForMaintenance.set(true)
downForMaintenance.set({ isDown: true })
```

### Attempting to store nonserializable data

Any data stored in Redis must first be converted to plaintext. The default behavior of Rediscache is to call `JSON.stringify(value)` on the value passed into [`ValueCache#set`](#setvalue) and `JSON.parse(data)` on the data retrieved from Redis. This means it is important to only set JSON-serializable values, i.e. plain objects, arrays, and primitives. If you want to pass more complex values, you can override the serializing behavior.

```js
// DON'T do this. It can't be serialized to text safely
downForMaintenance.set({ message: 'We will reopen December 31', until: new Date(2017, 11, 31) })

// Configure your Cache if you want to convert the data to and from a serializable form
const downForMaintenance = redisync.createValueCache('maintenance_changes', {
  key: 'down_for_maintenance',
  composeArguments: ({ message, until }) => [message, until.toISOString()].join('|'),
  revive: rawString => {
    const [message, until] = rawString.split('|')
    return { message, until: new Date(until) }
  },
})
downForMaintenance.set({ message: 'We will reopen December 31', until: new Date(2017, 11, 31) })
```

Bear in mind that, in order to maintain consistency across your environments, any time you call [`ValueCache#set`](#setvalue), the data is persisted to Redis, then ingested and passed through the `revive` function -- even on the server that called [`ValueCache#set`](#setvalue). This way, you know that the data structure of [`ValueCache#get`](#get) is consistent with other apps that ingested the event (provided the `options.revive` function is pure).

## Subclassing `Cache`

You can implement your own Cache classes for Redisync by creating a class that extends `Redisync.Cache` and following the procedure of implementing specific methods and calling specific methods on the parent class.

Better documentation for this is coming, along with other builtin Cache classes (`HashCache`, `ListCache`, and `VariableKeyCache`). In the mean time, use the source of [`ValueCache`](src/caches/ValueCache.js) as a reference. Note these significant definitions and calls:

* Defining a constructor with the signature of `constructor(redisync, channel, options)` and passing the first two arguments to `super`. No options are needed or referenced by the superclass; however, passing a third boolean argument to the constructor will determine whether or not data is preloaded when the object is constructed.
* Defining an instance method `load()`. This method must be present. It must return the result of the superclass' private `_load(commands, parseResults)` method, which accepts an array of Redis commands, each of which is a nested array containing the command name followed by its arguments; and a function to convert the response from Redis to extract the data.
* Defining an instance method `initialize(data)`. This method must be present. It must return the result of the superclass' private `_initialize(commands)` method, which accepts an array of commands. This method should accept a complete representation of the state and replicate that state in Redis.
* Defining an instance method `clear(broadcast = true)`. This method must be present. It must return the result of the superclass' private `_clear(commands, broadcast)` method, which accepts an array of commands and the broadcast parameter.
* Defining an instance method `_getInitialState()`. This method must be present. It must return the value to set the state to before it has been loaded.
* Defining instance methods for modifying the state. They must call the superclass' private method `_publish(op, payload, commands)`, specifying a name for the operation (e.g. `set` or `append`), a payload, which is any data needed to recreate the mutation on another server (e.g. the value to add to the in-memory array, or the index of the value to delete), and the commands to run in Redis to persist the data while publishing the message.
* Defining an instance method `_consume(state, op, payload)`. This method must be present. It will be called whenever a message is consumed by the subscriber. It receives the value of the current state, the name of the mutation operation to perform, and the payload of the message. It must return the new state. The operation and payload are arbitrary and depend on the values provided to the `_publish` command. There are also some standard ops called by the superclass:
  * The superclass may call this method with the op set to `load`, which indicates that the state should be completely replaced with the contents of the payload (the payload is the raw response from Redis, which may need reviving).
  * The superclass may call this method with the op set to `clear`, which indicates that the state should be reset to its initial state. This op has no payload.
