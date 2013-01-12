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
 * Plug that maintains Maps that are shared by all the local CAs  and connects
 * to backend services for their persistance and updates.
 *
 * The name of this component in framework.json should be sharing_mux
 *
 * @name caf_sharing/plug_sharing
 * @namespace
 * @augments gen_plug
 */

var caf = require('caf_core');
var genPlug = caf.gen_plug;
var async = caf.async;
var Spine = require('./Spine').Spine;
var Aggregate = require('./Aggregate').Aggregate;
var assert = require('assert');

/**
 * Factory method to create a sharing service connector.
 *
 */
exports.newInstance = function(context, spec, secrets, cb) {

    var $ = context;

    /* <name> ->  <Map> */
    var masters = {};

    /* <name> -> {map : < Map>, count : < integer> }*/
    var slaves = {};

    //use default redis service for both Persist and Route
    var cfSpineConf = {persist: { service: $.cf &&
                                  $.cf.getServiceConfig('redis')}};

    var spineConf = (spec && spec.env && spec.env.spine) || cfSpineConf;

    var spine = new Spine(spineConf);

    var that = genPlug.constructor(spec, secrets);


    that.master = function(name, cb0) {
        var result = masters[name];
        if (result) {
            // create new writer to detect errors if multiple concurrent writers
            cb0(null, result.writer());
        } else {
            var cb1 = function(err, map) {
                if (err) {
                    $.log && $.log.debug('Cannot create master Map ' + name);
                    cb0(err);
                } else {
                    masters[name] = map;
                    cb0(null, map.writer());
                }
            };
            spine.master(name, cb1);
        }
    };

    that.slaveOf = function(name, cb0) {
        var result = slaves[name];
        if (result && result.map && (result.count !== undefined)) {
            result.count = result.count + 1;
            cb0(null, result.map.reader());
        } else {
            var cb1 = function(err, map) {
                if (err) {
                    $.log && $.log.debug('Cannot create slave Map ' + name);
                    cb0(err, map);
                } else {
                    slaves[name] = {map: map, count: 1};
                    cb0(null, map.reader());
                }
            };
            spine.slaveOf(name, cb1);
        }
    };

    that.aggregate = function(name, cb0) {
        var aggr = new Aggregate(that, name);
        cb0(null, aggr.reader());
    };

    that.update = function(updates, cb0) {
        async.forEach(updates, function(update, cb1) {
                          spine.update(update, cb1);
                      }, cb0);
    };

    that.unregisterSlave = function(name,  cb0) {
        var result = slaves[name];
        if (result && result.count) {
            result.count = result.count - 1;
            assert.ok(result.count >= 0, 'Negative slave count for ' + name);
            if (result.count === 0) {
                delete slaves[name];
                spine.unregisterSlave(result.map.reader(), cb0);
            } else {
                cb0(null, null);
            }
        } else {
            $.log && $.log.debug('Ignoring unregister slave Map ' + name);
            cb0(null, null);
        }
    };

    that.unregisterAggregate = function(aggregate, cb0) {
        aggregate.unregister(cb0);
    };

    that.unregisterMaster = function(name, cb0) {
        var result = masters[name];
        if (result) {
            delete masters[name];
            spine.unregisterMaster(result.writer(), cb0);
        } else {
            $.log && $.log.debug('Ignoring unregister master Map ' + name);
            cb0(null, null);
        }
    };

    var shutdownMasters = function(cb0) {
        var all = [];
        for (var name in masters) {
            var mapW = masters[name].writer();
            all.push(function(cb1) {
                         spine.unregisterMaster(mapW, cb1);
                     });
        }
        masters = {};
        async.parallel(all, cb0);
    };

    var shutdownSlaves = function(cb0) {
        var all = [];
        for (var name in slaves) {
            var mapR = slaves[name].map.reader();
            all.push(function(cb1) {spine.unregisterSlave(mapR, cb1);});
        }
        slaves = {};
        async.parallel(all, cb0);
    };

    var super_shutdown = that.superior('shutdown');
    that.shutdown = function(ctx, cb0) {
        if (that.isShutdown) {
            // do nothing, return OK
            cb0(null, that);
        } else {
            async.series([
                             function(cb1) {
                                 shutdownMasters(cb1);
                             },
                             function(cb1) {
                                 shutdownSlaves(cb1);
                             },
                             function(cb1) {
                                 super_shutdown(ctx, cb1);
                             }
                         ], cb0);
        }
    };


    $.log && $.log.debug('New sharing plug');
    var cb0 = function(err, data) {
        if (err) {
            cb(err, data);
        } else {
            cb(null, that);
        }
    };
    spine.init(cb0);
};
