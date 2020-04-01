// Modifications copyright 2020 Caf.js Labs and contributors
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

exports.methods = {
    "__ca_init__" : function(cb) {
        this.$.log.debug("++++++++++++++++Calling init");
        this.state.pulses = 0;
        cb(null);
    },
    "__ca_resume__" : function(cp, cb) {
        this.$.log.debug("++++++++++++++++Calling resume: pulses=" +
                         this.state.pulses);

        cb(null);
    },
    "__ca_pulse__" : function(cb) {
        this.state.pulses = this.state.pulses + 1;
        this.$.log.debug('<<< Calling Pulse>>>' + this.state.pulses);
        cb(null);
    },
    hello: function(msg, cb) {
        var $$ = this.$.sharing.$;
        cb(null, Object.keys($$));
    },
    addMap: function(alias, mapName, readOnly, options, cb) {
        if (readOnly) {
            this.$.sharing.addReadOnlyMap(alias, mapName, options);
        } else {
            this.$.sharing.addWritableMap(alias, mapName, options);
        }
        cb(null);
    },
    deleteMap: function(alias, cb) {
        this.$.sharing.deleteMap(alias);
        cb(null);
    },

    poke: function(alias, key, value, isFunction, cb) {
        try {
            var $$ = this.$.sharing.$;
            if (isFunction) {
                $$[alias].setFun(key, value.args, value.body);
            } else {
                $$[alias].set(key, value);
            }
            cb(null);
        } catch (error) {
            cb(error);
        }
    },

    peek: function(alias, key, cb) {
        try {
            var $$ = this.$.sharing.$;
            if (!$$[alias]) {
                var err = new Error('Missing map');
                err.alias = alias;
                cb(err);
            } else {
                cb(null, $$[alias].get(key));
            }
        } catch (error) {
            cb(error);
        }
    },

    getAll: function(alias, key, cb) {
        try {
            var $$ = this.$.sharing.$;
            if (!$$[alias]) {
                var err = new Error('Missing map');
                err.alias = alias;
                cb(err);
            } else {
                cb(null, $$[alias].getAll(key));
            }
        } catch (error) {
            cb(error);
        }
    },

    invoke : function(alias, method, args, cb) {
        try {
            var $$ = this.$.sharing.$;
            var result = $$[alias].applyMethod(method, args);
            cb(null, result);
        } catch (error) {
            cb(error);
        }
    }

};
