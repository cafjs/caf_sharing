/*!
Copyright 2013 Hewlett-Packard Development Company, L.P.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

'use strict';
/**
 * A `Shared Map` provides a single writer/multiple reader dictionary
 * with a distributed, replicated data structure.
 *
 * Internally it uses persistent data structures (`immutable.js`) to maintain
 * multiple versions in an efficient manner.
 *
 * Multiple versions are needed because `Sharing Actors` require both
 * `Readers Isolation` and `Fairness` for readers. `Readers Isolation` ensures
 * that contents
 * do not change during the processing of a message. `Fairness` allows
 * local CAs to see the most recent locally available version, regardless of the
 * behavior of other CAs.
 *
 * CA message processing is always within a transaction, and changes to a
 * `Shared Map` are part of that transaction. Therefore, changes  wait for
 * `commit` before they are externalized. *Writer Atomicity* guarantees that
 * partial updates will never leak.
 *
 * The consistency goals are `read-your-writes` for the single writer within a
 * transaction. The other CAs have monotonic read consistency: no guarantees
 * that they see the latest version, but they never see older versions.
 *
 * `Shared Maps` can contain serialized functions (not closures) that can
 * be evaluated as a method of the map, i.e., binding `this` to it, with
 * `applyMethod`.
 *
 * This implementation does NOT use ES6 Maps, and keys are always strings.
 *
 * @module caf_sharing/SharedMap
 */
var Immutable = require('immutable');

var PASSTHROUGH_METHODS = ['get', 'has', 'size', 'toObject'];

var FIRST_VERSION = exports.FIRST_VERSION = 0;

var FUNCTION_MARKER = 'function_PlkW02z*Z10';

var MAX_CACHE_SIZE = 100;

var MAX_UPDATES = 100;

var deepFreeze = function(obj) {
    if (obj && ((typeof obj === 'object') ||
                (typeof obj === 'function'))) {
        if (!Object.isFrozen(obj)) { // assumed deeply frozen
            Object.freeze(obj);
            Object.keys(obj).forEach(function(p) {
                deepFreeze(obj[p]);
            });
        }
    }
};

/**
 *  Constructor.
 *
 * A distributed, replicated dictionary with one writer and multiple readers.
 *
 * @param {Object=} logger A logger component to print warnings.
 * @param {boolean=} noExec True to disable execution of serialized methods.
 * @param {number=} maxUpdates The number of updates that should be remembered
 * to facilitate client recovery. Beyond that a full dump is needed.
 *
 * @memberof! module:caf_sharing/SharedMap
 * @alias SharedMap
 *
 */
