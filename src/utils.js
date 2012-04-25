/** Makes the specified class events-aware, i.e. adds
 * the functions on(event, handler), off(event, handler)
 * and _trigger(event, ...)
 */
function addEvents(className, possibleEvents) {
    className.prototype.on = function(event, handler) {
        if (!this._eventHandlers)
            this._initEvents();

        this._eventHandlers[event].push(handler);

        return handler;
    },
    className.prototype.off = function(event, handler) {
        var hand = this._eventHandlers[event];
        for (var i = 0; i < hand.length; i ++) {
            if (hand[i] == handler) {
                hand.splice(i, 1);
                i --;
            }
        }
        this._eventHandlers[event] = hand;
    },
    className.prototype._initEvents = function() {
        this._eventHandlers = {};
        var lthis = this;
        $(possibleEvents).each(function(i, e) { lthis._eventHandlers[e] = []; });
    },
    /* can be called with more arguments */
    className.prototype._trigger = function(event) {
        if (!this._eventHandlers)
            this._initEvents();
        
        var hand = this._eventHandlers[event];
        var args = [].slice.call(arguments, 1);
        for (var i = 0; i < hand.length; i ++) {
            hand[i].apply(this, args);
        }
    }
}

function LiveValue(initial) {
    this._val = initial;
}
LiveValue.prototype = {
    get: function() {
        return this._val;
    },
    getLive: function(callback, owner) {
        callback(this._val);
        this.on('changed', callback);

        if (owner !== undefined) {
            var lthis = this;
            owner.on('destroying', function() {
                lthis.off('changed', callback);
            });
        }
    },
    set: function(val) {
        this._val = val;
        this._trigger('changed', val);
    }

}
addEvents(LiveValue, ['changed']);
