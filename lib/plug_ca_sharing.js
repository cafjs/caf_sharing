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
 * Handles all the Shared Maps associated with one CA.
 *
 * The name of this component in a ca.json description should be `sharing`.
 *
 * @module caf_sharing/plug_ca_sharing
 * @augments external:caf_components/gen_plug_ca
 */
// @ts-ignore: augments not attached to a class
const caf_comp = require('caf_components');
const myUtils = caf_comp.myUtils;
const genPlugCA = caf_comp.gen_plug_ca;
const async = caf_comp.async;
const json_rpc = require('caf_transport').json_rpc;

exports.newInstance = async function($, spec) {
    try {
        //{name{string} : <SharedMap>}
        const maps = {};

        // {alias: <RefSharedMap>}, writable by app code, untrusted!
        const refMaps = {};

        //{alias : {name: string, isWritable: boolean, options: options}
        var mapsInfo = {};

        //{alias: <SharedMapUpdate>}
        var mapsUpdates = {};

        const that = genPlugCA.create($, spec);

        const mapIndex = function(alias, name) {
            return alias + '#' + name;
        };


        // transactional ops
        const target = {
            addMapImpl: function(isWritable, alias, name, options, cb0) {
                const cb1 = function(err, map) {
                    if (err) {
                        cb0(err);
                    } else {
                        maps[mapIndex(alias, name)] = map;
                        mapsInfo[alias] = {
                            name: name, isWritable: isWritable, options: options
                        };
                        cb0(null);
                    }
                };
                if (mapsInfo[alias] && maps[mapIndex(alias, name)]) {
                    $._.$.log &&
                        $._.$.log.warn("Ignoring addMap call: 'alias' in use:" +
                                       alias);
                    cb0(null);
                } else {
                    if (isWritable) {
                        $._.$.sharing.primary(name, options, cb1);
                    } else if (options && options.isAggregate) {
                        $._.$.sharing.aggregateOf(name, options, cb1);
                    } else {
                        $._.$.sharing.replicaOf(name, options, cb1);
                    }
                }
            },
            deleteMapImpl: function(alias, cb0) {
                const name = mapsInfo[alias].name;
                const isWritable = mapsInfo[alias].isWritable;
                const options = mapsInfo[alias].options;
                delete mapsInfo[alias];
                delete refMaps[alias];
                const map = name && maps[mapIndex(alias, name)];
                delete maps[mapIndex(alias, name)];
                if (map) {
                    if (isWritable) {
                        $._.$.sharing.unregisterPrimary(name, map);
                        cb0(null);
                    } else if (options && options.isAggregate) {
                        $._.$.sharing.unregisterAggregate(name, map, cb0);
                    } else {
                        $._.$.sharing.unregisterReplica(name, map, cb0);
                    }
                } else {
                    cb0(null);
                }
            }
        };

        that.__ca_setLogActionsTarget__(target);

        that.addMap = function(isWritable, alias, name, options) {
            const args = Array.prototype.slice.apply(arguments);
            if (isWritable && options && options.isAggregate) {
                const err = new Error('Aggregates cannot be writable');
                err['isWritable'] = isWritable;
                err['alias'] = alias;
                err['name'] = name;
                err['options'] = options;
                throw err;
            }
            if (!isWritable && options && options.initialValue) {
                const err = new Error('Read-only map with initial value');
                err['isWritable'] = isWritable;
                err['alias'] = alias;
                err['name'] = name;
                err['options'] = options;
                throw err;
            }
            that.__ca_lazyApply__('addMapImpl', args);
        };

        // eslint-disable-next-line
        that.deleteMap = function(alias) {
            const args = Array.prototype.slice.apply(arguments);
            that.__ca_lazyApply__('deleteMapImpl', args);
        };

        that.toFullName = function(name) {
            try {
                const split = json_rpc.splitName(name);
                if ((name.indexOf($.ca.__ca_getName__()) !== 0) ||
                    (split.length !== 3)) {
                    const err = new Error('Invalid name');
                    err.name = name;
                    throw err;
                }
                return name;
            } catch (_ignore) {
                // split length is 1
                return json_rpc.joinName($.ca.__ca_getName__(), name);
            }
        };

        /**
         *  Returns an array with all the Map (full) names.
         */
        that.getRefMaps = function() {
            return refMaps;
        };

        const isValidUpdate = function(alias) {
            const value = mapsInfo[alias];
            return (value && value.isWritable &&
                    (value.name.indexOf($.ca.__ca_getName__()) === 0));
        };

        // Framework methods
        const applyUpdates = function (cb0) {
            async.each(Object.keys(mapsUpdates),
                       function(alias, cb1) {
                           const value = mapsUpdates[alias];
                           const info = mapsInfo[alias];
                           if (isValidUpdate(alias) && info &&
                               info.isWritable) {
                               $._.$.sharing.updatePrimary(info, value, cb1);
                           } else {
                               const err = new Error('Invalid update');
                               err['alias'] = alias;
                               err['update'] = value;
                               err['info'] = info;
                               cb1(err);
                           }
                       }, cb0);
        };

        const super__ca_resume__ = myUtils.superior(that, '__ca_resume__');
        that.__ca_resume__ = function(cp, cb0) {
            mapsInfo = cp.mapsInfo;
            mapsUpdates = cp.mapsUpdates || {};
            async.series([
                function(cb1) {
                    // recreate maps
                    async.each(Object.keys(mapsInfo), function(alias, cb2) {
                        const value = mapsInfo[alias];
                        target.addMapImpl(value.isWritable, alias, value.name,
                                          value.options, cb2);
                    }, cb1);
                },
                function(cb1) {
                    //apply deltas in maps
                    applyUpdates(cb1);
                },
                function(cb1) {
                    // pending changes to add/delete maps
                    super__ca_resume__(cp, cb1);
                }
            ], cb0);
        };

        const super__ca_begin__ = myUtils.superior(that, '__ca_begin__');
        that.__ca_begin__ = function(msg, cb0) {

            Object.keys(refMaps).forEach(function(x) { delete refMaps[x];});
            mapsUpdates = {};

            const simpleMapInfo = Object.keys(mapsInfo).filter(function(alias) {
                return !(mapsInfo[alias].options &&
                         mapsInfo[alias].options.isAggregate);
            });
            simpleMapInfo.forEach(function(alias) {
                const map = maps[mapIndex(alias, mapsInfo[alias].name)];
                refMaps[alias] = map && map.ref(!mapsInfo[alias].isWritable);
            });

            const aggregateInfo = Object.keys(mapsInfo).filter(function(alias) {
                return (mapsInfo[alias].options &&
                        mapsInfo[alias].options.isAggregate);
            });
            async.each(aggregateInfo, function(alias, cb1) {
                const agg = maps[mapIndex(alias, mapsInfo[alias].name)];
                if (agg) {
                    agg.assemble(function(err, snapshot) {
                        if (err) {
                            cb1(err);
                        } else {
                            refMaps[alias] = snapshot;
                            cb1(null);
                        }
                    });
                } else {
                    cb1(null);
                }
            }, function(err) {
                if (err) {
                    cb0(err);
                } else {
                    super__ca_begin__(msg, cb0);
                }
            });
        };


        const super__ca_prepare__ = myUtils.superior(that, '__ca_prepare__');
        that.__ca_prepare__ = function(cb0) {
            const computeUpdates = function() {
                const result = {};
                Object.keys(mapsInfo).forEach(function(alias) {
                    const info = mapsInfo[alias];
                    if (info.isWritable) {
                        if (refMaps[alias] && refMaps[alias].hasChanged()) {
                            result[alias] = refMaps[alias].prepare();
                        }
                    }
                });
                return result;
            };

            super__ca_prepare__(function(err, data) {
                if (err) {
                    cb0(err, data);
                } else {
                    data.mapsInfo = mapsInfo;
                    mapsUpdates = computeUpdates();
                    data.mapsUpdates = mapsUpdates;
                    cb0(err, data);
                }
            });
        };

        const super__ca_commit__ = myUtils.superior(that, '__ca_commit__');
        that.__ca_commit__ = function(cb0) {
            super__ca_commit__(function(err) {
                if (err) {
                    cb0(err);
                } else {
                    applyUpdates(cb0);
                }
            });
        };

        const super__ca_shutdown__ = myUtils.superior(that, '__ca_shutdown__');
        that.__ca_shutdown__ = function(data, cb0) {
            if (that.__ca_isShutdown__) {
                cb0(null);
            } else {
                async.each(Object.keys(mapsInfo),
                           function(alias, cb1) {
                               target.deleteMapImpl(alias, cb1);
                           },
                           function(err) {
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
