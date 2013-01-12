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

var plug_persist = require('./plug_persist_lua');

/**
 * Wrapper class for plug_persist_lua to use Maps outside the
 * CA framework.
 *
 */

/**
 * Constructor
 *
 * @param {{service: {hostname: string, port: number,
 * password: string}}} config Configuration data for persist.
 * @constructor
 */
var Persist = exports.Persist = function(config) {
    this.spec = {env: {redis: config.service}};
};

/*
 * Initializes the connection to the persistent service.
 *
 */
Persist.prototype.init = function(cb) {
    var self = this;
    var cb1 = function(err, data) {
        if (err) {
            cb(err);
        } else {
            self.persist = data;
            cb(err, data);
        }
    };
    plug_persist.newInstance({}, this.spec, {}, cb1);
};

/**
 * Writes a map to persistent storage if there are no other maps with the same
 *  uuid.
 *
 */
Persist.prototype.create = function(dump, cb) {
    this.persist.create(dump, cb);
};

/**
 *  Reads a map from persistent storage.
 *
 */
Persist.prototype.read = function(uuid, cb) {
    this.persist.read(uuid, cb);
};

/**
 * Incrementally updates a map in persistent storage if version number and uuid
 * match.
 *
 */
Persist.prototype.update = function(newUpdate, cb) {
    this.persist.update(newUpdate, cb);
};

/**
 * Deletes a map from persistent storage
 *
 */
Persist.prototype.delete = function(map, cb) {
    var uuid = map.__sharing_uuid__();
    this.persist.delete(uuid, cb);
};

/**
 * Shutdowns the connection to the server.
 *
 */
Persist.prototype.shutdown = function(cb) {
    this.persist.shutdown({}, cb);
};

/**
 * Create an alias for a map. A map can have multiple aliases but
 * an alias resolves to one map.
 *
 * @param {string} name An alias for a map.
 * @param {string} uuid A unique identifier for a map.
 * @param {function(Object=)} cb A standard callback with an optional
 * error argument.
 */
Persist.prototype.alias = function(name, uuid, cb) {
    this.persist.alias(name, uuid, cb);
};


/**
 * Resolves an alias to a map  identifier.
 *
 * @param {string} name An alias for a map.
 * @param {function(Object=, string | null)} cb A standard callback with
 * and optional error argument and a UUID argument (null or string) with
 * the map identifier.
 */
Persist.prototype.resolve = function(name, cb) {
    this.persist.resolve(name, cb);
};
