'use strict';

var caf = require('caf_core');

var ADMIN_CA = 'admin';
var ADMIN_MAP = 'masterSharedMap';


var isAdmin = function(self) {
    var name = self.__ca_getName__();
    return (caf.splitName(name)[1] === ADMIN_CA);
};

var masterMap = function(self) {
    var name = self.__ca_getName__();
    return caf.joinName(caf.splitName(name)[0], ADMIN_CA, ADMIN_MAP);
};

exports.methods = {
    __ca_init__: function(cb) {
        if (isAdmin(this)) {
            this.$.sharing.addWritableMap('master', ADMIN_MAP);
        }
        this.$.sharing.addReadOnlyMap('slave', masterMap(this));
        cb(null);
    },
    install: function(base, cb) {
        var $$ = this.$.sharing.$;
        if (isAdmin(this)) {
            $$.master.set('base', base);
            var body = "return prefix + (this.get('base') + Math.random());";
            $$.master.setFun('computeLabel', ['prefix'], body);
            cb(null, base);
        } else {
            cb(new Error('Cannot write to SharedMap'));
        }
    },
    getLabel: function(prefix, cb) {
        var $$ = this.$.sharing.$;
        try {
            cb(null, $$.slave.applyMethod('computeLabel', [prefix]));
        } catch (err) {
            cb(err);
        }
    }
};

caf.init(module);
