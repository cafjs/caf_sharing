'use strict';
/* eslint-disable  no-console */

var caf_core = require('caf_core');
var caf_comp = caf_core.caf_components;
var async = caf_comp.async;
var myUtils = caf_comp.myUtils;
var caf_cli = caf_core.caf_cli;

/* `from` CA needs to be the same as target `ca` to enable creation, i.e.,
 *  only owners can create CAs.
 *
 *  With security on, we would need a token to authenticate `from`.
 *
 */
var URL = 'http://root-hellosharing.vcap.me:3000/#from=foo-ca1&ca=foo-ca1';
var s = new caf_cli.Session(URL);

s.onopen = function() {
    async.waterfall([
        function(cb) {
            var done = false;
            async.until(function() { return done;},
                        function(cb1) {
                            setTimeout(function() {
                                s.getCounter(function(err, value) {
                                    if (value >= 2) {
                                        done = true;
                                    }
                                    console.log('Got ' + value);
                                    cb1(err, value);
                                });
                            }, 100);
                        }, cb);
        },
    ], function(err, counter) {
        if (err) {
            console.log(myUtils.errToPrettyStr(err));
        } else {
            console.log('Final count:' + counter);
            s.close();
        }
    });
};

s.onclose = function(err) {
    if (err) {
        console.log(myUtils.errToPrettyStr(err));
        process.exit(1);
    }
    console.log('Done OK');
};
