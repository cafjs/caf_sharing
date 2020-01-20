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
 * A proxy to access Shared Maps from application code.
 *
 *
 * @module caf_sharing/proxy_sharing
 * @augments external:caf_components/gen_proxy
 *
 */
// @ts-ignore: augments not attached to a class
const caf_comp = require('caf_components');
const genProxy = caf_comp.gen_proxy;

exports.newInstance = async function($, spec) {

    const that = genProxy.create($, spec);

    /**
     * Creates, or reloads if already created, a writable Shared Map.
     *
     * The map will be active before this CA processes another message.
     *
     * @param {string} alias A short name that identifies this map in the
     * `this.$.sharing.$` context.
     * @param {string} name A relative name for this map that will be scoped by
     *  this CA's name.
     * @param {mapOptionsType=} options With field `initialValue`, an optional
     * initial value for the map. Note that this value is ignored if the map
     *  was already initialized.
     *
     * @memberof! module:caf_sharing/proxy_sharing#
     * @alias addWritableMap
     */
    that.addWritableMap = function(alias, name, options) {
        $._.addMap(true, alias, $._.toFullName(name), options || {});
    };


    /**
     * Creates a read-only mirror of a Shared Map or an Aggregate Map.
     *
     * The Shared Map will be active before this CA processes another message.
     *
     * The consistency model is monotonic read consistency: local replicas
     * could be stale, but once we see a Shared Map version, we will never see
     * previous ones.
     *
     * Type of caf_map.options is `{isAggregate: boolean}`
     *
     * @param {string} alias A short name that identifies this map in the
     * `this.$.sharing.$` context.
     * @param {string} name A fully qualified name for the source of this
     * Shared Map, i.e., scoped
     *  with the owner's CA name, like `caOwner-caLocalName-mapLocalName`.
     *
     * @param {mapOptionsType=} options If `options.isAggregate` is `true`
     *  create an `AggregateMap`.
     *
     * @memberof! module:caf_sharing/proxy_sharing#
     * @alias addReadOnlyMap
     */
    that.addReadOnlyMap = function(alias, name, options) {
        $._.addMap(false, alias, name, options || {});
    };

    /**
     *  Deletes a local reference to a Shared Map.
     *
     * The contents of the map are not destroyed from persistent storage.
     *
     * @param {string} alias The local alias for this map.
     *
     * @memberof! module:caf_sharing/proxy_sharing#
     * @alias deleteMap
     *
     */
    that.deleteMap = function(alias) {
        $._.deleteMap(alias);
    };

    /**
     * Returns an incremental update or a full dump of the Shared Map.
     *
     * The type of `mapUpdateType` is `{version: number, remove : Array<string>,
     *                                  add : Array<string|Object>}`
     * where `add` just flattens key/value pairs in a single array.
     *
     * Multiple incremental updates can be provided in an array of
     * `mapUpdateType` objects.
     *
     * An up to date local replica will have an empty array as update.
     *
     * @param {string} alias The local alias for this map.
     * @param {number=} version The current version of the local Shared Map, or
     * `undefined` if a full dump is needed.
     * @return {mapUpdateType | Array.<mapUpdateType>} A full dump of the map
     * or a list with incremental updates (empty if up to date).
     *
     * @memberof! module:caf_sharing/proxy_sharing#
     * @alias pullUpdate
     */
    that.pullUpdate = function(alias, version) {
        let result;
        result = typeof version === 'number' ?
            that.$[alias].updatesSlice(version) :
            null;
        if (result === null) {
            result = that.$[alias].dump();
        }
        return result;
    };

    /**
     * Applies a change set to a writable map, needed to replicate external
     * Shared Maps.
     *
     * @param {string} alias The local alias for this map.
     * @param {mapUpdateType} changes A set of changes to apply.
     * @param {{debug:function(string)}=} logger An optional logger,
     * i.e., `this.$.log`, to warn of ignored updates.
     *
     * @throws Error when the change set version is not compatible.
     *
     * @memberof! module:caf_sharing/proxy_sharing#
     * @alias applyDelta
     */
    that.applyDelta = function(alias, changes, logger) {
        const ref = that.$[alias];
        if (changes.version > ref.getVersion()) {
            const err = new Error('Incompatible version: missed update');
            err['originalVersion'] = ref.getVersion();
            err['version'] = changes.version;
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
     * Gets the full name of a local writable Shared Map.
     *
     * Maps are named after the CA that owns them, i.e., a complete name is
     * `caOwner-caLocalName-mapLocalName`.
     *
     * @param {string} name A relative name for a Shared Map.
     * @return {string} A complete name for the Shared Map.
     *
     * @memberof! module:caf_sharing/proxy_sharing#
     * @alias fullName
     *
     */
    that.fullName = function(name) {
        return $._.toFullName(name);
    };


    /**
     * A context containing proxies to all the visible Shared Maps for this CA.
     *
     * Application code refers to these maps using aliases:
     *
     *      this.$.sharing.$.myMap
     *
     * and this is typically shortened as follows:
     *
     *      const $$ = this.$.sharing.$
     *      $$.myMap.set('x', $$.myMap.get('y') + 1)
     *
     *
     * @memberof! module:caf_sharing/proxy_sharing#
     * @alias $
     */
    that.$ = $._.getRefMaps();

    Object.freeze(that);
    return [null, that];
};
