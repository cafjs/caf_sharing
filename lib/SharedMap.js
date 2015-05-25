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

var FIRST_VERSION = 0;

var METHOD_HEADER = '#I2qDYejOohnr8baNvfkO#'; // 120 random bits

var MAX_CACHE_SIZE = 100;

/**
 * A distributed map with single writer and multiple readers.
 *
 * Changes use a persistent (functional) data structure  to ensure readers
 * isolation.
 *
 */
var SharedMap = exports.SharedMap = function(logger, noExec) {
    var that = {};
    var map = Immutable.Map({'__ca_version__' : FIRST_VERSION});
    var TOMBSTONE = {};
    var methodCache = {};

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

        refThat.toImmutableObject = function() {
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

        refThat.set = function(key, value) {
            checkReadOnly();
            if (typeof value === 'function') {
                value = METHOD_HEADER + value.toString();
            }
            refMap = refMap.set(key, value);
            delta.push([key, value]);
            return refThat;
        };

        refThat.delete = function(key) {
            checkReadOnly();
            refMap = refMap.delete(key);
            delta.push([key, TOMBSTONE]);
            return refThat;
        };

        var newMethod = function(methodStr) {
            if (Object.keys(methodCache).length >=  MAX_CACHE_SIZE) {
                // bound memory leak...
                methodCache = {};
            }
            if (methodStr.indexOf(METHOD_HEADER) !== 0) {
                var err =  new Error('Method has no header');
                err.methodStr = methodStr;
                throw err;
            }
            var cleanStr = methodStr.substring(METHOD_HEADER.length);
            var result;
            eval('result = (function() { return ' + cleanStr + ';}) ()');
            methodCache[methodStr] = result;
            return result;
        };

        refThat.applyMethod = function(method, args) {
            if (noExec) {
                throw new Error('NoExec: Eval disabled');
            }
            var methodStr = refThat.get(method);
            if (typeof methodStr !== 'string') {
                var err =  new Error('Unknown method');
                err.method = method;
                throw err;
            }
            var m = methodCache[methodStr] || newMethod(methodStr);
            return m.apply(refThat, args);
        };

        PASSTHROUGH_METHODS.forEach(function(methodName) {
            refThat[methodName] = function() {
                var args = Array.prototype.slice.apply(arguments);
                return refMap[methodName].apply(refMap, args);
            };
        });

        return refThat;
    };

    that.applyChanges = function(changes) {
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
        }
    };

    that.reset = function() {
        // warning: pending commits will fail, best restrict to read-only
        map = Immutable.Map({'__ca_version__' : FIRST_VERSION});
        methodCache = {};
    };

    that.commit = function(ref) {
        var refMap = ref.toImmutableObject();
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


