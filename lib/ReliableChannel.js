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

'use strict';

/**
 * A collection of helper functions to create a reliable, unidirectional
 *  channel from `A` to `B`, using a pair of Shared Maps.
 *
 * One Shared Map (the `writer`) is writable by `A` and readable by `B`.
 * The other one (the `reader`) is writable by `B` and readable by `A`.
 * `B` writes index numbers in its map  to
 * acknowledge messages, helping `A` to garbage collect old messages.
 *
 * A channel is represented by an unbounded list of messages. However, only
 * those that have not been acknowledged are actually present in the Shared Map.
 *
 * The schema is as follows:
 *
 * In the `writer` map:
 *
 *     {
 *         __ca_channels__ : {
 *            foo : {
 *                contents:[...],
 *                index : <number> i.e., index of first msg in `contents`
 *             }
 *         }
 *     }
 *
 * in the `reader` map:
 *
 *     {
 *          __ca_acks__ : {
 *            foo : <number>  (i.e., index of last processed message of 'foo')
 *          }
 *     }
 *
 * The first message has index 0.
 *
 * When `B` consumes all the messages, it resets the ack index to
 * `foo.index + foo.contents.length -1` .
 *
 * When `A` garbage collects the channel, it drops all the acknowledged messages
 * by comparing `__ca_channels__.foo.index` with `__ca_acks__.foo`, and
 * shifting the list.
 *
 * @module caf_sharing/ReliableChannel
 */
var assert = require('assert');

var caf_comp = require('caf_components');
var myUtils = caf_comp.myUtils;

var CHANNELS_KEY = '__ca_channels__';

var ACKS_KEY = '__ca_acks__';

var FIRST_INDEX = 0;

var UNKNOWN_ACK_INDEX =
/**
 * Invalid ack index.
 *
 * @type number
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias UNKNOWN_ACK_INDEX
 */
exports.UNKNOWN_ACK_INDEX = -1;

var init =
/**
 * Initializes a Shared Map containing reliable channels.
 *
 * @param {refMapType} writerRef A reference to a writable Shared Map.
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias init
 */
exports.init = function(writerRef) {
    var channels = writerRef.get(CHANNELS_KEY);
    if (!channels) {
        writerRef.set(CHANNELS_KEY, {});
    }
    var acks = writerRef.get(ACKS_KEY);
    if (!acks) {
        writerRef.set(ACKS_KEY, {});
    }
};

/**
 * Deletes a channel in a Shared Map.
 *
 * @param {refMapType} writerRef A reference to a writable Shared Map.
 * @param {string} channelName The name of the channel.
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias deleteChannel
 */
exports.deleteChannel = function(writerRef, channelName) {
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

/**
 * Returns the index of the first message available in the channel.
 *
 * @param {refMapType} writerRef A reference to a writable Shared Map.
 * @param {string} channelName The name of the channel.
 *
 * @return {number} The index of the first message available in the channel.
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias firstIndex
 */
exports.firstIndex = function(writerRef, channelName) {
    var channels = writerRef.get(CHANNELS_KEY);
    return (channels && channels[channelName] &&
            (typeof channels[channelName].index === 'number')) ?
        channels[channelName].index :
        FIRST_INDEX;
};

/**
 * Returns the index of the last ack message.
 *
 * @param {refMapType} readerRef A reference to a writable Shared Map for
 * acks.
 * @param {string} channelName The name of the channel.
 *
 * @return {number} The index of the last ack message.
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias firstAckIndex
 */
exports.firstAckIndex = function(readerRef, channelName) {
    var acks = readerRef.get(ACKS_KEY);
    return (acks && (typeof acks[channelName] === 'number')) ?
        acks[channelName] :
        UNKNOWN_ACK_INDEX;
};

/**
 * Lists all channel names in a Shared Map.
 *
 * @param {refMapType} writerRef A reference to a writable Shared Map.
 *
 * @return {Array.<string>} All the channel names.
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias allChannelNames
 */
exports.allChannelNames = function(writerRef) {
    var channels = writerRef.get(CHANNELS_KEY);
    return Object.keys(channels);
};

/**
 * Sends an array of messages through a channel.
 *
 * @param {refMapType} writerRef A writable map with messages.
 * @param {string} channelName The name of the channel.
 * @param {Array.<jsonType>} messages An array of JSON-serializable messages
 * to be sent.
 *
 * @return {number} An index for the first message in `messages`.
 * @throws Error If `messages` is not an array or is empty.
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias send
 */
exports.send = function(writerRef, channelName, messages) {
    init(writerRef);
    var channels = writerRef.get(CHANNELS_KEY);
    assert(Array.isArray(messages));
    if (messages.length > 0) {
        var newChannels = myUtils.deepClone(channels);
        var chan = newChannels[channelName];
        if (!chan) {
            chan = {contents: [], index: FIRST_INDEX};
            newChannels[channelName] = chan;
        }
        var msgIndex = chan.index + chan.contents.length;
        chan.contents = chan.contents.concat(messages);
        writerRef.set(CHANNELS_KEY, newChannels);
        return msgIndex;
    }
};


/**
 * Garbage collects acknowledged messages.
 *
 * @param {refMapType} writerRef A writable map with messages.
 * @param {refMapType} readerRef A read-only map with ack counters.
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias gc
 */
exports.gc = function(writerRef, readerRef) {
    init(writerRef);
    var channels = writerRef.get(CHANNELS_KEY);
    var acks = readerRef.get(ACKS_KEY);
    var newChannels = myUtils.deepClone(channels);
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

/**
 * Receives messages and updates ack counters accordingly. This operation is
 * not idempotent, already acknowledged messages are ignored.
 *
 *  The return type 'messagesType' is:
 *
 *       {index: number, messages: Array.<jsonType>}
 *
 *  where the `index` field corresponds to the first message in `messages` or
 * UNKNOWN_ACK_INDEX if no messages.
 *
 * @param {refMapType} writerRef A writable map ack counters.
 * @param {refMapType} readerRef A read-only map with messages.
 * @param {string} channelName The name of the channel to receive messages from.
 *
 * @return {messagesType} Messages received in the channel that have not been
 * acknowledged previously.
 *
 * @memberof! module:caf_sharing/ReliableChannel
 * @alias receive
 */
exports.receive = function(writerRef, readerRef, channelName) {
    init(writerRef);
    var result = {index: UNKNOWN_ACK_INDEX, messages: []};
    var channels = readerRef.get(CHANNELS_KEY);
    if (channels) {
        var chan = channels[channelName];
        var acks = writerRef.get(ACKS_KEY);
        let firstAckIndex;
        firstAckIndex = typeof acks[channelName] === 'number' ?
            acks[channelName] :
            UNKNOWN_ACK_INDEX;

        if (chan && (chan.contents.length > 0)) {
            var nAlreadySeen = firstAckIndex - chan.index + 1;
            assert(nAlreadySeen >= 0);
            if (chan.contents.length - nAlreadySeen > 0) {
                result.index = firstAckIndex + 1;
                result.messages = chan.contents.slice(nAlreadySeen);
                var newAcks = myUtils.deepClone(acks);
                newAcks[channelName] = chan.contents.length + chan.index - 1;
                writerRef.set(ACKS_KEY, newAcks);
            }
        }
    }

    return result;
};
