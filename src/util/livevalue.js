define(['util/events'], function(Events) {
"use strict";


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
Events(LiveValue, ['changed']);

return LiveValue;
});
