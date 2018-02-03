'use strict';
/* eslint-disable  no-console */

var caf_core = require('caf_core');
var caf_comp = caf_core.caf_components;
var myUtils = caf_comp.myUtils;
var caf_cli = caf_core.caf_cli;
var util = require('util');

/* `from` CA needs to be the same as target `ca` to enable creation, i.e.,
 *  only owners can create CAs.
 *
 *  With security on, we would need a token to authenticate `from`.
 *
 */
var URL = 'http://root-hellosharing.vcap.me:3000/#from=foo-ca1&ca=foo-ca1';
var s = new caf_cli.Session(URL);

s.onopen = async function() {
    var retryWithDelayPromise = util.promisify(myUtils.retryWithDelay);
    try {
        var label = await retryWithDelayPromise(async function() {
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
