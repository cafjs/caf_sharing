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
 * Plug to access a persistence service for maps.
 *
 * @name caf_sharing/plug_persist_lua
 * @namespace
 * @augments gen_redis_plug
 */

var caf = require('caf_core');
var genRedisPlug = caf.gen_redis_plug;
var async = caf.async;
var redis = caf.redis;

/*
 *
 * KEYS uuid
 * ARGV key value pairs with map keys prefixed by 'properties:' and
 * values JSON serialized strings
 */
var luaCreate =
'if redis.call("exists", KEYS[1]) == 1 then \
   return {err = "CA " .. KEYS[1] .. " already exists"} \
else \
   return redis.call("hmset", KEYS[1], unpack(ARGV)) \
end';

/*
 * KEYS uuid
 *
 */
var luaRead =
'if redis.call("exists", KEYS[1]) == 0 then \
   return nil \
else \
   return redis.call("hgetall", KEYS[1]) \
end';


var luaDelete =
'return redis.call("del", KEYS[1])';

/*
 * KEYS uuid
 *
 * ARGV[1] version
 * ARGV[2] #number of deleted hash keys
 * ARGV[3].. ARGV[ARGV[2] +2] deleted keys
 * ARGV[ARGV[2] +3] ... added key value pairs
 */
var luaUpdate =
'local deleteKeys = {} \
local addedProps = {} \
local numDeleteKeys = tonumber(ARGV[2]) \
local numAddedProps = #ARGV - numDeleteKeys -2 \
if redis.call("exists", KEYS[1]) == 0 then \
   return {err = "CA " .. KEYS[1] .. " does not exist"} \
elseif ARGV[1]  ~= redis.call("hget", KEYS[1], "version") then \
   return  {err = "CA " .. KEYS[1] .. " version " .. ARGV[1] .. \
            " does not match"} \
else \
   if numDeleteKeys > 0 then \
      for  i = 1, numDeleteKeys, 1 do \
         deleteKeys[i] = ARGV[i+2] \
      end \
      redis.call("hdel", KEYS[1], unpack(deleteKeys)) \
   end \
   for i = 1, numAddedProps, 1 do \
      addedProps[i] = ARGV[numDeleteKeys + 2 + i] \
   end \
   return redis.call("hmset", KEYS[1], unpack(addedProps)) \
end';



var luaAll = {
    create: luaCreate,
    read: luaRead,
    update: luaUpdate,
    delete : luaDelete
};

var flattenUpdate = function(update) {
    var result = [];
    result.push(JSON.stringify(update.version));
    var delKeys = [];
    var updatePairs = [];
    for (var i = 0; i < update.changes.length; i++) {
        var obj = update.changes[i];
        if (obj.value) {
            updatePairs.push('properties:' + obj.key);
            updatePairs.push(JSON.stringify(obj.value));
        } else {
            delKeys.push('properties:' + obj.key);
        }
    }
    result.push(delKeys.length);
    result = result.concat(delKeys);
    result = result.concat(updatePairs);
    result.push('version');
    result.push(JSON.stringify(update.version + 1));

    /* result is <version
     *  | #number of deleted hash keys
     *  | deleted keys
     *  | added key value pairs
     *  | increment version > */
     return result;
};

var flattenDump = function(dump) {
    var result = [];
    for (var keyName in dump) {
        if ('properties' === keyName) {
            var props = dump[keyName];
            for (var i = 0; i < props.length; i++) {
                result.push('properties:' + props[i].key);
                result.push(JSON.stringify(props[i].value));
            }
        } else {
            result.push(keyName);
            result.push(JSON.stringify(dump[keyName]));
        }
    }
    return result;
};

var inflateDump = function(flatDump) {
    var result = {};
    var properties = [];
    var prefixLength = 'properties:'.length;
    for (var i = 0; i < (flatDump.length) / 2; i++) {
        if (flatDump[2 * i].indexOf('properties:') === 0) {
            var obj = {key: flatDump[2 * i].slice(prefixLength),
                       value: JSON.parse(flatDump[2 * i + 1])};
            properties.push(obj);
        } else {
            result[flatDump[2 * i]] = JSON.parse(flatDump[2 * i + 1]);
        }
    }
    result.properties = properties;
    return result;
};

/**
 * Factory method to create a persistence service for maps.
 */
exports.newInstance = function(context, spec, secrets, cb) {


    var $ = context;

    $.log && $.log.debug('New map persistence plug');

    if ($.log && $.log.isActive('TRACE')) {
        redis.debug_mode = true;
    }

    var that = genRedisPlug.constructor(spec, secrets);

    /**
     * Writes a map to persistent storage if there are no other maps with
     *  the same uuid.
     *
     */
    that.create = function(dump, cb) {
        that.doLuaOp('create', [dump.uuid], flattenDump(dump), cb);
    };

    /**
     *  Reads a map from persistent storage.
     *
     */
    that.read = function(uuid, cb) {
        var cb0 = function(err, flatDump) {
            if (err) {
                cb(err, flatDump);
            } else {
                cb(err, flatDump && inflateDump(flatDump));
            }
        };
        that.doLuaOp('read', [uuid], [], cb0);
    };

    /**
     * Incrementally updates a map in persistent storage if version number
     *  and uuid match.
     *
     */
    that.update = function(newUpdate, cb) {
        that.doLuaOp('update', [newUpdate.uuid], flattenUpdate(newUpdate), cb);
    };

    /**
     * Deletes a map from persistent storage
     *
     */
    that.delete = function(uuid, cb) {
        that.doLuaOp('delete', [uuid], [], cb);
    };

    that.initClient($, $.cf && $.cf.getServiceConfig('redis'), luaAll, cb);


};