exports.SharedMap = function(logger, noExec, maxUpdates) {
    var that = {};
    var map = Immutable.Map({'__ca_version__': FIRST_VERSION});
    var updates = Immutable.List();

    var TOMBSTONE = {};
    var MAGIC_KEY = {};
    var methodCache = {};
    maxUpdates = ((typeof maxUpdates === 'number') && (maxUpdates > 0)) ?
        maxUpdates :
        MAX_UPDATES;

    /**
     * Returns a reference to a snapshot of the `Shared Map`.
     *
     * @param {boolean} readOnly True if the reference should not allow changes.
     * @return {refMapType} A reference to a `Shared Map` snapshot.
     *
     * @memberof! module:caf_sharing/SharedMap#
     * @alias ref
     */
    that.ref = function(readOnly) {
        var isReadOnly = readOnly;
        var changes = null;

        var checkReadOnly = function() {
            if (isReadOnly) {
                throw new Error('Cannot modify read only SharedMap');
            }
        };

        var originalVersion = map.get('__ca_version__');
        if (typeof originalVersion !== 'number') {
            var err = new Error('Invalid version');
            err['originalVersion'] = originalVersion;
            err['map'] = map;
            throw err;
        }

        var refThat = {};

        var refMap = (function(x) { return x;}) (map);

        var refUpdates = (function(x) { return x;}) (updates);

        var delta = [];

        /**
         * Prepare to commit changes.
         *
         * @return {mapUpdateType} Changes to commit.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#prepare
         */
        refThat.prepare = function() {
            var cleanUpDelta = function() {
                var remove = [];
                var add = [];
                var clean = {};
                delta.forEach(function(x) { clean[x[0]] = x[1];});
                Object.keys(clean).forEach(function(x) {
                    if (clean[x] === TOMBSTONE) {
                        remove.push(x);
                    } else {
                        add.push(x);
                        add.push(clean[x]);
                    }
                });
                return {remove: remove, add: add, version: originalVersion};
            };
            checkReadOnly();
            var versionSet = delta.some(function(x) {
                return (x[0] === '__ca_version__');
            });
            if (!versionSet) {
                refThat.set('__ca_version__', originalVersion + 1);
            }
            isReadOnly = true;
            changes = cleanUpDelta();
            return changes;
        };

        /**
         * Whether the map reference is read only.
         *
         * @return {boolean} True if the reference is read only.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#isReadOnly
         */
        refThat.isReadOnly = function() {
            return isReadOnly;
        };

        /**
         * Returns changes to commit.
         * They are only available after `prepare()`.
         *
         * @return {mapUpdateType} Changes to commit.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#getChanges
         */
        refThat.getChanges = function() {
            // only available after prepare
            return changes;
        };

        /**
         * Whether the map has changes to commit.
         *
         * @return {boolean} True if the map has changes to commit.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#hasChanged
         */
        refThat.hasChanged = function() {
            return (delta.length > 0);
        };

        /**
         * Returns the version of the underlying map.
         *
         * @return {number} The version of the underlying map.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#getVersion
         */
        refThat.getVersion = function() {
            return originalVersion;
        };

        refThat.__ca_toImmutableObject__ = function(magicKey) {
            /**
             * Immutable.js does not necessarily protect a map from
             * malicious code. `MagicKey` is an attempt to make this method
             * only callable from someone with access to the underlying map
             * (see toImmutableObject(ref) a method of SharedMap).
             *
             * Our secure proxies do not expose the underlying Map, just only
             * a `ref` to it.
             *
             */
            if (magicKey !== MAGIC_KEY) {
                throw new Error('Private method cannot be called by' +
                                ' untrusted code');
            }
            return refMap;
        };

        /**
         * Returns a full dump of the map.
         *
         * @return {mapUpdateType} A full dump of the map.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#dump
         */
        refThat.dump = function() {
            var obj = refMap.toObject();
            var result = [];
            Object.keys(obj).forEach(function(x) {
                result.push(x);
                result.push(obj[x]);
            });
            return {version: FIRST_VERSION, add: result, remove: []};
        };

        /**
         * Provides a list of changes to make a replica up to date.
         *
         * Only read-only references maintain a list of updates.
         *
         * @return {Array.<mapUpdateType> | null} A list of changes or `null`
         * to indicate a full dump is needed. An empty array means it is
         * already up to date.
         * @throws Error If the reference is not read-only.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#updatesSlice
         */
        refThat.updatesSlice = function(firstVersion) {
            if (!readOnly) { // use original 'readOnly' to identify a replica.
                var err = new Error('Update list available only in read-only' +
                                    ' replicas');
                throw err;
            }
            // 0) force a more efficient full update
            if (firstVersion === FIRST_VERSION) {
                return null;
            }

            // 1) up to date
            if (firstVersion === originalVersion) {
                return [];
            }

            // 2) can never recover without a reset
            if (firstVersion > originalVersion) {
                logger && logger.debug('version ' + firstVersion +
                                       ' more recent than current ' +
                                       originalVersion + '  resetting');
                return null; // force a reset
            }

            // 3) recovered with full update
            if ((refUpdates.size === 0) ||
                (firstVersion < refUpdates.first().version)) {
                return null; // force a reset
            }


            // 4) recovered with incremental update
            var result = [];
            refUpdates.forEach(function(x) {
                if (x.version >= firstVersion) {
                    result.push(x);
                }
            });

            return result;
        };

        /**
         * Sets the value of a key.
         *
         * The value will be deep frozen to avoid future changes.
         *
         * @param {string} key A map key.
         * @param {jsonType} value A new value for `key`.
         * @return {refMapType} This reference for call chaining.
         * @throws Error if invalid input types.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#set
         */
        refThat.set = function(key, value) {
            checkReadOnly();
            deepFreeze(key);
            deepFreeze(value);
            if (typeof value === 'function') {
                throw new Error('value is a function, use setFun() instead');
            }
            refMap = refMap.set(key, value);
            delta.push([key, value]);
            return refThat;
        };

        /**
         * Adds a serialized method.
         *
         * The method cannot be a closure, just a simple function serialized
         * as a string, similar to calling the `toString()` method of a
         * function object.
         *
         * It should only refer to the contents of the Map, i.e., with `this`,
         * or its arguments. No globals or enclosing context.
         *
         * @param {string} key A name for the method.
         * @param {Array.<string>} args The argument names.
         * @param {string} bodyString Body of the function serialized as a
         * string, e.g., `"return (3 + this.get('foo'))"`.
         * @return {refMapType} This reference for call chaining.
         * @throws Error if invalid input types.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#setFun
         */
        refThat.setFun = function(key, args, bodyString) {
            var value = {type: FUNCTION_MARKER, args: args, body: bodyString};
            return refThat.set(key, value);
        };

        /**
         * Deletes a key entry.
         *
         * @param {string} key A map key.
         * @return {refMapType} This reference for call chaining.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#delete
         */
        refThat.delete = function(key) {
            checkReadOnly();
            refMap = refMap.delete(key);
            delta.push([key, TOMBSTONE]);
            return refThat;
        };

        var newMethod = function(methodDesc) {
            if (Object.keys(methodCache).length >= MAX_CACHE_SIZE) {
                // bound memory leak...
                methodCache = {};
            }
            var result = new Function(methodDesc.args.join(','),
                                      '"use strict";' + methodDesc.body);
            methodCache[methodDesc.body] = result;
            return result;
        };

        /**
         * Executes a serialized method.
         *
         * @param {string} method A method name.
         * @param {Array.<any>} args The method arguments.
         * @return {any} The result of the call.
         * @throws Error if execution disabled or invalid method.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#applyMethod
         */
        refThat.applyMethod = function(method, args) {
            if (noExec) {
                throw new Error('NoExec: Eval disabled');
            }
            var methodDesc = refThat.get(method);
            if ((!methodDesc) || (typeof methodDesc !== 'object') ||
                (methodDesc.type !== FUNCTION_MARKER)) {
                var err = new Error('Unknown method');
                err['method'] = method;
                throw err;
            }
            var m = methodCache[methodDesc.body] || newMethod(methodDesc);
            return m.apply(refThat, args);
        };

        /**
         * The methods directly proxied to the underlying map are:
         *
         * `get`, `has`, `size` and `toObject`
         *
         * See `Immutable.js`  for details.
         *
         * @memberof! module:caf_sharing/SharedMap#
         * @alias refMapType#PASSTHROUGH_METHODS
         */
        PASSTHROUGH_METHODS.forEach(function(methodName) {
            refThat[methodName] = function() {
                var args = Array.prototype.slice.apply(arguments);
                return refMap[methodName].apply(refMap, args);
            };
        });

        return Object.freeze(refThat);
    };

    /**
     * Applies a list of changes to keep the map up-to-date.
     *
     * @param {mapUpdateType | Array.<mapUpdateType>} changes Deltas to be
     * applied.
     * @throws {Error} If updates are invalid.
     *
     * @memberof! module:caf_sharing/SharedMap#
     * @alias applyChanges
     */
    that.applyChanges = function(changes) {
        if (Array.isArray(changes)) {
            changes.forEach(function(x) {that.applyChanges(x);});
        } else {
            var ref = that.ref(false);
            if ((changes.version === FIRST_VERSION) &&
                (changes.version !== ref.getVersion())) {
                // Full dump, reset and retry
                that.reset();
                that.applyChanges(changes);
            } else if (changes.version > ref.getVersion()) {
                var err = new Error('Incompatible version: missed update');
                err['originalVersion'] = ref.getVersion();
                err['version'] = changes.version;
                throw err;
            } else if (changes.version < ref.getVersion()) {
                // make applyChanges idempotent
                logger && logger.debug('Ignoring old update ' +
                                       JSON.stringify(changes));
            } else {
                Object.freeze(changes);
                Object.freeze(changes.add); // elements already frozen in `set`
                Object.freeze(changes.remove);

                changes.remove.forEach(function(x) {ref.delete(x);});
                var key = null;
                changes.add.forEach(function(x, i) {
                    if (i%2 === 0) {
                        key = x;
                    } else {
                        ref.set(key, x);
                    }
                });
                ref.prepare();
                that.commit(ref);
                updates = updates.push(changes);
                if (updates.size > maxUpdates) {
                    updates = updates.shift();
                }
            }
        }
    };

    /**
     * Returns an Immutable.js map representing this object.
     *
     * @param {refMapType=} ref  An optional reference to a map snapshot. It
     * defaults to the current version.
     * @return {Object} An Immutable.js map representing this object.
     *
     * @memberof! module:caf_sharing/SharedMap#
     * @alias toImmutableObject
     */
    that.toImmutableObject = function(ref) {
        ref = ref || that.ref(true);
        return ref.__ca_toImmutableObject__(MAGIC_KEY);
    };

    /**
     * Returns the current version of this map.
     *
     * @param {refMapType=} ref  An optional reference to a map snapshot. It
     * defaults to the current version.
     * @return {number} A version number.
     *
     * @memberof! module:caf_sharing/SharedMap#
     * @alias getVersion
     */
    that.getVersion = function(ref) {
        ref = ref || that.ref(true);
        return ref.getVersion();
    };

    /**
     * Resets this map.
     *
     * The original state is lost, including pending commits.
     *
     * @memberof! module:caf_sharing/SharedMap#
     * @alias reset
     */
    that.reset = function() {
        // warning: pending commits will fail, best restrict to read-only
        map = Immutable.Map({'__ca_version__': FIRST_VERSION});
        methodCache = {};
        updates = Immutable.List();
    };

    /**
     * Commits pending changes.
     *
     * @param {refMapType} ref A reference to the map snapshot to be
     * committed.
     * @throws {Error} If the map is read only, or there are no pending changes,
     * or a concurrent update was detected.
     *
     * @memberof! module:caf_sharing/SharedMap#
     * @alias commit
     */
    that.commit = function(ref) {
        var refMap = that.toImmutableObject(ref);
        if ((!ref.isReadOnly()) || (!ref.hasChanged())) {
            throw new Error('Call prepare before commit');
        }

        if (map.get('__ca_version__') !== ref.getVersion()) {
            var err = new Error('Concurrent update detected');
            err['originalVersion'] = ref.getVersion();
            err['currentVersion'] = map.get('__ca_version__');
            throw err;
        }
        map = refMap;
    };

    return that;
};
