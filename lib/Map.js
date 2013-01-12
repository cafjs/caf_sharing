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

/* We cannot use strict mode because we need 'eval' to add methods*/
/*
 * Warning: this class depends on Javascript support for Harmony proxies. Enable
 * proxies in node.js by starting with 'node --harmony-proxies'.
 *
 * Also, it needs node >=0.8 since the implementation of proxies
 * in early versions of V8 is quite buggy.
 *
 *  Note that proxies are likely to change in the final spec...
 *
 *
 */

var assert = require('assert');
var crypto = require('crypto');

var METHOD_HEADER = '#I2qDYejOohnr8baNvfkO#'; // 120 random bits

var newChangeLog = function() {
    var changes = [];
    var isDirty = false;
    var that = {};

    that.setOp = function(key, value) {
        isDirty = true;
        changes.push({key: key, value: value});
        return that;
    };

    that.deleteOp = function(key) {
        isDirty = true;
        // undefined value means 'delete'
        changes.push({key: key});
        return that;
    };

    that.bulkOp = function(bulk) {
        isDirty = true;
        changes = changes.concat(bulk);
    };

    that.isEmpty = function() {
        return (changes.length === 0);
    };

    that.getChanges = function() {
        if (isDirty) {
            that.cleanup();
        }
        return changes;
    };

    that.find = function(key) {
        for (var i = changes.length - 1; i >= 0; i--) {
            if (changes[i].key === key) {
                return {value: changes[i].value};
            }
        }
        return undefined;
    };

    that.cleanup = function() {
        var clean = {};
        var tomb = {};
        for (var i = 0; i < changes.length; i++) {
            var val = changes[i].value;
            val = (val === undefined ? tomb : val);
            clean[changes[i].key] = val;
        }
        var cleanChanges = [];
        // no duplicate keys, we can reorder
        for (var keyName in clean) {
            var newVal = clean[keyName];
            if (newVal === tomb) {
                cleanChanges.push({key: keyName});
            } else {
                cleanChanges.push({key: keyName, value: newVal});
            }
        }
        changes = cleanChanges;
        isDirty = false;
        return that;
    };

    that.flush = function(target) {
        if (isDirty) {
            that.cleanup();
        }
        for (var i = 0; i < changes.length; i++) {
            if (changes[i].value === undefined) {
                delete target[changes[i].key];
            } else {
                target[changes[i].key] = changes[i].value;
            }
        }
        return that;
    };
    return that;

};

var objToPropList = function(obj) {
    var result = [];
    for (var keyName in obj) {
        result.push({key: keyName, value: obj[keyName]});
    }
    return result;

};

var propListToObj = function(propLst) {
    var result = {};
    for (var i = 0; i < propLst.length; i++) {
        result[propLst[i].key] = propLst[i].value;
    }
    return result;
};


var newQueueInstance = function(initVersion) {

    var nShifts = 0;
    var version = initVersion || 0;
    // always #entries in the queue >=1, adding a dummy op
    var pending = [{'changes': newChangeLog().deleteOp(null),
                    refCount: 0}];
    var that = {};

    that.find = function(ref, key) {
        var newOffset = ref.offset - (nShifts - ref.nShifts);
        for (var i = newOffset; i >= 0; i--) {
            var result = pending[i].changes.find(key);
            if (result) {
                return result;
            }
        }
        return undefined;
    };

    that.commit = function(target, ref, changes) {
        var newOffset = ref.offset - (nShifts - ref.nShifts);
        if ((pending.length - 1 === newOffset) &&
            (version === ref.version)) {
            if (changes.isEmpty()) {
                return ref;
            } else {
                version = version + 1;
                changes.cleanup();
                pending.push({'changes': changes, refCount: 0});
                return that.refreshRef(target, ref);
            }
        } else {
            assert.ok(false, 'Error: More than one writer');
            return undefined; // not reached
        }
    };

    that.refreshRef = function(target, ref) {
        that.deleteRef(target, ref);
        return that.newRef();
    };

    that.newRef = function() {
        var last = pending.length - 1;
        assert.ok(last >= 0, 'Error: empty queue, index=' + last);
        var ref = {nShifts: nShifts, version: version, offset: last};
        pending[last].refCount = pending[last].refCount + 1;
        return ref;
    };

    that.deleteRef = function(target, ref) {
        var newOffset = ref.offset - (nShifts - ref.nShifts);
        assert.ok(newOffset >= 0, 'Error: deleting invalid ref ' +
                  JSON.stringify(ref));
        pending[newOffset].refCount = pending[newOffset].refCount - 1;
        assert.ok(pending[newOffset].refCount >= 0, 'refCount negative' +
                  pending[newOffset].refCount + ' for ref ' +
                  JSON.stringify(ref));
        if ((newOffset === 0) && (pending[newOffset].refCount === 0)) {
            that.flush(target);
        }
    };

    that.flush = function(target) {
        while ((pending.length > 1) && // always leave one entry
            (pending[0].refCount === 0)) {
            var entry = pending.shift();
            nShifts = nShifts + 1;
            entry.changes.flush(target);
        }
    };

    that.toObject = function(target, ref) {
        var newOffset = ref.offset - (nShifts - ref.nShifts);
        for (var i = 0; i <= newOffset; i++) {
            pending[i].changes.flush(target);
        }
        return target;
    };

    return that;
};

