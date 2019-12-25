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
 * `AggregateMap` links a set of Shared Maps so that a query return the values
 * in any of them.
 *
 * The set of maps is defined by a starting entry map and a well-known key in
 * any map that links to other  maps in the set. We compute the transitive
 * closure to find this set.
 *
 *  The main use of AggregateMap is implementing  linked local name spaces
 * (SDSI) for authorization.
 *
 * @module caf_sharing/AggregateMap
 */
var caf_comp = require('caf_components');
var async = caf_comp.async;

var DEFAULT_LINK_KEY = '__link_key__';

/**
 * Constructor.
 *
 * An object that links a set of Shared Maps. Queries return values
 * in any of them.
 *
 *
 *
 * @param {string} firstMapName Starting map name.
 * @param {function(string, cbType):void} findMap A function with signature
 * `function(string, cbType):void` to return a map in the callback. The first
 * argument to `findMap` is the map name.
 * @param {string=} linkKey Optional default link key. The default is
 *`__link_key__`.
 *
 * @memberof! module:caf_sharing/AggregateMap
 * @alias AggregateMap
*/
exports.AggregateMap = function(firstMapName, findMap, linkKey) {
    var maps = {};

    var that = {};

    linkKey = linkKey || DEFAULT_LINK_KEY;


    /**
     * Scans the linked maps to create a consistent snapshot.
     *
     * @param {cbType} cb A callback to return a reference to the snapshot.
     * A snapshot implements a function `getAll(key:string):Array.<Object>`
     * that finds all the values for a particular key in a collection of maps.
     *
     * @memberof! module:caf_sharing/AggregateMap#
     * @alias assemble
     */
    that.assemble = function(cb) {
        var refThat = {};
        var refMaps = {};

        /*
         * Finds all the values for a particular key in a collection of maps.
         *
         * @param {string} key A key to lookup.
         *
         * @return {Array.<Object>} A collection of values (could
         * include duplicates) for that key. An empty array means no bindings.
         *
         */
        refThat.getAll = function(key) {
            var result = [];
            Object.keys(refMaps).forEach(function(mapName) {
                var mapRef = refMaps[mapName];
                if (mapRef.has(key)) {
                    result.push(mapRef.get(key));
                }
            });
            return result;
        };

        var traverse = function(mapName, cb0) {
            var ref = refMaps[mapName];
            var all = ref.get(linkKey);
            if (Array.isArray(all)) {
                async.map(all, function(x, cb1) {
                    assembleOne(x, cb1);
                }, cb0);
            } else {
                cb0(null);
            }
        };

        var assembleOne = function(mapName, cb0) {
            if (refMaps[mapName]) {
                cb0(null);
            } else if (maps[mapName]) {
                refMaps[mapName] = maps[mapName].ref(true);
                traverse(mapName, cb0);
            } else {
                var cb1 = function(err, map) {
                    if (err) {
                        cb0(err);
                    } else {
                        maps[mapName] = map;
                        refMaps[mapName] = maps[mapName].ref(true);
                        traverse(mapName, cb0);
                    }
                };
                findMap(mapName, cb1);
            }
        };

        assembleOne(firstMapName, function(err) {
            if (err) {
                cb(err);
            } else {
                cb(null, refThat);
            }
        });
    };

    /**
     * Gets all the searched Shared Maps.
     *
     * @return {Object} An object with keys the names of the linked maps, and
     * with values containing references to maps.
     *
     * @memberof! module:caf_sharing/AggregateMap#
     * @alias getMaps
     */
    that.getMaps = function() {
        return maps;
    };

    return that;
};
