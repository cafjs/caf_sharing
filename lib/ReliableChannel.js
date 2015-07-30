/*!
Copyright 2013 Hewlett-Packard Development Company, L.P.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

"use strict";

var assert = require('assert');

var caf_comp = require('caf_components');
var myUtils = caf_comp.myUtils;


var CHANNELS_KEY = '__ca_channels__';

var ACKS_KEY = '__ca_acks__';

var FIRST_INDEX = 0;

var UNKNOWN_ACK_INDEX = -1;

/**
 * A collection of helper functions to create a reliable, unidirectional
 *  channel from A to B, using a pair of SharedMaps.
 *
 * One map (the `writer`) is writable by A, the other one (the `reader`) is
 * owned by B, and B writes an index number in it to acknowledge messages, so
 * that old messages can be garbage collected by A.
 *
 * A channel is represented by an unbounded list of messages, but we only need
 *  to keep in the map the ones that have not been acknowledged.
 *
 * The schema is as follows:
 *
 * In the 'writer' map:
 *
 * {
 *     '__ca_channels__' : {
 *            'foo' : {
 *                      contents:[...],
 *                      index : <number> i.e., index of first msg in `contents`
 *                     }
 *      }
 *  }
 *
 * in the 'reader' map:
 *
 * {
 *    '__ca_acks__' : {
 *          'foo' : <number>  (i.e., index of last processed message for 'foo')
 *    }
 *
 * }
 *
 * The first message has index 0.
 *
 *  When B consumes all the messages, it resets the ack index to
 * `foo.index + foo.contents.length -1` .
 *
 * When A garbage collects the channel, it drops all the acknowledged messages
 * by comparing '__ca_channels__'.foo.index with '__ca_acks__'.foo, and
 * shifting the list.
 *
 *
 */
var init = exports.init = function(writerRef) {
    var channels = writerRef.get(CHANNELS_KEY);
    if (!channels) {
        writerRef.set(CHANNELS_KEY, {});
    }
    var acks = writerRef.get(ACKS_KEY);
    if (!acks) {
        writerRef.set(ACKS_KEY, {});
    }
};

exports.deleteChannel =  function(writerRef, channelName) {
    init(writerRef);
    var doClean = function(key) {
        var channels = writerRef.get(key);
        if (channels && channels[channelName]) {
            var newChannels = myUtils.deepClone(channels);
            delete newChannels[channelName];
            writerRef.set(key, newChannels);
        }
    };

    doClean(CHANNELS_KEY);
    doClean(ACKS_KEY);
};

exports.firstIndex = function(writerRef, channelName) {
    var channels = writerRef.get(CHANNELS_KEY);
    return ((channels && channels[channelName] &&
             (typeof channels[channelName].index === 'number')) ?
            channels[channelName].index : FIRST_INDEX);
};

exports.firstAckIndex = function(readerRef, channelName) {
    var acks = readerRef.get(ACKS_KEY);
    return ((acks && (typeof acks[channelName] === 'number')) ?
            acks[channelName] : UNKNOWN_ACK_INDEX);
};


exports.allChannelNames = function(writerRef) {
    var channels = writerRef.get(CHANNELS_KEY);
    return Object.keys(channels);
};

/**
 * Send an array of messages through a channel.
 *
 * @param {caf.refMap} writerRef A writable map with messages.
 * @param {string} channelName The name of the channel.
 * @param {Array.<caf.json>} messages An array of JSON-serializable messages
 * to be sent.
 *
 */
exports.send = function(writerRef, channelName, messages) {
    init(writerRef);
    var channels = writerRef.get(CHANNELS_KEY);
    assert(Array.isArray(messages));
    if (messages.length > 0) {
        var newChannels =  myUtils.deepClone(channels);
        var chan = newChannels[channelName];
        if (!chan) {
            chan = {contents: [], index : FIRST_INDEX};
            newChannels[channelName] = chan;
        }
        chan.contents = chan.contents.concat(messages);
        writerRef.set(CHANNELS_KEY, newChannels);
    }
};


/**
 * Garbage collect acknowledged messages.
 *
 * @param {caf.refMap} writerRef A writable map with messages.
 * @param {caf.refMap} readerRef A read-only map with ack counters.
 *
 */
exports.gc = function(writerRef, readerRef) {
    init(writerRef);
    var channels = writerRef.get(CHANNELS_KEY);
    var acks = readerRef.get(ACKS_KEY);
    var newChannels =  myUtils.deepClone(channels);
    var changed = false;
    if (acks) {
        Object.keys(acks).forEach(function(key) {
            var chan = newChannels[key];
            if (chan) {
                var nSeen = acks[key] - chan.index + 1;
                if ((chan.contents.length > 0) && (nSeen > 0)) {
                    changed = true;
                    assert(nSeen <= chan.contents.length);
                    chan.index = chan.index + nSeen;
                    chan.contents = chan.contents.slice(nSeen);
                }
            }

        });
    }
    if (changed) {
        writerRef.set(CHANNELS_KEY, newChannels);
    }
};

exports.receive = function(writerRef, readerRef, channelName) {
    init(writerRef);
    var result = [];
    var channels = readerRef.get(CHANNELS_KEY);
    if (channels) {
        var chan = channels[channelName];
        var acks = writerRef.get(ACKS_KEY);
        var firstAckIndex = ((typeof acks[channelName] === 'number') ?
                             acks[channelName] : UNKNOWN_ACK_INDEX);

        if (chan && (chan.contents.length > 0)) {
            var nAlreadySeen = firstAckIndex - chan.index + 1;
            assert(nAlreadySeen >= 0);
            if (chan.contents.length - nAlreadySeen > 0) {
                result = chan.contents.slice(nAlreadySeen);
                var newAcks =  myUtils.deepClone(acks);
                newAcks[channelName] = chan.contents.length  + chan.index - 1;
                writerRef.set(ACKS_KEY, newAcks);
            }
        }
    }

    return result;
};
