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
 * Top level class to connect to Persist and Route services.
 *
 * @module caf_sharing/Spine
 */
var caf = require('caf_core');
var async = caf.async;
var Map = require('./Map').Map;
var Persist = require('./Persist').Persist;
var Route = require('./Route').Route;

/**
 * Constructor
 *
 * config type is {persist : <persistConfigType>, route :<routeConfigType>}
 *
 * @constructor
 *
 */
var Spine = exports.Spine = function(config) {
    var persistConfig = config.persist;
    var routeConfig = config.route;
    if (!routeConfig) {
        routeConfig = persistConfig;
    }
    if (!persistConfig) {
        persistConfig = routeConfig;
    }
    this.persist = new Persist(persistConfig);
    this.route = new Route(routeConfig);
};


Spine.prototype.init = function(cb) {
    var self = this;
    async.series([
                     function(cb0) {
                         self.route.init(cb0);
                     },
                     function(cb0) {
                         self.persist.init(cb0);
                     }
                 ], cb);
};

Spine.prototype.master = function(name, cb) {
    var self = this;
    var map;
    var mapR;
    async.waterfall([
                        function(cb0) {
                            self.route.resolve(name, cb0);
                        },
                        function(uuid, cb0) {
                            if (uuid === null) {
                                cb0(null, null);
                            } else {
                                self.persist.read(uuid, cb0);
                            }
                        },
                        function(dump, cb0) {
                            if (dump === null) {
                                map = new Map();
                                mapR = map.reader();
                                dump = mapR.__sharing_dump__();
                                var cb1 = function(err, data) {
                                    if (err) {
                                        cb0(err, data);
                                    } else {
                                        cb0(err, dump);
                                    }
                                };
                                self.persist.create(dump, cb1);
                            } else {
                                cb0(null, dump);
                            }
                        },
                        function(dump, cb0) {
                            map = map || new Map(dump);
                            mapR = mapR || map.reader();
                            self.route.master(name, mapR, cb0);
                        }
                    ], function(err, ignore) {
                        if (err) {
                            cb(err, ignore);
                        } else {
                            cb(err, map);
                        }
                    });
};

Spine.prototype.unregisterMaster = function(map, cb) {
    this.route.unregisterMaster(map.__sharing_uuid__(), cb);
};

Spine.prototype.deleteMaster = function(map, cb) {
    var self = this;
    async.series([
                     function(cb0) {
                         self.route.deleteMaster(map, cb0);
                     },
                     function(cb0) {
                         self.persist.delete(map, cb0);
                     }
                 ], cb);
};

Spine.prototype.slaveOf = function(name, cb) {
    this.route.slaveOf(name, cb);
};

Spine.prototype.unregisterSlave = function(map, cb) {
    this.route.unregisterSlave(map.__sharing_uuid__(), cb);
};

Spine.prototype.update = function(update, cb) {
    var self = this;
    async.series([
                     function(cb0) {
                         self.persist.update(update, cb0);
                     },
                     function(cb0) {
                         self.route.propagateUpdate(update, cb0);
                 }], cb);
};


