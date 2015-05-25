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
 * Handles all the Shared Maps associated with one CA.
 *
 * The name of this component in a ca.json description should be `sharing`.
 *
 * @name caf_sharing/plug_ca_sharing
 * @namespace
 * @augments caf_components/gen_plug_ca
 */

var caf_comp = require('caf_components');
var myUtils = caf_comp.myUtils;
var genPlugCA = caf_comp.gen_plug_ca;
var async = caf_comp.async;
var assert = require('assert');
var json_rpc = require('caf_transport').json_rpc;

/**
 * Factory method to create a plug for this CA's Sharing Maps.
 *
 * @see caf_components/supervisor
 */
exports.newInstance = function($, spec, cb) {

    try {

        //{name{string} : <SharedMap>}
        var maps = {};

        // {alias: <RefSharedMap>}, writable by app code, untrusted!
        var refMaps = {};

        //{alias : {name: string, isWritable: boolean, options: options}
        var mapsInfo = {};

        //{alias: <SharedMapUpdate>}
        var mapsUpdates = {};

        var that = genPlugCA.constructor($, spec);


        // transactional ops
        var target = {
            addMapImpl: function(isWritable, alias, name, options, cb0) {
                var cb1 = function(err, map) {
                    if (err) {
                        cb0(err);
                    } else {
                        maps[name] = map;
                        mapsInfo[alias] = {name : name, isWritable: isWritable,
                                           options: options};
                        cb0(null);
                    }
                };

                if (isWritable) {
                    $._.$.sharing.master(name, options, cb1);
                } else {
                    $._.$.sharing.slaveOf(name, options, cb1);
                }
            },
            deleteMapImpl: function(alias, cb0) {
                var name = mapsInfo[alias].name;
                var isWritable = mapsInfo[alias].isWritable;
                delete mapsInfo[alias];
                delete refMaps[alias];
                var map = name &&  maps[name];
                if (map) {
                    delete maps[name];
                    if (isWritable) {
                        $._.$.sharing.unregisterMaster(name, map);
                        cb0(null);
                    } else {
                        $._.$.sharing.unregisterSlave(name, map, cb0);
                    }
                } else {
                    cb0(null);
                }
            }
        };

        that.__ca_setLogActionsTarget__(target);

        that.addMap = function(isWritable, alias, name, options) {
            var args = Array.prototype.slice.apply(arguments);
            that.__ca_lazyApply__("addMapImpl", args);
        };

        that.deleteMap = function(alias) {
            var args = Array.prototype.slice.apply(arguments);
            that.__ca_lazyApply__("deleteMapImpl", args);
        };

        that.toFullName = function(name) {
            try {
                var split = json_rpc.splitName(name);
                if ((name.indexOf($.ca.__ca_getName__()) !== 0) ||
                    (split.length !== 3)) {
                    var err = new Error('Invalid name');
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

        var isValidUpdate = function(alias, update) {
            var value = mapsInfo[alias];
            return (value && value.isWritable &&
                    (value.name.indexOf($.ca.__ca_getName__()) === 0));
        };

        // Framework methods
        var applyUpdates = function (cb0) {
            async.each(Object.keys(mapsUpdates),
                       function(alias, cb1) {
                           var value = mapsUpdates[alias];
                           var info = mapsInfo[alias];
                           if (isValidUpdate(alias, value) && info &&
                               info.isWritable) {
                               $._.$.sharing
                                   .updateMaster(info, value, cb1);
                           } else {
                               var err = new Error('Invalid update');
                               err.alias = alias;
                               err.update = value;
                               err.info = info;
                               cb1(err);
                           }
                       }, cb0);
        };

        var super__ca_resume__ = myUtils.superior(that, '__ca_resume__');
        that.__ca_resume__ = function(cp, cb0) {
            mapsInfo = cp.mapsInfo;
            mapsUpdates = cp.mapsUpdates || {};
            async.series([
                function(cb1) {
                    // recreate maps
                    async.each(Object.keys(mapsInfo), function(alias, cb2) {
                        var value = mapsInfo[alias];
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

        var super__ca_begin__ = myUtils.superior(that, '__ca_begin__');
        that.__ca_begin__ = function(msg, cb0) {
            Object.keys(refMaps).forEach(function(x) { delete refMaps[x];});
            mapsUpdates = {};
            Object.keys(mapsInfo).forEach(function(alias) {
                refMaps[alias] = maps[mapsInfo[alias].name].ref();
            });
            super__ca_begin__(msg, cb0);
        };


        var super__ca_prepare__ = myUtils.superior(that, '__ca_prepare__');
        that.__ca_prepare__ = function(cb0) {
            var computeUpdates = function() {
                var result = {};
                Object.keys(mapsInfo).forEach(function(alias) {
                    var info = mapsInfo[alias];
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

        var super__ca_commit__ = myUtils.superior(that, '__ca_commit__');
        that.__ca_commit__ = function(cb0) {
            super__ca_commit__(function(err, data) {
                if (err) {
                    cb0(err);
                } else {
                    applyUpdates(cb0);
                }
            });
        };

        var super__ca_shutdown__ = myUtils.superior(that, '__ca_shutdown__');
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

        cb(null, that);
    } catch (err) {
        cb(err);
    }
};
