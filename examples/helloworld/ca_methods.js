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
    async __ca_init__() {
        if (isAdmin(this)) {
            this.$.sharing.addWritableMap('master', ADMIN_MAP);
        }
        this.$.sharing.addReadOnlyMap('slave', masterMap(this));
        return [];
    },
    async increment() {
        var $$ = this.$.sharing.$;
        if (isAdmin(this)) {
            var counter = $$.master.get('counter') || 0;
            $$.master.set('counter', counter + 1);
            return [null, counter];
        } else {
            return [new Error('Cannot write to SharedMap')];
        }
    },
    async getCounter() {
        var $$ = this.$.sharing.$;
        var value = $$.slave.get('counter');
        return [null, value];
    }
};

caf.init(module);
