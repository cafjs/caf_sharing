'use strict';
/* eslint-disable  no-console */

const caf_core = require('caf_core');
const caf_comp = caf_core.caf_components;
const myUtils = caf_comp.myUtils;
const caf_cli = caf_core.caf_cli;
const util = require('util');
const setTimeoutPromise = util.promisify(setTimeout);

/* `from` CA needs to be the same as target `ca` to enable creation, i.e.,
 *  only owners can create CAs.
 *
 *  With security on, we would need a token to authenticate `from`.
 *
 */
const URL = 'http://root-hellosharing.localtest.me:3000/' +
          '#from=foo-admin&ca=foo-admin';

const s = new caf_cli.Session(URL);

s.onopen = async function() {
    let counter = await s.increment().getPromise();
    console.log(counter);
    counter = await s.increment().getPromise();
    console.log(counter);
    let done = false;
    try {
        while (!done) {
            counter = await s.getCounter().getPromise();
            console.log('Got ' + counter);
            if (counter >= 2) {
                done = true;
            } else {
                setTimeoutPromise(100);
            }
        }
        console.log('Final count:' + counter);
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
