'use strict';
/* eslint-disable  no-console */

var caf_core = require('caf_core');
var caf_comp = caf_core.caf_components;
var myUtils = caf_comp.myUtils;
var caf_cli = caf_core.caf_cli;
var util = require('util');
var setTimeoutPromise = util.promisify(setTimeout);

/* `from` CA needs to be the same as target `ca` to enable creation, i.e.,
 *  only owners can create CAs.
 *
 *  With security on, we would need a token to authenticate `from`.
 *
 */
var URL = 'http://root-hellosharing.vcap.me:3000/#from=foo-admin&ca=foo-admin';

var s = new caf_cli.Session(URL);

s.onopen = async function() {
    var counter = await s.increment().getPromise();
    console.log(counter);
    counter = await s.increment().getPromise();
    console.log(counter);
    var done = false;
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
