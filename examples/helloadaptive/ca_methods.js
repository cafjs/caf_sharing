'use strict';

var caf = require('caf_core');

var ADMIN_CA = 'admin';
var ADMIN_MAP = 'primarySharedMap';


var isAdmin = function(self) {
    var name = self.__ca_getName__();
    return (caf.splitName(name)[1] === ADMIN_CA);
};

var primaryMap = function(self) {
    var name = self.__ca_getName__();
    return caf.joinName(caf.splitName(name)[0], ADMIN_CA, ADMIN_MAP);
};

exports.methods = {
    async __ca_init__() {
        if (isAdmin(this)) {
            this.$.sharing.addWritableMap('primary', ADMIN_MAP);
        }
        this.$.sharing.addReadOnlyMap('replica', primaryMap(this));
        return [];
    },
    async install(base) {
        var $$ = this.$.sharing.$;
        if (isAdmin(this)) {
            $$.primary.set('base', base);
            var body = "return prefix + (this.get('base') + Math.random());";
            $$.primary.setFun('computeLabel', ['prefix'], body);
            return [null, base];
        } else {
            return [new Error('Cannot write to SharedMap')];
        }
    },
    async getLabel(prefix) {
        var $$ = this.$.sharing.$;
        try {
            return [null, $$.replica.applyMethod('computeLabel', [prefix])];
        } catch (err) {
            return [err];
        }
    }
};

caf.init(module);
