'use strict';

var caf = require('caf_core');
var json_rpc = caf.caf_transport.json_rpc;

var ADMIN_CA = 'admin';
var ADMIN_MAP = 'masterSharedMap';


var isAdmin = function(self) {
    var name = self.__ca_getName__();
    return (json_rpc.splitName(name)[1] === ADMIN_CA);
};

var masterMap = function(self) {
    var name = self.__ca_getName__();
    return json_rpc.joinName(json_rpc.splitName(name)[0], ADMIN_CA, ADMIN_MAP);
};

exports.methods = {
    __ca_init__: function(cb) {
        if (isAdmin(this)) {
            this.$.sharing.addWritableMap('master', ADMIN_MAP);
        }
        this.$.sharing.addReadOnlyMap('slave', masterMap(this));
        cb(null);
    },
    increment: function(cb) {
        var $$ = this.$.sharing.$;
        if (isAdmin(this)) {
            var counter = $$.master.get('counter') || 0;
            $$.master.set('counter', counter + 1);
            cb(null, counter);
        } else {
            cb(new Error('Cannot write to SharedMap'));
        }
    },
    getCounter: function(cb) {
        var $$ = this.$.sharing.$;
        var value = $$.slave.get('counter');
        cb(null, value);
    }
};

caf.init(module);