var newUUID = function() {
    return new Buffer(crypto.randomBytes(15)).toString('base64');
};

var constructor = function(initState) {

    var that = {};
    var external = {};
    var base;
    var queue;
    var uuid;
    var hashMethods = {};
    var forwarder = null;

    if (initState && initState.properties &&
        (initState.version !== undefined) &&
        (initState.uuid !== undefined)) {
        base = propListToObj(initState.properties);
        queue = newQueueInstance(initState.version);
        uuid = initState.uuid;
    } else {
        base = {};
        queue = newQueueInstance();
        uuid = newUUID();
    }

    that.newRef = function() {
        return queue.newRef();
    };

    that.deleteRef = function(ref) {
        queue.deleteRef(base, ref);
    };

    that.refreshRef = function(ref) {
        return queue.refreshRef(base, ref);
    };

    that.get = function(ref, key) {
        var result = queue.find(ref, key);
        if (result) {
            return result.value;
        } else {
            return base[key];
        }
    };

    that.commit = function(ref, changes) {
        return queue.commit(base, ref, changes);
    };

    that.getMethod = function(strMethod) {
        var result = hashMethods[strMethod];
        if (!result) {
            var cleanStr = strMethod.substring(METHOD_HEADER.length);
            eval('result = ' + cleanStr);
            hashMethods[strMethod] = result;
        }
        return result;
    };

    /*
     * Sets a forwarder map that all proxies should use for future
     * transactions.
     *
     */
    that.setForwarder = function(newMap) {
        forwarder = newMap;
    };

    that.getForwarder = function() {
        return forwarder;
    };

    that.toObject = function(ref) {
        var clone = {};
        for (var key in base) {
            // no inherited properties
            clone[key] = base[key];
        }
        return queue.toObject(clone, ref);
    };


    var newProxy = function(isWriter) {
        var handler = {};
        var ref = that.newRef();
        var log = null;
        var proxy;
        var inTransaction = false;

        handler.__sharing_is_writer__ = function() {
            return isWriter;
        };

        handler.__sharing_set_forwarder__ = function(forwarder) {
            if (isWriter) {
                assert.ok(!inTransaction, '.__sharing_set_forwarder__: in ' +
                          + 'transaction,  changes will be lost');
                that.setForwarder(forwarder);
                return true;
            } else {
                return false;
            }
        };

        /**
         * Begins a transaction.
         *
         * Returs A new proxy that should be used for all future transactions
         * (i.e., forwarding  enabled) or null if the current
         * proxy is valid.
         */
        handler.__sharing_begin__ = function() {
            assert.ok(!inTransaction, '__sharing_begin__:Nested transactions' +
                      ' not supported');
            var forwarder = that.getForwarder();
            var newMe = null;
            if (forwarder) {
                // future transactions should use the forwarder.
                newMe = (isWriter ? forwarder.writer() : forwarder.reader());
                var result = newMe.__sharing_begin__();
                if (result) {
                    return result;
                } else {
                    //newMe has no other forwarder
                    return newMe;
                }
            } else {
                inTransaction = true;
                if (isWriter) {
                    log = newChangeLog();
                } else {
                    ref = that.newRef();
                }
                return null;
            }
        };

        handler.__sharing_abort__ = function() {
            inTransaction = false;
            if (isWriter) {
                log = null;
            } else {
                that.deleteRef(ref);
            }
        };

        handler.__sharing_prepare__ = function() {
            return log && {'changes': log.getChanges(),
                           'version' : ref.version,
                           'uuid' : uuid};
        };

        /**
         * Commits pending changes.
         *
         *  @return An object {error{Object=}, update{Object=}} with an
         * error string (first param)  or an update object (second
         * argument) that reflects all the changes (or null if no changes).
         */
        handler.__sharing_commit__ = function() {
            assert.ok(inTransaction, '__sharing_commit__:Not in transaction');
            inTransaction = false;
            var oldVersion = ref.version;
            if (isWriter) {
                ref = that.commit(ref, log);
            } else {
                that.deleteRef(ref);
            }
            var result = log && {'changes': log.getChanges(),
                                 'version' : oldVersion,
                                 'uuid' : uuid};
            log = null;
            return result;
        };

        handler.__sharing_destroy__ = function() {
            log = null;
            that.deleteRef(ref);
            ref = null;
        };

        handler.__sharing_version__ = function() {
            return ref.version;
        };

        handler.__sharing_uuid__ = function() {
            return uuid;
        };

        handler.__sharing_dump__ = function() {
            var obj = handler.toObject(ref);
            return {'properties' : (objToPropList(obj) || []),
                    'version' : (ref.version || 0),
                    'uuid' : uuid};
        };

        /**
         * Applies an update to a mirrored table.
         *
         * @param {Object} update A change set returned by a previous commit
         * of the master map.
         * @return An object {error{Object=}, update{Object=}} with an
         * error string (first param)  if we have skipped an update or
         * is the wrong table, and an update object (second param)
         * representing the changes of a future commit (or null if the update
         * was ignored).
         */
        handler.__sharing_update__ = function(update) {
            assert.ok(inTransaction, '__sharing_update__: Not in transaction');
            if ((uuid !== update.uuid) ||
                (update.version > ref.version)) {
                return {error: 'Error: invalid update' +
                        JSON.stringify(update)};
            } else if (update.version < ref.version) {
                // ignored
                return {update: null};
            } else {
                // current version
                log.bulkOp(update.changes);
                return {update: update.changes};
            }
        };

        /**
         * Whether this is a simple Map of a facade to a linked collections
         * of maps.
         */
        handler.__sharing_is_aggregate__ = function() {
            return false;
        };

        handler.get = function(proxy, name) {
            if (name.indexOf('__sharing_') === 0) {
                return function() {
                    return handler[name].apply(handler, arguments);
                };
            }
            var entry = log && log.find(name);
            var value = (entry ? entry.value : that.get(ref, name));
            if ((typeof value === 'string') &&
                (value.indexOf(METHOD_HEADER) === 0)) {
                    var method = that.getMethod(value);
                    return function() {
                        return method.apply(proxy, arguments);
                    };
                }
            return value;
        };

        handler.set = function(proxy, name, val) {
            assert.ok(inTransaction, 'set: Not in transaction');
            if (typeof val === 'function') {
                val = METHOD_HEADER + val();
            }
            log.setOp(name, val);
            return true;
        };

        handler.has = function(name) {
            if (name.indexOf('__sharing_') === 0) {
                // make them invisible
                return false;
            } else {
                return (handler.get(null, name) !== undefined);
            }
        };

        handler.delete = function(name) {
            log.deleteOp(name);
            return true;
        };

        handler.enumerate = function() {
            // no extra inherited properties
            return handler.keys();
        };
        handler.toObject = function(ref) {
            // this is slow...
            var obj = that.toObject(ref);
            log && log.flush(obj);
            return obj;
        };

        handler.keys = function() {
            return Object.keys(handler.toObject(ref));
        };

        handler.getOwnPropertyDescriptor = function(name) {
            var obj = handler.toObject(ref);
            return Object.getOwnPropertyDescriptor(obj, name);
        };

        proxy = Proxy.create(handler);
        return proxy;
    };


    external.writer = function() {
        return newProxy(true);
    };

    external.reader = function() {
        return newProxy(false);
    };

    external.forwarder = function() {
        return that.getForwarder();
    };

    return external;

};

exports.isUpdate = function(update) {
    return ((typeof update === 'object') &&
            (update.changes !== undefined) &&
            (update.version !== undefined) &&
            (update.uuid !== undefined));
};

exports.isDump = function(dump) {
    return ((typeof dump === 'object') &&
            (dump.properties !== undefined) &&
            (dump.version !== undefined) &&
            (dump.uuid !== undefined));
};


var Map = exports.Map = function(initState) {
    this.map = constructor(initState);

};

Map.prototype.writer = function() {
    while (this.map.forwarder()) {
        this.map = this.map.forwarder().map;
    }
   return this.map.writer();
};

Map.prototype.reader = function() {
    while (this.map.forwarder()) {
        this.map = this.map.forwarder().map;
    }
   return this.map.reader();
};

