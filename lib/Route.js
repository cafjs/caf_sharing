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

var plug_route = require('./plug_route');

/**
 * Wrapper class for plug_route to use Maps outside the
 * CA framework.
 *
 */

/**
 * Constructor
 *
 * config type is {service : {hostname: <string>, port : <number>,
 * password : <string>}, recoveryInterval : <number>}
 */
var Route = exports.Route = function(config) {
    this.spec = {env: {redis: config.service,
                        recoveryInterval: config.recoveryInterval}};
};



/*
 * Initializes the connection to the routing service.
 *
 */
Route.prototype.init = function(cb) {
    var self = this;
    var cb1 = function(err, data) {
        if (err) {
            cb(err);
        } else {
            self.route = data;
            cb(err, data);
        }
    };
    plug_route.newInstance({}, this.spec, {}, cb1);
};


Route.prototype.master = function(name, map, cb) {
    this.route && this.route.master(name, map, cb);
};

Route.prototype.propagateUpdate = function(update, cb) {
    this.route && this.route.propagateUpdate(update, cb);
};

Route.prototype.unregisterMaster = function(uuid, cb) {
    this.route && this.route.unregisterMaster(uuid, cb);
};

Route.prototype.deleteMaster = function(uuid, cb) {
    this.route && this.route.deleteMaster(uuid, cb);
};

Route.prototype.slaveOf = function(name, cb) {
    this.route && this.route.slaveOf(name, cb);
};

Route.prototype.unregisterSlave = function(uuid, cb) {
    this.route && this.route.unregisterSlave(uuid, cb);
};

Route.prototype.resolve = function(name, cb) {
    this.route && this.route.resolve(name, cb);
};

Route.prototype.shutdown = function(cb) {
    this.route && this.route.shutdown({}, cb);
    this.route = null;
};
