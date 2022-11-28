'use strict';
/* eslint-disable  no-console */

const caf_core = require('caf_core');
const caf_comp = caf_core.caf_components;
const myUtils = caf_comp.myUtils;
const caf_cli = caf_core.caf_cli;
const util = require('util');

/* `from` CA needs to be the same as target `ca` to enable creation, i.e.,
 *  only owners can create CAs.
 *
 *  With security on, we would need a token to authenticate `from`.
 *
 */
const URL = 'http://root-hellosharing.localtest.me:3000/#from=foo-ca1&ca=foo-ca1';
const s = new caf_cli.Session(URL);

s.onopen = async function() {
    const retryWithDelayPromise = util.promisify(myUtils.retryWithDelay);
    try {
        const label = await retryWithDelayPromise(async function() {
            try {
                return [null, await s.getLabel('whatever:').getPromise()];
            } catch (err) {
                return [err];
            }
        }, 10, 100);
        console.log('Label is ' + label);
        s.close();
    } catch (err) {
        s.close(err);
    }
};

s.onclose = function(err) {
    if (err) {
        console.log(myUtils.errToPrettyStr(err));
        process.exit(1);
    }
    console.log('Done OK');
};
