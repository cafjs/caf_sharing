'use strict';

const caf = require('caf_core');

const ADMIN_CA = 'admin';
const ADMIN_MAP = 'primarySharedMap';


const isAdmin = function(self) {
    const name = self.__ca_getName__();
    return (caf.splitName(name)[1] === ADMIN_CA);
};

const primaryMap = function(self) {
    const name = self.__ca_getName__();
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
        const $$ = this.$.sharing.$;
        if (isAdmin(this)) {
            $$.primary.set('base', base);
            const body = "return prefix + (this.get('base') + Math.random());";
            $$.primary.setFun('computeLabel', ['prefix'], body);
            return [null, base];
        } else {
            return [new Error('Cannot write to SharedMap')];
        }
    },
    async getLabel(prefix) {
        const $$ = this.$.sharing.$;
        try {
            return [null, $$.replica.applyMethod('computeLabel', [prefix])];
        } catch (err) {
            return [err];
        }
    }
};

caf.init(module);
