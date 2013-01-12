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
 * Plug to a service that propagates map updates.
 *
 * @name caf_sharing/plug_route
 * @namespace
 * @augments gen_redis_plug
 */
var caf = require('caf_core');
var redis = caf.redis;
var genPlug = caf.gen_plug;
var genRedisPlug = caf.gen_redis_plug;
var async = caf.async;
var Map = require('./Map');

// redis.debug_mode = true;

/*
 * Master subscribes to channel master_{uuid}
 * Slaves subscribe to channel slave_{uuid}
 *
 * Messages: Slave -> Master (published in channel master_{uuid})
 *           {version : version_number} i.e., request to
 * replay updates from version_number till current (0 for full dump)
 *
 * Messages: Master ->Slave (published in channel slave_{uuid})
 *           {<dump:JSON serialized full contents>}
 *           {<update : JSON serialized incremental update>}
 *
 */


var ALIAS_KEY = '__sharing_aliases__';

/**
 * Factory method to connect to a routing service for Map updates.
 *
 */
exports.newInstance = function(context, spec, secrets, cb) {

    var $ = context;

    $.log && $.log.debug('New map route plug');

    if ($.log && $.log.isActive('TRACE')) {
        redis.debug_mode = true;
    }

    var handlers = {};

    var pub = genRedisPlug.constructor(spec, secrets);
    var sub = genRedisPlug.constructor(spec, secrets);

    var that = genPlug.constructor(spec, secrets);

    // rate limit the number of full updates propagated
    var recoveryIntervalMsec = (spec && spec.env &&
                                spec.env.recoveryInterval || 0.1) * 1000;


    var masterHandler = function(map) {
        var channel = 'slave_' + map.__sharing_uuid__();
        var dump;
        var pending = null;
        return function(msg) {
            // refresh map proxy
            map.__sharing_begin__();
            map.__sharing_commit__();
            dump = JSON.stringify(map.__sharing_dump__());
            //rate limited but sent to all
            if (pending === null) {
                pending = setTimeout(
                    function() {
                        // always send the most recent dump
                        pub.getClientRedis().publish(channel, dump);
                        pending = null;
                    }, recoveryIntervalMsec);
            }
        };
    };


    that.master = function(name, map, cb0) {
        async.series([function(cb1) {
                          pub.getClientRedis().hset(ALIAS_KEY, name,
                                                    map.__sharing_uuid__(),
                                                    cb1);
                      },
                      function(cb1) {
                          var channel = 'master_' + map.__sharing_uuid__();
                          handlers[channel] = masterHandler(map);
                          sub.getClientRedis().subscribe(channel, cb1);
                      }], cb0);
    };

    that.propagateUpdate = function(update, cb0) {
        var channel = 'slave_' + update.uuid;
        pub.getClientRedis().publish(channel, JSON.stringify(update), cb0);
    };

    var slaveHandler = function(newTableF) {
        var slaveWriter;
        return function(msg) {
            var change = JSON.parse(msg);
            if (Map.isDump(change) &&
                (!slaveWriter ||
                 (change.version > slaveWriter.__sharing_version__()))) {
                var map = new Map.Map(change);
                if (slaveWriter) {
                    slaveWriter.__sharing_set_forwarder__(map);
                    slaveWriter = slaveWriter.__sharing_begin__();
                    slaveWriter.__sharing_commit__();//noop
                } else {
                    slaveWriter = map.writer();
                    newTableF(null, map);
                }
            } else if (Map.isUpdate(change) && slaveWriter) {
                if (change.version === slaveWriter.__sharing_version__()) {
                    var newSlaveWriter = slaveWriter.__sharing_begin__();
                    slaveWriter = (newSlaveWriter ?
                                   newSlaveWriter : slaveWriter);
                    var resp = slaveWriter.__sharing_update__(change);
                    if (resp.error) {
                        $.log && $.log.debug('Slave: Ignoring bad update ' +
                                             msg);
                    }
                    slaveWriter.__sharing_commit__();
                } else if (change.version > slaveWriter.__sharing_version__()) {
                    // we have missed an update, recover...
                    var channel = 'master_' + slaveWriter.__sharing_uuid__();
                    var request = {version: slaveWriter.__sharing_version__()};
                    pub.getClientRedis().publish(channel,
                                                 JSON.stringify(request));
                } else {
                    $.log && $.log.trace('Slave: Ignoring update ' + msg);
                }
            } else {
                $.log && $.log.trace('Slave: Ignoring msg ' + msg);
            }
        };
    };

    that.resolve = function(name, cb0) {
        pub.getClientRedis().hget(ALIAS_KEY, name, cb0);
    };

    that.slaveOf = function(name, cb0) {
        var uuid;
        var alreadyAnswered = false;
        var cb2 = function(err, map) {
            if (!alreadyAnswered) {
                alreadyAnswered = true;
                cb0(err, map);
            }
        };
        async.waterfall([function(cb1) {
                             that.resolve(name, cb1);
                         },
                         function(id, cb1) {
                             uuid = id;
                             if (uuid === null) {
                                 cb1('Master with name ' + name + ' not found');
                             } else {
                                 var slaveCh = 'slave_' + uuid;
                                 handlers[slaveCh] = slaveHandler(cb2);
                                 sub.getClientRedis().subscribe(slaveCh, cb1);
                             }
                         },
                         function(ignore, cb1) {
                             var masterCh = 'master_' + uuid;
                             var msg = JSON.stringify({ version: 0});
                             pub.getClientRedis().publish(masterCh, msg, cb1);
                         }
                        ], function(err, ignore) {
                            if (err && !alreadyAnswered) {
                                alreadyAnswered = true;
                                if (uuid) {
                                    delete handlers['slave_' + uuid];
                                }
                                cb0(err);
                            }
                            /* Otherwise slaveHandler will call cb0 when the
                             *  map is ready.
                             */
                        });
    };

    var unregister = function(id, cb0) {
        if (handlers[id]) {
            delete handlers[id];
            // leave name/uuid bindings, they are valid until overwritten
            sub.getClientRedis().unsubscribe(id, cb0);
        }
    };


    that.unregisterMaster = function(uuid, cb0) {
        unregister('master_' + uuid, cb0);
    };

    that.unregisterSlave = function(uuid, cb0) {
        unregister('slave_' + uuid, cb0);
    };

    that.deleteMaster = function(uuid, cb0) {
        // TO DO: need to delete alias
        that.unregisterMaster(uuid, cb0);
    };

    that.unregisterAll = function(cb0) {
        async.forEach(Object.keys(handlers), unregister, cb0);
    };


    var super_shutdown = that.superior('shutdown');
    that.shutdown = function(ctx, cb0) {
        if (that.isShutdown) {
            // do nothing, return OK
            cb0(null, that);
        } else {
            async.series([
                             function(cb1) {
                                 if (!sub.isShutdown) {
                                     that.unregisterAll(cb1);
                                 } else {
                                     cb1(null);
                                 }
                             },
                             function(cb1) {
                                 if (!sub.isShutdown) {
                                     sub.shutdown(ctx, cb1);
                                 } else {
                                     cb1(null);
                                 }
                             },
                             function(cb1) {
                                 if (!pub.isShutdown) {
                                     pub.shutdown(ctx, cb1);
                                 } else {
                                     cb1(null);
                                 }
                             },
                             function(cb1) {
                                 super_shutdown(ctx, cb1);
                             }
                         ], cb0);
        }
    };

    var seriesF = [
        function(cb0) {
            sub.initClient($, $.cf && $.cf.getServiceConfig('redis'), {}, cb0);
        },
        function(cb0) {
            sub.getClientRedis()
                .on('message',
                    function(channel, message) {
                        var handler = handlers[channel];
                        if (handler) {
                            handler(message);
                        } else {
                            $.log && $.log.debug('No handler for ' + message);
                        }
                    });
            cb0(null);
        },
        function(cb0) {
            pub.initClient($, $.cf && $.cf.getServiceConfig('redis'), {}, cb0);
        }
    ];
    async.series(seriesF, function(err, data) {
                     if (err) {
                         cb(err, data);
                     } else {
                         cb(err, that);
                     }
                 });

};
