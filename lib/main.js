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

exports.SharedMap = require('./SharedMap').SharedMap;

exports.AggregateMap = require('./AggregateMap').AggregateMap;


exports.plug = require('./plug_sharing.js');
exports.plug_ca = require('./plug_ca_sharing.js');
exports.proxy = require('./proxy_sharing.js');


// DEBUG
exports.print = function(top) {
    var results = top;
    if (typeof results !== 'object') {
        results = {};
        global._$ = results;
    }
    return function(err, data) {
        results.err = err;
        results.data = data;
        if (err) {
            console.log('ERROR: ' + err);
        } else {
            console.log('OK: ' + data);
        }
    };
};
