define(['jquery'], function($) {
"use strict";


/* similar to $.when() but does not abort on errors */

var DeferredSynchronizer = function(args) {
   var length = args.length,
        errors = {},
        count = length,
        deferred = $.Deferred();

    if (length == 0)
        deferred.resolveWith(deferred, [[], []]);

    function resolveFunc(i) {
        return function(value) {
            args[i] = arguments.length > 1 ? [].slice.call(arguments, 0) : value;
            if (--count === 0) {
                deferred.resolveWith(deferred, [args, errors]);
            }
        };
    }
    function rejectFunc(i) {
        return function(value) {
            errors[i] = arguments.length > 1 ? [].slice.call(arguments, 0) : value;
            args[i] = null;
            if (--count === 0) {
                deferred.resolveWith(deferred, [args, errors]);
            }
        };
    }
    /* TODO progress */
    for (var i = 0; i < args.length; i ++) {
        args[i].promise().then(resolveFunc(i), rejectFunc(i));
    }
    return deferred.promise();
}
return DeferredSynchronizer;

});
