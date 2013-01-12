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
 * A proxy to access Sharing Maps/Aggregates from handler code.
 *
 * Maps can contain both data and functions. To ensure that added functions
 * are serializable we use Harmony proxies and the following convention:
 *
 *     var $$ = this.$.sharing.$;
 *     $$.myMap.hello = function() {
 *            return "function(x) { console.log('got x');}"
 *           };
 *
 * and now we can call hello()
 *
 *     $$.myMap.hello("foo")   // prints 'got foo'
 *
 * we also have a well defined `this`:
 *
 *     $$.myMap.me = "antonio"
 *     $$.myMap.hello = function() {
 *            return "function(x) { console.log(this.me + ' got x');}"
 *           };
 *
 * and now
 *
 *     $$.myMap.hello("foo")   // prints 'antonio got foo'
 *
 * @name caf_sharing/proxy_sharing
 * @namespace
 * @augments gen_proxy
 */

/*
 * Warning: this class depends on Javascript support for Harmony proxies. Enable
 * proxies in node.js by starting with 'node --harmony-proxies'.
 *
 * Also, it needs node >=0.8 since the implementation of proxies
 * in early versions of V8 is quite buggy.
 *
 *  Note that proxies are likely to change in the final spec...
 *
 *
 */


var caf = require('caf_core');
var genProxy = caf.gen_proxy;

/**
 * Factory method to create a proxy to access Sharing Maps.
 *
 */
exports.newInstance = function(context, spec, secrets, cb) {

    var that = genProxy.constructor(spec, secrets);
    var sharing = secrets.sharing_ca;

    var myPrefix = function() {
        return secrets.myId + '_';
    };


    var toFullName = function(name) {
        return ((name.indexOf('_') === -1) ? myPrefix() + name : name);
    };

    /**
     * Creates or mirrors a new Sharing Map.
     *
     * The map will be active before this CA processes the next
     * message.
     *
     * @param {boolean} isMaster  True if this CA is the only
     * writer. False, if read-only.
     * @param {string} name A name for this map either scoped by its owner CA
     * or relative to this CA. Relative names must not contain '_' since
     * it is used as the separator.
     * @param {string} alias A short name that identifies this map in the
     * this.$.sharing.$ (aka $$) context.
     * @return {boolean} True if request ok, false if invalid arguments.
     *
     * @name caf_sharing/proxy_sharing#addMap
     * @function
     */
    that.addMap = function(isMaster, name, alias) {
        return sharing.addMap(isMaster, false, toFullName(name), alias);
    };


    /**
     * Creates a Sharing Aggregate.
     *
     * An Aggregate represents a collection of linked Maps, so that
     * queries are performed on the collection, and return an array
     * with all the results.
     *
     * There are no master Aggregates, we rely on changing the underlying
     * master Maps. By changing these Maps we can
     * modify both the query results and the set of Maps in the
     * collection, and this is handled transparently by the Aggregate.
     *
     * Maps use a well-defined key `__link_key__` with value an array
     * of linked Map names. The resulting graph can have cycles.
     *
     * @param {string} name A name for the root map in this aggregate
     * either scoped by its owner CA
     * or relative to this CA. Relative names must not contain '_' since
     * it is used as the separator.
     * @param {string} alias A short name that identifies this aggregate in the
     * this.$.sharing.$ (aka $$) context.
     * @return {boolean} True if request ok, false if invalid arguments.
     *
     * @name caf_sharing/proxy_sharing#addAggregate
     * @function
     *
     */
    that.addAggregate = function(name, alias) {
        return sharing.addMap(false, true, toFullName(name), alias);
    };

    /**
     *  Deletes a reference to a map.
     *
     * Even if it was a master map, contents of a master copy are not
     * destroyed from persistent storage.
     *
     * @param {string} name An alias, relative name, or full name of a map.
     * @return false if Map not present, true otherwise.
     *
     * @name caf_sharing/proxy_sharing#deleteMap
     * @function
     *
     */
    that.deleteMap = function(name) {
        return sharing.deleteMap(name);
    };

    /**
     *  @see caf_sharing/proxy_sharing#deleteMap
     *
     * @name caf_sharing/proxy_sharing#deleteAggregate
     * @function
     *
     */
    that.deleteAggregate = function(name) {
        return sharing.deleteMap(name);
    };

    /**
     * Gets the complete name of a map/aggregate.
     *
     * Maps are named after the CA that owns them.
     *
     * Therefore, a complete name is `caOwner_caLocalName_mapLocalName`
     *
     * @param {string} name A partial (or already complete) name for a map.
     * @return {string} A complete name for the map.
     *
     * @name caf_sharing/proxy_sharing#fullName
     * @function
     *
     */
    that.fullName = function(name) {
        return toFullName(name);
    };

    /**
     * Gets the complete name of a map/aggregate in parsed form.
     *
     *
     * @param {string} name A partial (or already complete) name for a map.
     * @return {{caOwner: string, caLocalName: string, mapLocalName: string}}
     *  A complete parsed name for the map.
     *
     * @name caf_sharing/proxy_sharing#fullParsedName
     * @function
     *
     */
    that.fullParsedName = function(name) {
        return that.parseName(toFullName(name));
    };

    /**
     * Parses a name of a map/aggregate in parsed form.
     *
     * Maps are named after the CA that owns them.
     *
     * Therefore, a complete name is `caOwner_caLocalName_mapLocalName`
     *
     * @param {string} name A partial (or complete) name for a map.
     * @return {{caOwner: string, caLocalName: string, mapLocalName: string}}
     *  A complete or partial parsed name for the map.
     *
     * @name caf_sharing/proxy_sharing#parseName
     * @function
     *
     */
    that.parseName = function(name) {
        var p = name.split('_');
        // owner or map names cannot have '_'
        var result = { caOwner: p.shift(), mapLocalName: p.pop()};
        result.caLocalName = p.join('_');
        return result;
    };

    /**
     * Converts a parsed name to string.
     *
     *
     * @param {{caOwner: string, caLocalName: string, mapLocalName:
     * string}|Array.<string>}} name A parsed name for a map.
     * @return {string} A complete or partial name for the map.
     *
     * @name caf_sharing/proxy_sharing#stringifyName
     * @function
     *
     */
    that.stringifyName = function(obj) {
        if (Array.isArray(obj)) {
            return obj.join('_');
        } else if (typeof obj === 'object') {
            var arr = [obj.caOwner, obj.caLocalName, obj.mapLocalName];
            return arr.join('_');
        } else if (typeof obj === 'string') {
            return obj;
        } else {
            return null;
        }
    };

    var handler = {};

    handler.get = function(proxy, name) {
        return sharing.getMap(name);
    };

    handler.set = function(proxy, name, val) {
        throw new Error('$ context is read-only');
    };

    handler.has = function(name) {
        return (sharing.getMap(name) !== undefined);
    };

    handler.delete = function(name) {
        throw new Error('$ context is read-only');
    };

    handler.enumerate = function() {
        // no extra inherited properties
        return handler.keys();
    };

    handler.keys = function() {
        return sharing.getMapNames();
    };

    /**
     * A harmony proxy referring to all the maps and aggregates
     *  visible to this CA.
     *
     * Code refer to these maps using aliases/names as follows:
     *
     *    this.$.sharing.$.myMap
     *
     * and this is typically shortened as follows:
     *
     *    var $$ = this.$.sharing.$
     *
     *    $$.myMap.x =  $$.myMap.y + 1
     *
     */
    that.$ = Proxy.create(handler);

    Object.freeze(that);
    cb(null, that);
};
