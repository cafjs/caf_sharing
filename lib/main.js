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
 * Main package module.
 *
 * @module caf_sharing/main
 *
 */

/* eslint-disable max-len */
/**
 * @external caf_components/gen_plug_ca
 * @see {@link https://cafjs.github.io/api/caf_components/module-caf_components_gen_plug_ca.html}
 */

/**
 * @external caf_components/gen_plug
 * @see {@link https://cafjs.github.io/api/caf_components/module-caf_components_gen_plug.html}
 */

/**
 * @external caf_components/gen_proxy
 * @see {@link https://cafjs.github.io/api/caf_components/module-caf_components_gen_proxy.html}
 */

/**
 * @external caf_redis
 * @see {@link https://cafjs.github.io/api/caf_redis/index.html}
 */

/**
 * @external caf_ca
 * @see {@link https://cafjs.github.io/api/caf_ca/index.html}
 */

/* eslint-enable max-len */


exports.SharedMap = require('./SharedMap').SharedMap;

exports.AggregateMap = require('./AggregateMap').AggregateMap;

exports.ReliableChannel = require('./ReliableChannel');

exports.plug = require('./plug_sharing.js');
exports.plug_ca = require('./plug_ca_sharing.js');
exports.proxy = require('./proxy_sharing.js');


// DEBUG
exports.print = function(top) {
    var results = top;
    if (typeof results !== 'object') {
        results = {};
        global['._$'] = results;
    }
    return function(err, data) {
        results.err = err;
        results.data = data;
        if (err) {
            // eslint-disable-next-line
            console.log('ERROR: ' + err);
        } else {
            // eslint-disable-next-line
            console.log('OK: ' + data);
        }
    };
};
