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

"use strict";
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
                if (obj.hasOwnProperty(p)) {
                    deepFreeze(obj[p]);
                }
            });
        }
    }
};

/**
 * A distributed map with single writer and multiple readers.
 *
 * Changes use a persistent (functional) data structure  to ensure readers
 * isolation.
 *
 */
var SharedMap = exports.SharedMap = function(logger, noExec, maxUpdates) {
    var that = {};
    var map = Immutable.Map({'__ca_version__' : FIRST_VERSION});
    var updates = Immutable.List();

    var TOMBSTONE = {};
    var MAGIC_KEY = {};
    var methodCache = {};
    maxUpdates = (((typeof maxUpdates === 'number') && (maxUpdates > 0)) ?
                  maxUpdates: MAX_UPDATES);
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
            var err =  new Error('Invalid version');
            err.originalVersion = originalVersion;
            err.map = map;
            throw err;
        }

        var refThat = {};

        var refMap = (function(x) { return x;}) (map);

        var refUpdates = (function(x) { return x;}) (updates);

        var delta = [];

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
                return {remove: remove , add: add, version: originalVersion};
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

        refThat.isReadOnly = function() {
            return isReadOnly;
        };

        refThat.getChanges = function() {
            // only available after prepare
            return changes;
        };

        refThat.hasChanged = function() {
            return (delta.length > 0);
        };

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

        refThat.dump = function() {
            var obj = refMap.toObject();
            var result = [];
            Object.keys(obj).forEach(function(x) {
                result.push(x);
                result.push(obj[x]);
            });
            return {version: FIRST_VERSION, add: result, remove: []};
        };

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
         * @param{string} key A key to be set in the SharedMap.
         * @param{Array.<string>} args Argument names.
         * @param{string} bodyString Body of function.
         */
        refThat.setFun = function(key, args, bodyString) {
            var value = {type: FUNCTION_MARKER, args: args, body: bodyString};
            return refThat.set(key, value);
        };

        refThat.delete = function(key) {
            checkReadOnly();
            refMap = refMap.delete(key);
            delta.push([key, TOMBSTONE]);
            return refThat;
        };

        var newMethod = function(methodDesc) {
            if (Object.keys(methodCache).length >=  MAX_CACHE_SIZE) {
                // bound memory leak...
                methodCache = {};
            }
            var result = new Function(methodDesc.args.join(','),
                                      '"use strict";' + methodDesc.body);
            methodCache[methodDesc.body] = result;
            return result;
        };

        refThat.applyMethod = function(method, args) {
            if (noExec) {
                throw new Error('NoExec: Eval disabled');
            }
            var methodDesc = refThat.get(method);
            if ((!methodDesc) || (typeof methodDesc !== 'object') ||
                (methodDesc.type !== FUNCTION_MARKER))  {
                var err =  new Error('Unknown method');
                err.method = method;
                throw err;
            }
            var m = methodCache[methodDesc.body] || newMethod(methodDesc);
            return m.apply(refThat, args);
        };

        PASSTHROUGH_METHODS.forEach(function(methodName) {
            refThat[methodName] = function() {
                var args = Array.prototype.slice.apply(arguments);
                return refMap[methodName].apply(refMap, args);
            };
        });

        return Object.freeze(refThat);
    };

    that.applyChanges = function(changes) {
        if (Array.isArray(changes)) {
            changes.forEach(function(x) {that.applyChanges(x);});
        } else {
            var ref = that.ref();
            if (changes.version > ref.getVersion()) {
                var err = new Error('Incompatible version: missed update');
                err.originalVersion = ref.getVersion();
                err.version =  changes.version;
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


    that.toImmutableObject = function(ref) {
        ref = ref || that.ref(true);
        return ref.__ca_toImmutableObject__(MAGIC_KEY);
    };

    that.getVersion = function(ref) {
        ref = ref || that.ref(true);
        return ref.getVersion();
    };

    that.reset = function() {
        // warning: pending commits will fail, best restrict to read-only
        map = Immutable.Map({'__ca_version__' : FIRST_VERSION});
        methodCache = {};
        updates = Immutable.List();
    };

    that.commit = function(ref) {
        var refMap = that.toImmutableObject(ref);
        if ((!ref.isReadOnly()) || (!ref.hasChanged())) {
            throw new Error('Call prepare before commit');
        }

        if (map.get('__ca_version__') !== ref.getVersion()) {
            var err = new Error('Concurrent update detected');
            err.originalVersion =  ref.getVersion();
            err.currentVersion = map.get('__ca_version__');
            throw err;
        }
        map = refMap;
    };

    return that;
};
