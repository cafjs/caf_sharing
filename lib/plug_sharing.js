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
 * Plug that maintains replicas of Shared Maps accessed by local CAs,  and
 *  connects to backend services for their persistance, and tracking of updates.
 *
 * The name of this component in `framework.json` should be `sharing`.
 *
 * Properties:
 *
 *      { persistService: string, routeService: string}
 *
 *  where `persistService`, e.g., `cp`, checkpoints Shared Maps, and
 * `routeService`, e.g., `cp2`, propagates updates to replicas.
 *  See {@link external:caf_redis} for details.
 *
 * @module caf_sharing/plug_sharing
 * @augments external:caf_components/gen_plug
 */
// @ts-ignore: augments not attached to a class
var caf_comp = require('caf_components');
var async = caf_comp.async;
var myUtils = caf_comp.myUtils;
var genPlug = caf_comp.gen_plug;
var assert = require('assert');
var SharedMap = require('./SharedMap').SharedMap;
var AggregateMap = require('./AggregateMap').AggregateMap;

exports.newInstance = async function($, spec) {
    try {
        var that = genPlug.constructor($, spec);
        $._.$.log && $._.$.log.debug('New Sharing plug');

        assert.equal(typeof spec.env.persistService, 'string',
                     "'spec.env.persistService' is not a string");
        var persist = spec.env.persistService;

        assert.equal(typeof spec.env.routeService, 'string',
                     "'spec.env.routeService' is not a string");
        var route = spec.env.routeService;

        /* <name> ->  <SharedMap> */
        var primaries = {};

        /* <name> -> {map : <SharedMap>, count : <number> , options: Object}*/
        var replicas = {};

        /* <name> -> {map : <AggregateMap>, count : <number>, options: Object}*/
        var aggregates = {};

        that.primary = function(name, options, cb0) {
            try {
                var result = primaries[name];
                if (result) {
                    cb0(null, result);
                } else {
                    var cb1 = function(err, mapDump) {
                        if (err) {
                            $._.$.log &&
                                $._.$.log.debug('Cannot create writable Map ' +
                                                name);
                            cb0(err);
                        } else {
                            try {
                                var map = SharedMap();
                                map.applyChanges(mapDump);
                                primaries[name] = map;
                                cb0(null, map);
                            } catch (error) {
                                cb0(error);
                            }
                        }
                    };
                    var initialValue = (options && options.initialValue) ||
                            null;
                    $._.$[persist].createMap(name, initialValue, cb1);
                }
            } catch (err) {
                cb0(err);
            }
        };

        var subscribe = function(name, map, cb0) {
            var handler = function (err, changes) {
                try {
                    map.applyChanges(changes);
                } catch (error) {
                    try {
                        $._.$.log &&
                            $._.$.log.debug('Cannot apply replica update ' +
                                            JSON.stringify(changes) + ' to ' +
                                            name);
                        $._.$[persist].readMap(name, function(err, mapDump) {
                            if (err) {
                                that.__ca_shutdown__(null, function(error) {
                                    err.shutdownError = error;
                                    $._.$.log && $._.$.log
                                        .debug('Shutdown sharing plug' +
                                               myUtils.errToPrettyStr(err));
                                });
                            } else {
                                map.applyChanges(mapDump);
                            }
                        });
                    } catch (ex) {
                        that.__ca_shutdown__(null, function(error) {
                            ex.shutdownError = error;
                            $._.$.log &&
                                $._.$.log.debug('Shutdown sharing plug' +
                                                myUtils.errToPrettyStr(ex));
                        });
                    }
                }
            };

            try {
                $._.$[route].subscribeMap(name, handler, cb0);
            } catch (err) {
                cb0(err);
            }
        };

        that.replicaOf = function(name, options, cb0) {
            var result = replicas[name];
            if (result && result.map) {
                result.count = result.count + 1;
                cb0(null, result.map);
            } else {
                var cb1 = function(err, mapDump) {
                    if (err) {
                        $._.$.log &&
                            $._.$.log.debug('Cannot create replica Map ' +
                                            name);
                        cb0(err);
                    } else {
                        try {
                            var map = SharedMap();
                            map.applyChanges(mapDump);
                            subscribe(name, map, function (error) {
                                if (error) {
                                    cb0(error);
                                } else {
                                    replicas[name] = {
                                        map: map, count: 1, options: options
                                    };
                                    cb0(null, map);
                                }
                            });
                        } catch (error) {
                            cb0(error);
                        }
                    }
                };

                try {
                    $._.$[persist].readMap(name, cb1);
                } catch (err) {
                    cb1(err);
                }
            }
        };

        that.aggregateOf = function(name, options, cb0) {
            var result = aggregates[name];
            if (result && result.map) {
                result.count = result.count + 1;
                cb0(null, result.map);
            } else {
                var agg = AggregateMap(name, function(mapName, cb1) {
                    that.replicaOf(mapName, null, cb1);// do not pass options
                }, options && options.linkKey);
                aggregates[name] = {map: agg, count: 1, options: options};
                cb0(null, agg);
            }
        };

        that.updatePrimary = function(info, changes, cb0) {
            try {
                var result = primaries[info.name];
                if (result && info.isWritable) {
                    result.applyChanges(changes);
                    var cb1 = function(err, data) {
                        if (err) {
                            that.unregisterPrimary(info.name, result);
                            cb0(err);
                        } else {
                            cb0(err, data);
                        }
                    };
                    $._.$[persist].updateMap(info.name, changes, cb1);
                } else {
                    var err = new Error('Invalid update');
                    err['info'] = info;
                    err['changes'] = changes;
                    cb0(err);
                }
            } catch (err) {
                cb0(err);
            }
        };

        that.unregisterPrimary = function(name, map) {
            var result = primaries[name];
            if (result && (result === map)) {
                delete primaries[name];
            } else {
                $._.$.log && $._.$.log.debug('Ignored unregister primary Map ' +
                                             name);
            }
        };

        var derefCount = function(result, map, name, cleanF, nothingF) {
            if (result && (result.map === map)) {
                result.count = result.count - 1;
                assert.ok(result.count >= 0, 'Negative replica count for ' +
                          name);
                if (result.count === 0) {
                    cleanF();
                } else {
                    nothingF();
                }
            } else {
                $._.$.log && $._.$.log.debug('Ignoring unregister ' + name);
                nothingF();
            }
        };

        that.unregisterReplica = function(name, map, cb0) {
            var result = replicas[name];
            derefCount(result, map, name,
                       function() {
                           delete replicas[name];
                           try {
                               $._.$[route].unsubscribeMap(name, cb0);
                           } catch (ex) {
                               cb0(ex);
                           }
                       }, function() { cb0(null);});
        };

        that.unregisterAggregate = function(name, agg, cb0) {
            var result = aggregates[name];
            derefCount(result, agg, name,
                       function() {
                           delete aggregates[name];
                           var depMaps = result.map.getMaps();
                           async.each(Object.keys(depMaps), function(x, cb1) {
                               that.unregisterReplica(x, depMaps[x], cb1);
                           }, cb0);
                       }, function() { cb0(null);});
        };

        var super__ca_shutdown__ = myUtils.superior(that, '__ca_shutdown__');
        that.__ca_shutdown__ = function(data, cb0) {
            if (that.__ca_isShutdown__) {
                cb0(null);
            } else {
                async.each(Object.keys(replicas),
                           function(name, cb1) {
                               try {
                                   $._.$[route].unsubscribeMap(name, cb1);
                               } catch (ex) {
                                   cb1(ex);
                               }
                           },
                           function(err) {
                               primaries = {};
                               replicas = {};
                               aggregates = {};
                               if (err) {
                                   cb0(err);
                               } else {
                                   super__ca_shutdown__(data, cb0);
                               }
                           });
            }
        };

        return [null, that];
    } catch (err) {
        return [err];
    }
};
