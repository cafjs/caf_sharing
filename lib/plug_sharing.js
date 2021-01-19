// Modifications copyright 2020 Caf.js Labs and contributors
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
const caf_comp = require('caf_components');
const async = caf_comp.async;
const myUtils = caf_comp.myUtils;
const genPlug = caf_comp.gen_plug;
const assert = require('assert');
const SharedMap = require('./SharedMap').SharedMap;
const AggregateMap = require('./AggregateMap').AggregateMap;

exports.newInstance = async function($, spec) {
    try {
        const that = genPlug.create($, spec);
        $._.$.log && $._.$.log.debug('New Sharing plug');

        assert.equal(typeof spec.env.persistService, 'string',
                     "'spec.env.persistService' is not a string");
        const persist = spec.env.persistService;

        assert.equal(typeof spec.env.routeService, 'string',
                     "'spec.env.routeService' is not a string");
        const route = spec.env.routeService;

        /* <name> ->  <SharedMap> */
        const primaries = {};

        /* <name> -> {map : <SharedMap>, count : <number> , options: Object}*/
        const replicas = {};

        /* <name> -> {map : <AggregateMap>, count : <number>, options: Object}*/
        const aggregates = {};

        that.primary = function(name, options, cb0) {
            try {
                const result = primaries[name];
                if (result) {
                    cb0(null, result);
                } else {
                    const cb1 = function(err, mapDump) {
                        if (err) {
                            $._.$.log &&
                                $._.$.log.debug('Cannot create writable Map ' +
                                                name);
                            cb0(err);
                        } else {
                            try {
                                const map = SharedMap();
                                map.applyChanges(mapDump);
                                primaries[name] = map;
                                cb0(null, map);
                            } catch (error) {
                                cb0(error);
                            }
                        }
                    };
                    const initialValue = (options && options.initialValue) ||
                            null;
                    $._.$[persist].createMap(name, initialValue, cb1);
                }
            } catch (err) {
                cb0(err);
            }
        };

        const subscribe = function(name, map, cb0) {
            const handler = function (err, changes) {
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
            const result = replicas[name];
            if (result && result.map) {
                result.count = result.count + 1;
                cb0(null, result.map);
            } else {
                const cb1 = function(err, mapDump) {
                    if (err) {
                        $._.$.log &&
                            $._.$.log.debug('Cannot create replica Map ' +
                                            name);
                        if (options.bestEffort) {
                            cb0(null, null); // set Map to `null` to allow retry
                        } else {
                            cb0(err);
                        }
                    } else {
                        try {
                            const map = SharedMap();
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
            const result = aggregates[name];
            if (result && result.map) {
                result.count = result.count + 1;
                cb0(null, result.map);
            } else {
                const agg = AggregateMap(name, function(mapName, cb1) {
                    // Always use `bestEffort` to avoid blocking CA forever
                    that.replicaOf(mapName, {bestEffort: true}, cb1);
                }, options && options.linkKey);
                aggregates[name] = {map: agg, count: 1, options: options};
                cb0(null, agg);
            }
        };

        that.updatePrimary = function(info, changes, cb0) {
            try {
                const result = primaries[info.name];
                if (result && info.isWritable) {
                    result.applyChanges(changes);
                    const cb1 = function(err, data) {
                        if (err) {
                            that.unregisterPrimary(info.name, result);
                            cb0(err);
                        } else {
                            cb0(err, data);
                        }
                    };
                    $._.$[persist].updateMap(info.name, changes, cb1);
                } else {
                    const err = new Error('Invalid update');
                    err['info'] = info;
                    err['changes'] = changes;
                    cb0(err);
                }
            } catch (err) {
                cb0(err);
            }
        };

        that.unregisterPrimary = function(name, map) {
            const result = primaries[name];
            if (result && (result === map)) {
                delete primaries[name];
            } else {
                $._.$.log && $._.$.log.debug('Ignored unregister primary Map ' +
                                             name);
            }
        };

        const derefCount = function(result, map, name, cleanF, nothingF) {
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
            const result = replicas[name];
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
            const result = aggregates[name];
            derefCount(result, agg, name,
                       function() {
                           delete aggregates[name];
                           const depMaps = result.map.getMaps();
                           async.each(Object.keys(depMaps), function(x, cb1) {
                               that.unregisterReplica(x, depMaps[x], cb1);
                           }, cb0);
                       }, function() { cb0(null);});
        };

        const super__ca_shutdown__ = myUtils.superior(that, '__ca_shutdown__');
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
                               myUtils.deleteProps(primaries);
                               myUtils.deleteProps(replicas);
                               myUtils.deleteProps(aggregates);
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
