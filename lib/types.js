
/**
 * @global
 * @typedef {function(Error?, any=):void} cbType
 *
 */


/**
 * @global
 * @typedef {Object | Array | string | number | null | boolean} jsonType
 *
 */

/**
 * @global
 * @typedef {Object} refMapType
 *
 */

/**
 * @global
 * @typedef {Object} mapOptionsType
 * @property {Object.<string, jsonType>=} initialValue An optional initial
 * value for a writable map.
 * @property {boolean=} bestEffort Ignore errors when we cannot create a
 * replica. On failure the map is set to `null` and the client should retry
 * adding it again.
 */

/**
 * @global
 * @typedef {Object} mapUpdateType
 * @property {number} version An initial version number for the map.
 * @property {Array.<string>} remove Map keys to delete.
 * @property {Array.<string|Object>} add  Key/value pairs to add to the map.
 *  They are laid out in the array as [key1, val1, key2, val2, ... *
 */

/**
 * @global
 * @typedef {Object} messagesType
 * @property {number} index  The first message in `messages` or
 * `UNKNOWN_ACK_INDEX`, i.e., `-1`,  if no messages.
 * @property {Array.<jsonType>} messages Messages received in the channel that
 * have not been acknowledged previously.
 *
 */

/**
 * @global
 * @typedef {Object} specType
 * @property {string} name
 * @property {string|null} module
 * @property {string=} description
 * @property {Object} env
 * @property {Array.<specType>=} components
 *
 */

/**
 * @global
 * @typedef {Object} specDeltaType
 * @property {string=} name
 * @property {(string|null)=} module
 * @property {string=} description
 * @property {Object=} env
 * @property {Array.<specType>=} components
 *
 */

/**
 * @global
 * @typedef {Object.<string, Object>} ctxType
 */
