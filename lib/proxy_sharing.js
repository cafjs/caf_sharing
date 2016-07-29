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
 * A proxy to access shared maps from handler code.
 *
 *
 * @name caf_sharing/proxy_sharing
 * @namespace
 * @augments caf_components/gen_proxy
 */
var caf_comp = require('caf_components');
var genProxy = caf_comp.gen_proxy;

/**
 * Factory method to create a proxy to access Sharing Maps.
 *
 * @see caf_components/supervisor
 *
 */
exports.newInstance = function($, spec, cb) {

    var that = genProxy.constructor($, spec);

    /**
     * Creates, or reloads if already created, a writable Shared Map.
     *
     * The map will be active before this CA processes another message.
     *
     * @param {string} alias A short name that identifies this map in the
     * this.$.sharing.$ (aka $$) context.
     * @param {string} name A relative name for this map that will be scoped by
     *  this CA's name.
     * @param {caf_map.options=} options
     *
     * @name caf_sharing/proxy_sharing#addMap
     * @function
     */
    that.addWritableMap = function(alias, name, options) {
        $._.addMap(true, alias, $._.toFullName(name), options || {});
    };


    /**
     * Creates a read-only mirror of a Shared Map (or an Aggregate Map).
     *
     * The map will be active before this CA processes another message. However,
     * we only provide timeline consistency, and local replicas could be stale.
     *
     * Type of caf_map.options is {isAggregate: boolean}
     *
     * @param {string} alias A short name that identifies this map in the
     * this.$.sharing.$ (aka $$) context.
     * @param {string} name A fully qualified name for this map, i.e., scoped
     *  with the owner's CA name (`caOwner-caLocalName-mapLocalName`).
     *
     * @param {caf_map.options=} options If options.isAggregate create an
     *  AggregateMap not a simple SharedMap.
     *
     * @name caf_sharing/proxy_sharing#addMap
     * @function
     */
    that.addReadOnlyMap = function(alias, name, options) {
        $._.addMap(false, alias, name, options || {});
    };

    /**
     *  Deletes a local reference to a map.
     *
     * The contents of the map  are never destroyed from persistent storage.
     *
     * @param {string} alias The local alias for this map.
     *
     * @name caf_sharing/proxy_sharing#deleteMap
     * @function
     *
     */
    that.deleteMap = function(alias) {
        $._.deleteMap(alias);
    };

    /**
     * Returns an incremental update or a full dump of the map, depending on
     * whether deltas are still available.
     *
     * The type of caf.mapUpdate  is {version: number, remove : Array<string>,
     *                                add : Array<string|Object>} where 'add'
     * just flattens key/value pairs in a single array.
     *
     *
     * @param {string} alias The local alias for this map.
     * @param {number} version The current version of the replicated map.
     * @return {caf.mapUpdate | Array.<caf.mapUpdate>} A full dump of the map
     * or a list with incremental updates (empty if up to date).
     *
     * @name caf_sharing/proxy_sharing#pullUpdate
     * @function
     */
    that.pullUpdate = function(alias, version) {
        var result = that.$[alias].updatesSlice(version);
        if (result === null) {
            result = that.$[alias].dump();
        }
        return result;
    };

    /**
     * Applies a change set to a writable map.
     *
     * This method is typically used to replicate external maps.
     *
     * @param {string} alias The local alias for this map.
     * @param {caf.mapUpdate} changes A set of changes to apply
     * @param {caf.log=} logger An optional logger, i.e., `this.$.log`.
     *
     * @throws Error If change set  version not compatible.
     * @name caf_sharing/proxy_sharing#applyDelta
     * @function
     */
    that.applyDelta = function(alias, changes, logger) {
        var ref = that.$[alias];
        if (changes.version > ref.getVersion()) {
            var err = new Error('Incompatible version: missed update');
            err.originalVersion = ref.getVersion();
            err.version = changes.version;
            throw err;
        } else if (changes.version < ref.getVersion()) {
            logger && logger.debug('Ignoring old update ' +
                                   JSON.stringify(changes));
        } else {
            changes.remove.forEach(function(x) {ref.delete(x);});
            var key = null;
            changes.add.forEach(function(x, i) {
                if (i%2 === 0) {
                    key = x;
                } else {
                    ref.set(key, x);
                }
            });
        }
    };

    /**
     * Gets the complete name of a local writable map.
     *
     * Maps are named after the CA that owns them.
     *
     * Therefore, a complete name is `caOwner-caLocalName-mapLocalName`
     *
     * @param {string} name A local name for a map.
     * @return {string} A complete name for the map.
     *
     * @name caf_sharing/proxy_sharing#fullName
     * @function
     *
     */
    that.fullName = function(name) {
        return $._.toFullName(name);
    };


    /**
     * A context referring to all the Shared Maps visible to this CA.
     *
     * Application code refers to these maps using aliases/names as follows:
     *
     *    this.$.sharing.$.myMap
     *
     * and this is typically shortened as follows:
     *
     *    var $$ = this.$.sharing.$
     *
     *    $$.myMap.set('x', $$.myMap.get('y') + 1)
     *
     * @name caf_sharing/proxy_sharing#$
     */
    that.$ = $._.getRefMaps();

    Object.freeze(that);
    cb(null, that);
};
