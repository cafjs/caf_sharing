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

var caf = require('caf_core');
var async = caf.async;
var Spine = require('./Spine').Spine;

/**
 * Aggregate implements linked local name spaces. Each map
 * has a set of key/value pairs that represent a local name space and a
 * well-known key that always resolves to a list of maps (i.e., linking to
 *  other
 * name spaces). To find out all the values associated with a particular key
 * we obtained all the maps
 * in the transitive closure of looking up that well-known key, and do a
 * lookup in each of them for that particular key. Then, we aggregate the
 * results in an array.
 *
 * A map in an aggregate is a conventional (slave) read-only map
 * that transactionally changes when its corresponding master changes. Since
 * individual maps in an aggregate can change at any time,
 * we need to obtain a global snapshot before doing lookups, and this is
 * an asynchronous operation since the tables involved could change and may
 * need to be loaded. We do that with method assemble(cb) (that implicitly
 * starts a transaction in each map).
 *
 * Our main use for this class is security, representing ACLs that can be
 * delegated to other principals. In that case keys are principal's unique
 * names and values permissions associated to that principal.
 *
 */
var DEFAULT_LINK_KEY = '__link_key__';


var constructor = function(builder, rootMapName, linkKey) {

    var maps = {};

    var that = {};

    var allMapsF = function(f, result) {
        result = result || [];
        for (var mapName in maps) {
            var map = maps[mapName];
            var value = f(mapName, map);
             if (value !== undefined) {
                result.push(value);
            }
        }
        return result;
    };


    that.assemble = function(cb) {
        // {mapName : boolean}
        var alreadyVisited = {};
        var assembleOne = function(name, cb0) {
            if (alreadyVisited[name]) {
                cb0(null, null);
            } else {
                var value = maps[name];
                if (value !== undefined) {
                    alreadyVisited[name] = true;
                    var newMap = value.__sharing_begin__();
                    if (newMap) {
                        value = newMap;
                        maps[name] = newMap;
                    }
                    var linkedMaps = value[linkKey] || [];
                    async.forEach(linkedMaps, assembleOne, cb0);
                } else {
                    var cb1 = function(err, newMap) {
                        if (err) {
                            cb0(err);
                        } else {
                            maps[name] = newMap;
                            assembleOne(name, cb0);
                        }
                    };
                    builder.slaveOf(name, cb1);
                }
            }
        };
        var cleanup = function(cb0) {
            var toClean = allMapsF(function(mapName, map) {
                                       if (!alreadyVisited[mapName]) {
                                           delete maps[mapName];
                                           return {name: mapName, map: map};
                                       } else {
                                           return undefined;
                                       }
                                   });
            async.forEach(toClean, builder.unregisterSlave, cb0);
        };
        async.series([function(cb0) {
                           assembleOne(rootMapName, cb0);
                       },
                       function(cb0) {
                           cleanup(cb0);
                       }
                     ], cb);
    };


    that.lookup = function(key) {
        return allMapsF(function(mapName, map) { return map[key]; });
    };

    that.__sharing_is_aggregate__ = function() {
        return true;
    };

    that.__sharing_commit__ = function() {
        allMapsF(function(mapName, map) { map.__sharing_commit__(); });
    };

    that.__sharing_abort__ = function() {
        allMapsF(function(mapName, map) { map.__sharing_abort__(); });
    };

    that.unregister = function(cb) {
        var keyVal = allMapsF(function(mapName, map) {
                                  return {name: mapName, map: map};
                              });
        async.forEach(keyVal, builder.unregisterSlave, cb);
    };

// for compatibility with Map
    that.__sharing_prepare__ = function() {
        return undefined;
    };

    return that;
};


var spineToBuilder = function(spine) {
    return {
        unregisterSlave: function(keyVal, cb) {
            return spine.unregisterSlave(keyVal.map, cb);
        },
        slaveOf: function(name, cb) {
            var cb0 = function(err, newMap) {
                if (err) {
                    cb(err, newMap);
                } else {
                    cb(err, newMap.reader());
                }
            };
            return spine.slaveOf(name, cb0);
        }
    };
};

var plugToBuilder = function(plug) {
    return {
        unregisterSlave: function(keyVal, cb) {
            return plug.unregisterSlave(keyVal.name, cb);
        },
        slaveOf: function(name, cb) {
            return plug.slaveOf(name, cb);
        }
    };
};

/*
 * builder type is {unregisterSlave: function({name, map}, cb),
 * slaveOf : function(name, cb)}
 *
 */
var toBuilder = function(provider) {
    return ((provider instanceof Spine) ? spineToBuilder(provider) :
            plugToBuilder(provider));
};

/*
 *  provider is either of type Spine or plug_sharing.
 *
 * rootMapName is the name of the top level map
 *
 * linkKey is the key that identifies the list of related map names.
 *
 */

var Aggregate = exports.Aggregate = function(provider, rootMapName, linkKey) {
    this.builder = toBuilder(provider);
    this.rootMapName = rootMapName;
    this.linkKey = linkKey || DEFAULT_LINK_KEY;
};

Aggregate.prototype.reader = function() {
    return constructor(this.builder, this.rootMapName, this.linkKey);
};
