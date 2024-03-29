"use strict"
var crypto = require('crypto');
var SharedMap = require('../index').SharedMap;
var ReliableChannel = require('../index').ReliableChannel;
var AggregateMap = require('../index').AggregateMap;
var hello = require('./hello/main.js');
var app = hello;
var caf = require('caf_core');
var caf_comp = caf.caf_components;
var myUtils = caf_comp.myUtils;
var async = caf_comp.async;
var cli = caf.caf_cli;

var CA_OWNER_1='other1';
var CA_LOCAL_NAME_1='bar1';
var FROM_1 =  CA_OWNER_1 + '-' + CA_LOCAL_NAME_1;

var CA_OWNER_2='other2';
var CA_LOCAL_NAME_2='bar2';
var FROM_2 =  CA_OWNER_2 + '-' + CA_LOCAL_NAME_2;

var CA_OWNER_3='other3';
var CA_LOCAL_NAME_3='bar3';
var FROM_3 =  CA_OWNER_3 + '-' + CA_LOCAL_NAME_3;

process.on('uncaughtException', function (err) {
               console.log("Uncaught Exception: " + err);
               console.log(myUtils.errToPrettyStr(err));
               process.exit(1);

});

module.exports = {
    setUp: function (cb) {
       var self = this;
        app.init( {name: 'top'}, 'framework.json', null,
                      function(err, $) {
                          if (err) {
                              console.log('setUP Error' + err);
                              console.log('setUP Error $' + $);
                              // ignore errors here, check in method
                              cb(null);
                          } else {
                              self.$ = $;
                              cb(err, $);
                          }
                      });
    },
    tearDown: function (cb) {
        var self = this;
        if (!this.$) {
            cb(null);
        } else {
            this.$.top.__ca_graceful_shutdown__(null, cb);
        }
    },

    sharedMap: function (test) {
       test.expect(25);

        // test isolation
        var m1 = new SharedMap();
        var ref1 = m1.ref();
        var ref2 = m1.ref(true);
        ref1.set('x', 1);
        ref1.set('z', 5);
        var value = {doo:'sss', p:3};
        ref1.set('y', value );
        test.throws(function() {
            value.p = 2; // frozen object
        });
        ref1.set('x', 2);
        ref1.delete('z');
        var delta1 = ref1.prepare();
        test.ok(ref1.has('x'));
        test.ok(!ref2.has('x'));
        m1.commit(ref1);
        test.ok(!ref2.has('x'));

        ref1 = m1.ref();
        test.equals(ref1.get('x'), 2);
        console.log(ref1.toObject());
        test.equals(Object.keys(ref1.toObject()).length, 3);
        test.equals(ref1.getVersion(), 1);
        test['throws'](function() {ref2.set('x',4);});
        ref2 = m1.ref();
        ref1.set('x', 3);
        ref2.set('x', 4);
        ref1.prepare();
        m1.commit(ref1);
        ref2.prepare();
        test['throws'](function() {m1.commit(ref2);});
        test.equals(ref1.get('x'), 3);

        // test abort
        ref1 = m1.ref();
        ref1.set('yy', 11);
        test['throws'](function() {m1.commit(ref1);}); //before prepare
        //ref1.abort();
        test['throws'](function() {m1.commit(ref1);});
        ref1 = m1.ref();
        test.ok(!ref1.has('yy'));

        // test dump with reset
        var sm1 = new SharedMap();
        var sm2 = new SharedMap();
        ref1 = sm1.ref();
        ref2 = sm2.ref();
        ref1.set('x', 3);
        ref2.set('x', 5);
        ref1.prepare();
        sm1.commit(ref1);
        ref2.prepare();
        sm2.commit(ref2);
        ref1 = sm1.ref();
        var dump1 = ref1.dump();
        sm2.applyChanges(dump1);
        ref2 = sm2.ref();
        test.equals(ref2.get('x'), 3);
        test.equals(ref2.getVersion(), 1);

        // test deltas
        var m2 = new SharedMap();
        ref1 = m1.ref();
        var d1 = ref1.dump();
        ref2 = m2.ref();
        m2.applyChanges(d1);
        ref2 = m2.ref();
        test.deepEqual(ref1.toObject(), ref2.toObject());
        ref2.set('x', 5);
        ref2.delete('x');
        ref2.set('x', 6);
        ref2.delete('z');
        test.equals(ref2.getChanges(), null);
        var d2 = ref2.prepare();
        test.ok(ref2.getChanges());
        console.log(ref2.getChanges());
        m2.commit(ref2);
        m1.applyChanges(d2);
        ref1 = m1.ref();
        test.deepEqual(ref1.toObject(), ref2.toObject());
        test.ok(m1.toImmutableObject(ref1).equals(m2.toImmutableObject(ref2)));
        test.equals(ref1.toObject()['x'], 6);
        test.ok(!ref1.has('z'));
        // apply again should be ignored
        ref1 = m1.ref(true);
        // Only the last change uses applyChanges(), so there is no update for
        //   the previous ones.
        var up1 = ref1.updatesSlice(2);
        m1.applyChanges(d2);
        ref1 = m1.ref(true);
        var up2 = ref1.updatesSlice(2);
        test.deepEqual(up1, up2);
        console.log(up1);
        test.equals(up1.length, 1);
        var ref11 = m1.ref();
        test.equals(ref1.getVersion(), ref11.getVersion());
        test.done();
    },

    sharedMapFun: function (test) {
        test.expect(9);
        var m1 = new SharedMap();
        var m2 = new SharedMap();

        var ref1 = m1.ref();
        ref1.set('y', 7)
            .set('z', 9)
            .setFun('x', ['y'], 'return this.get(y) + 1;');
        var d1 = ref1.prepare();
        m1.commit(ref1);
        var ref2 = m2.ref();
        console.log(d1);
        m2.applyChanges(d1);

        ref1 = m1.ref();
        ref2 = m2.ref();

        test.equals(ref1.applyMethod('x', ['y']), 8);
        test.equals(ref1.applyMethod('x', ['y']), ref2.applyMethod('x', ['y']));
        test.equals(ref1.applyMethod('x', ['z']), 10);
        test.equals(ref1.applyMethod('x', ['z']), ref2.applyMethod('x', ['z']));

        ref1.setFun('k', ['y'], 'return this.applyMethod("x",[y]) + 1;');
        var d2 = ref1.prepare();
        test.equals(ref1.applyMethod('k', ['y']), 9);
        m1.commit(ref1);
        test.equals(ref1.applyMethod('k', ['y']), 9);
        ref1 = m1.ref();
        test.equals(ref1.applyMethod('k', ['y']), 9);

        var count = 0;
        var t1 = new Date().getTime();
        for (var i = 0; i<100000; i++) {
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
            count = count + ref1.applyMethod('x', ['y']);
        }
        var t2 = new Date().getTime();
        console.log(count);
        console.log(t2-t1);
        test.equals(count, 8000000);

        var f = function(ref1, y) {
            return ref1.get(y) + 1;
        };
        count = 0;
        t1 = new Date().getTime();
        for (i = 0; i<100000; i++) {
            count = count + f(ref1, 'y');
            count = count + f(ref1, 'y');
            count = count +  f(ref1, 'y');
            count = count +  f(ref1, 'y');
            count = count + f(ref1, 'y');
            count = count +  f(ref1, 'y');
            count = count +  f(ref1, 'y');
            count = count +  f(ref1, 'y');
            count = count +  f(ref1, 'y');
            count = count +  f(ref1, 'y');
        }
        t2 = new Date().getTime();
        console.log(count);
        console.log(t2-t1);
        test.equals(count, 8000000);


        test.done();
    },

    oneTable: function(test) {
        var self = this;
        test.expect(10);
        var s1;
        var s2;
        var s3;
        var from1 = FROM_1;
        var map1 = 'mytable'+ crypto.randomBytes(16).toString('hex');
        console.log(map1);
        var map1Full = FROM_1 + '-' + map1;
        var from2 = FROM_2;
        var from3 = FROM_3;

        async.series(
            [
                function(cb) {
                    s1 = new cli.Session('ws://foo-xx.localtest.me:3000', from1, {
                        from : from1
                    });
                    s1.onopen = function() {
                        s1.addMap('foo', map1, false, null, cb);
                    };
                },
                function(cb) {
                    s2 = new cli.Session('ws://foo-xx.localtest.me:3000', from2, {
                        from : from2
                    });
                    s2.onopen = function() {
                        s2.addMap('foo', map1Full, true, null, cb);
                    };
                },
                function(cb) {
                    s3 = new cli.Session('ws://foo-xx.localtest.me:3000', from3, {
                        from : from3
                    });
                    s3.onopen = function() {
                        s3.addMap('foo', map1Full, true, null, cb);
                    };
                },
                function(cb) {
                    var all = [];
                    for (var i = 0; i<1000; i++) {
                        all.push(i);
                    }
                    async.mapSeries(all, function(x, cb0) {
                        s1.poke('foo', 'somekey', x, false, cb0);
                    }, cb);
                },
                    function(cb) {
                        var cb1 = function(err, val) {
                            test.ifError(err);
                            test.equals(val, 999);
                            cb(null);
                        };
                        setTimeout(function() {
                            s2.peek('foo', 'somekey', cb1);
                        }, 1000);
                    },
                    function(cb) {
                        var cb1 = function(err, val) {
                            test.ifError(err);
                            test.equals(val, 999);
                            cb(null);
                        };
                        setTimeout(function() {
                            s3.peek('foo', 'somekey', cb1);
                        }, 1000);
                    },
                    function(cb) {
                        var fun = {args:['x'], body: "return this.get('somekey') + x;"};
                        s1.poke('foo', 'f', fun, true, cb);
                    },
                    function(cb) {
                        var cb1 = function(err, val) {
                            test.ifError(err);
                            test.equals(val, 1000);
                            cb(null);
                        };
                        setTimeout(function() {
                            s3.invoke('foo', 'f', [1], cb1);
                        }, 1000);
                    },
                    function(cb) {
                        async.map([s1, s2, s3], function(x, cb0) {
                            x.deleteMap('foo', cb0);
                        }, cb);
                    },
                    function(cb) {
                        s1.onclose = function(err) {
                            test.ifError(err);
                            cb(null, null);
                        };
                        s1.close();
                    },
                    function(cb) {
                        s2.onclose = function(err) {
                            test.ifError(err);
                            cb(null, null);
                        };
                        s2.close();
                    },
                    function(cb) {
                        s3.onclose = function(err) {
                            test.ifError(err);
                            cb(null, null);
                        };
                        s3.close();
                    }
                    ], function(err, res) {
                        test.ifError(err);
                        test.done();
                    });
    },
    aggregateMap: function (test) {
        test.expect(11);
        var allMaps = {
            p1 : new SharedMap(),
            p2 : new SharedMap(),
            p3 : new SharedMap(),
            p4 : new SharedMap()
        };
        var findMap = function(name, cb) {
            cb(null, allMaps[name]);
        };

        // links p1->p2, p1->p3, p2->p4, p4->p3, p4->p1
        // bindings {p4, {a, b}} {p2, {c}}, {p1, {d}}, {p3, {d}}
        var ref = allMaps.p1.ref();
        ref.set('__link_key__', ['p2', 'p3']);
        ref.set('d', true);
        ref.prepare();
        allMaps.p1.commit(ref);

        ref = allMaps.p2.ref();
        ref.set('__link_key__', ['p4']);
        ref.set('c', true);
        ref.prepare();
        allMaps.p2.commit(ref);

        ref = allMaps.p3.ref();
        ref.set('d', true);
        ref.prepare();
        allMaps.p3.commit(ref);

        ref = allMaps.p4.ref();
        ref.set('__link_key__', ['p3','p1']);
        ref.set('a', true);
        ref.set('b', true);
        ref.prepare();
        allMaps.p4.commit(ref);

        var aggMap = new  AggregateMap('p1', findMap, '__link_key__');

        aggMap.assemble(function(err, aggRef) {
            test.ifError(err);
            test.equals(aggRef.getAll('a').length, 1);
            test.ok(aggRef.getAll('a')[0]);
            test.equals(aggRef.getAll('b').length, 1);
            test.equals(aggRef.getAll('c').length, 1);
            test.equals(aggRef.getAll('d').length, 2);
            test.equals(aggRef.getAll('e').length, 0);
            // unlink p2->p4 to isolate p4
            ref = allMaps.p2.ref();
            ref.set('__link_key__', []);
            ref.prepare();
            allMaps.p2.commit(ref);
            aggMap.assemble(function(err, aggRef) {
                test.ifError(err);
                test.equals(aggRef.getAll('a').length, 0);
                test.equals(aggRef.getAll('b').length, 0);
                test.equals(aggRef.getAll('d').length, 2);
                test.done();
            });


        });

    },
    reliableChannel: function(test) {
        var all = Array.apply(null, Array(10000)).map(function (_, i) {
            return i;
        });
        var fakeMap = function() {
            var map = {};
            var that = {};
            that.get = function(x) {
                return map[x];
            };
            that.set = function(k,v) {
                map[k] = v;
            };
            that.getMap = function() {
                return map;
            };
            return that;
        };
        var self = this;
        test.expect(6);

        var source = fakeMap();
        var destination = fakeMap();
        var nSent = 0;
        var res = [];
        var lastIndex = -1;
        var total = 0;
        var lastNMessages = 0;
        while (nSent < 10000) {
            var nEvict = Math.floor(Math.random() * 10) + 1;
            var toSend = [];
            for (var i = 0 ; i < nEvict; i++) {
                if (all.length > 0) {
                    toSend.push(all.shift());
                    nSent = nSent + 1;
                }
            }
            var p1 = function() {
                ReliableChannel.send(source, 'foo', toSend);
            };
            var p2 = function() {
                var msgs = ReliableChannel.receive(destination, source, 'foo');
                if (msgs.messages.length > 0) {
                    if (msgs.index <= lastIndex) {
                        test.ok(false, 'Index not monotonic increasing new:' +
                                msgs.index + ' old: ' + lastIndex);
                    } else {
                        total = total + msgs.index - lastIndex;
                        lastIndex = msgs.index;
                        lastNMessages = msgs.messages.length;
                    }
                }
                res = res.concat(msgs.messages);
            };
            var p3 = function() {
                ReliableChannel.gc(source, destination);
            };
            var shuffle = [[p1, p2, p3], [p1, p3, p2], [p2, p1, p3],
                           [p2, p3, p1], [p3, p1, p2], [p3, p2, p1]];
            var n =  Math.floor(Math.random() * 6);
            shuffle[n][0].apply(null,[]);
            shuffle[n][1].apply(null,[]);
            shuffle[n][2].apply(null,[]);
        }

        total = total + lastNMessages -1 ;
        test.equals(total, res.length, 'Receiving messages multiple times');

        var msgs = ReliableChannel.receive(destination, source, 'foo');
        res = res.concat(msgs.messages);
        ReliableChannel.gc(source, destination);


        var mapSource = source.getMap();
        var mapDestination = destination.getMap();
        var chan = mapSource['__ca_channels__'].foo;
        test.equals(chan.contents.length, 0);
        test.equals(chan.index, 10000);

        test.equals(res.length, 10000);
        var allOK = true;
        res.forEach(function(x, i) { allOK = (allOK && (x === i));});
        test.ok(allOK);

        var ackIndex =  mapDestination['__ca_acks__'].foo;
        test.equals(ackIndex, 9999);
        console.log(mapSource);
        console.log(mapDestination);
        test.done();
    },
    oneAggregate: function(test) {
        var self = this;
        test.expect(12);
        var s1;
        var s2;
        var s3;
        var from1 = FROM_1;
        var map1 = 'mytable'+ crypto.randomBytes(16).toString('hex');
        console.log(map1);
        var map1Full = FROM_1 + '-' + map1;
        var map2 = 'mytable'+ crypto.randomBytes(16).toString('hex');
        console.log(map2);
        var map2Full = FROM_2 + '-' + map2;

        var from2 = FROM_2;
        var from3 = FROM_3;

        async.series(
            [
                function(cb) {
                    s1 = new cli.Session('ws://foo-xx.localtest.me:3000', from1, {
                        from : from1
                    });
                    s1.onopen = function() {
                        s1.addMap('foo', map1, false, null, cb);
                    };
                },
                function(cb) {
                    s2 = new cli.Session('ws://foo-xx.localtest.me:3000', from2, {
                        from : from2
                    });
                    s2.onopen = function() {
                        s2.addMap('bar', map2, false, null, cb);
                    };
                },
                function(cb) {
                    s3 = new cli.Session('ws://foo-xx.localtest.me:3000', from1, {
                        from : from1
                    });
                    s3.onopen = function() {
                        s3.addMap('fooAggregate', map1Full, true,
                                  {isAggregate: true}, cb);
                    };
                },
                function(cb) {
                    s1.poke('foo', '__link_key__', [map2Full], false, cb);
                },
                function(cb) {
                    s1.poke('foo', 'john', true, false, cb);
                },
                function(cb) {
                    s2.poke('bar', 'helen', true, false, cb);
                },
                function(cb) {
                    setTimeout(function() {cb(null);}, 2000);
                },
                function(cb) {
                    var cb1 = function(err, data) {
                        test.ifError(err);
                        test.deepEqual([true], data);
                        cb(null);
                    };
                    s3.getAll('fooAggregate', 'helen', cb1);
                },
                function(cb) {
                    var cb1 = function(err, data) {
                        test.ifError(err);
                        test.deepEqual([true], data);
                        cb(null);
                    };
                    s3.getAll('fooAggregate', 'john', cb1);
                },
                function(cb) {
                    var cb1 = function(err, data) {
                        test.ifError(err);
                        test.deepEqual([], data);
                        cb(null);
                    };
                    s3.getAll('fooAggregate', 'nobody', cb1);
                },
                function(cb) {
                    s1.poke('foo', '__link_key__', [], false, cb);
                },
                function(cb) {
                    var cb1 = function(err, data) {
                        test.ifError(err);
                        test.deepEqual([], data);
                        cb(null);
                    };
                    s3.getAll('fooAggregate', 'helen', cb1);
                },

                function(cb) {
                    s1.onclose = function(err) {
                        test.ifError(err);
                        cb(null, null);
                    };
                    s1.close();
                },
                function(cb) {
                    s2.onclose = function(err) {
                        test.ifError(err);
                        cb(null, null);
                    };
                    s2.close();
                },
                function(cb) {
                    s3.onclose = function(err) {
                        test.ifError(err);
                        cb(null, null);
                    };
                    s3.close();
                }
            ], function(err, res) {
                test.ifError(err);
                test.done();
            });
    }
};
