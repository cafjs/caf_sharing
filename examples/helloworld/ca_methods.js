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
    async increment() {
        const $$ = this.$.sharing.$;
        if (isAdmin(this)) {
            const counter = $$.primary.get('counter') || 0;
            $$.primary.set('counter', counter + 1);
            return [null, counter];
        } else {
            return [new Error('Cannot write to SharedMap')];
        }
    },
    async getCounter() {
        const $$ = this.$.sharing.$;
        const value = $$.replica.get('counter');
        return [null, value];
    }
};

caf.init(module);
