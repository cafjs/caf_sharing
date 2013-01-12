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

/**
 * Handles all the Sharing Maps/Aggregates associated with one CA.
 *
 * The name of this component in a ca.json description should be sharing_ca.
 *
 * @name caf_sharing/plug_ca_sharing
 * @namespace
 * @augments gen_transactional
 */

var caf = require('caf_core');
var genTransactional = caf.gen_transactional;
var async = caf.async;
var assert = require('assert');

//{op : 'addMap', name : <string>, isMaster : <boolean>,
//  isAggregate : <boolean>, alias : <string>}
var addMapOp = function(isMaster,  isAggregate, name, alias) {
    return {op: 'addMap', name: name, isMaster: isMaster,
             isAggregate: isAggregate, alias: alias};
};

//{op : 'deleteMap', name : <string>}
var deleteMapOp = function(name) {
    return {op: 'deleteMap', name: name};
};

var toLog = function(info) {
    var result = [];
    for (var mapName in info) {
        result.push(info[mapName]);
    }
    return result;
};

/**
 * Factory method to create a plug for this CA's Sharing Maps.
 *
 * @see sup_main
 */
exports.newInstance = function(context, spec, secrets, cb) {

    var $ = context;
    var logActions = [];

    //{name{string} : <map>}
    var maps = {};

    //{name{string} : <addMapOp>}
    var mapsInfo = {};

    // {alias{string} : name{string}}
    var aliases = {};

    // {name{string} : <update>}
    var mapUpdates = {};

    var that = genTransactional.constructor(spec, secrets);
    // The name of any master Map should be prefixed by CA name
    var prefix = secrets.myId + '_';

    var toFullName = function(name) {
        return ((name.indexOf('_') === -1) ? prefix + name : name);
    };

    /**
     * Returns a reference to a locally cached Map.
     *
     * @param {string} name A name for this Map.
     *
     */
    that.getMap = function(name) {
        var fullName = aliases[name];
        fullName = (fullName ? fullName : name);
        return maps[fullName];
    };

    /**
     *  Returns an array with all the Map (full) names.
     */
    that.getMapNames = function() {
        return Object.keys(maps);
    };

    /**
     * Requests a new Map for this CA.
     *
     * @param {boolean} isMaster True if master (writeable), false if slave
     * (read-only).
     * @param {boolean} isAggregate True if it is a collection of linked maps,
     * false if it is just a map.
     * @param {string} name A name for this Map.
     * @param {string} alias A more convenient name for this Map.
     *
     * @return false if request invalid, true otherwise.
     *
     */
    that.addMap = function(isMaster, isAggregate, name, alias) {
        if (mapsInfo[name]) {
            // slave or master but not both.
            return false;
        } else {
            if (isMaster) {
                if (name && (name.indexOf(prefix) === 0)) {
                    logActions.push(addMapOp(isMaster, isAggregate, name,
                                             alias));
                } else {
                    $.log && $.log.warn('Ignoring an added Map :' + name +
                                        ' not prefixed by ' + prefix);
                    return false;
                }
            } else {
                // TO DO: enforce visibility constraints based on owner
                logActions.push(addMapOp(isMaster, isAggregate, name, alias));
            }
            return true;
        }
    };

    /**
     * Unregisters a Map.
     *
     * @param {string} name A name for this Map.
     * @return false if Map not present, true otherwise.
     *
     */
    that.deleteMap = function(name) {
        if (mapsInfo[name]) {
            logActions.push(deleteMapOp(name));
            return true;
        } else {
            return false;
        }
    };

    var unregister = function(name, cb0) {
        var entry = mapsInfo[name];
        if (entry) {
            if (entry.isMaster) {
                $.sharing_mux.unregisterMaster(name, cb0);
            } else if (entry.isAggregate) {
                maps[name] &&
                    $.sharing_mux.unregisterAggregate(maps[name], cb0);
            } else {
                $.sharing_mux.unregisterSlave(name, cb0);
            }
        } else {
            cb0(null, null);
        }
    };

    var replayLog = function(cb0) {
        var iterF = function(action, cb1) {
            switch (action.op) {
            case 'addMap' :
                var cb2 = function(err, map) {
                    if (err) {
                        cb1(err, map);
                    } else {
                        maps[action.name] = map;
                        mapsInfo[action.name] = action;
                        if (action.alias) {
                            aliases[action.alias] = action.name;
                        }
                        cb1(err, map);
                    }
                };
                if (action.isMaster) {
                    $.sharing_mux.master(action.name, cb2);
                } else if (action.isAggregate) {
                    $.sharing_mux.aggregate(action.name, cb2);
                } else {
                    $.sharing_mux.slaveOf(action.name, cb2);
                }
                break;
            case 'deleteMap':
                var name = (aliases[action.name] ? aliases[action.name] :
                            toFullName(action.name));
                var cb3 = function(err, map) {
                    if (err) {
                        cb1(err, map);
                    } else {
                        delete maps[name];
                        delete mapsInfo[name];
                        delete aliases[action.name];
                        cb1(err, map);
                    }
                };
                unregister(name, cb3);
                break;
            default:
                throw new Error('CA Sharing: invalid log action ' +
                                action.op);
            }
        };
        async.forEachSeries(logActions, iterF, function(err, data) {
                                if (err) {
                                    $.log && $.log.debug('Error in replayLog ' +
                                                         err);
                                    cb0(err, data);
                                } else {
                                    logActions = [];
                                    cb0(err, data);
                                }
                            });
    };

    var replayUpdates = function(updatesObj, cb0) {
        var updates = [];
        for (var mapName in updatesObj) {
            var map = maps[mapName];
            if (map) {
                assert.ok(!map.__sharing_is_aggregate__(),
                          'Aggregates are read-only');
                var newMap = map.__sharing_begin__();
                if (newMap) {
                    map = newMap;
                    maps[mapName] = newMap;
                }
                var up = map.__sharing_update__(updatesObj[mapName]);
                map.__sharing_commit__();
                if (up && up.update) {
                    updates.push(updatesObj[mapName]);
                }
            }
        }
        $.sharing_mux.update(updates, cb0);
    };


    // Framework methods

    that.__ca_init__ = function(cb0) {
        logActions = [];
        cb0(null);
    };

    that.__ca_resume__ = function(cp, cb0) {
        cp = cp || {};
        mapsInfo = cp.mapsInfo || {};
        async.series([
                         function(cb1) {
                             // recreate original Maps
                             logActions = toLog(mapsInfo);
                             replayLog(cb1);
                         },
                         function(cb1) {
                             // (re)apply committed changes
                             replayUpdates(cp.mapUpdates || {}, cb1);
                         },
                         function(cb1) {
                             // add or delete Maps
                             logActions = cp.logActions || [];
                             replayLog(cb1);
                         }
                     ], cb0);
    };

    that.__ca_begin__ = function(msg, cb0) {
        logActions = [];
        mapUpdates = {};
        var aggregates = [];
        for (var mapName in maps) {
            var map = maps[mapName];
            if (!map.__sharing_is_aggregate__()) {
                var newMap = map.__sharing_begin__();
                if (newMap) {
                    maps[mapName] = newMap;
                }
            } else {
                aggregates.push(mapName);
            }
        }
        var assembleF = function(aggName, cb1) {
            maps[aggName].assemble(cb1);
        };
        async.forEach(aggregates, assembleF, cb0);
    };

    that.__ca_prepare__ = function(cb0) {
        mapUpdates = {};
        for (var mapName in maps) {
            var update = maps[mapName].__sharing_prepare__();
            if (update && (update.changes.length > 0)) {
                mapUpdates[mapName] = update;
            }
        }
        cb0(null, JSON.stringify({'mapsInfo' : mapsInfo,
                                  'logActions' : logActions,
                                  'mapUpdates' : mapUpdates}));
    };

    that.__ca_commit__ = function(cb0) {
        async.series([
                         function(cb1) {
                             for (var mapName in maps) {
                                 maps[mapName].__sharing_commit__();
                             }
                             var updates = toLog(mapUpdates);
                             mapUpdates = {};
                             $.sharing_mux.update(updates, cb1);
                         },
                         function(cb1) {
                             replayLog(cb1);
                         }
                      ], cb0);
    };

    that.__ca_abort__ = function(cb0) {
        logActions = [];
        mapUpdates = {};
        for (var mapName in maps) {
            maps[mapName].__sharing_abort__();
        }
        cb0(null);
    };


    var super_shutdown = that.superior('shutdown');
    that.shutdown = function(ctx, cb0) {
        if (that.isShutdown) {
            // do nothing, return OK
            cb0(null, that);
        } else {
            var cb1 = function(err, data) {
                if (err) {
                    cb0(err);
                } else {
                    maps = {};
                    mapsInfo = {};
                    super_shutdown(ctx, cb0);
                }
            };
            async.forEachSeries(Object.keys(mapsInfo), unregister, cb1);
        }
    };

    cb(null, that);

};
