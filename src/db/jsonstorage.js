define(['jquery', 'ui/logger', 'util/deferredsynchronizer', 'db/accessors'],
        function($, logger, DeferredSynchronizer, Accessors) {
"use strict";

function JSONStorage(path) {
    this._path = path || this._pathFromDocumentLocation();
    this._fs = Accessors(this._path);
}
JSONStorage.prototype._pathFromDocumentLocation = function() {
    var path;
    if (document.location.protocol == 'http:' || document.location.protocol == 'https:') {
        path = document.location.href; /* XXX unescape? */
    } else {
        path = unescape(document.location.pathname);
    }
    var i = path.lastIndexOf('/');
    if (i < 0) {
        return path;
    } else {
        return path.substr(0, i);
    }
}
JSONStorage.prototype.exists = function(path) {
    return this._fs.exists(this._path + '/' + path);
}
JSONStorage.prototype.read = function(path) {
    return this._fs.read(this._path + '/' + path).pipe(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return $.Deferred().reject("Error decoding JSON data: " + e.message).promise();
        }
    });
}
JSONStorage.prototype.write = function(path, data) {
    try {
        var data = JSON.stringify(data);
    } catch (e) {
        return $.Deferred().reject("Error encoding data to JSON: " + e.message).promise();
    }
    return this._fs.write(this._path + '/' + path, data);
}
JSONStorage.prototype.readFilesInDir = function(dir, noCreate) {
    var lthis = this;
    return this.listDir(dir, noCreate).pipe(function(files) {
        var processes = [];
        files.forEach(function(f) {
            if (!f.match('_lock$'))
                processes.push(lthis.read(dir + '/' + f));
        });
        return DeferredSynchronizer(processes);
    });
}
JSONStorage.prototype.listDir = function(dir, noCreate) {
    return this._fs.list(this._path + '/' + dir, !noCreate);
}
JSONStorage.prototype.acquireLock = function(path) {
    var lthis = this;
    var maxAge = 4000; /* remove locks older than four seconds */
    var retryTime = 100; /* retry every 100 ms */

    return this._fs.acquireLock(this._path + '/' + path + '_lock').pipe(function(success, age) {
        if (success)
            return true;
        if (age < maxAge) {
            var d = $.Deferred();
            window.setTimeout(function() {
                lthis.acquireLock(path)
                    .done(function() { d.resolve.apply(d, arguments); })
                    .fail(function() { d.reject.apply(d, arguments); });
            }, retryTime);
            return d.promise();
        } else {
            logger.showDebug("Forcibly removed lock on " + path);
            return lthis._fs.releaseLock(lthis._path + '/' + path + '_lock').pipe(function() {
                return lthis.acquireLock(path);
            });
        }
    });
}
JSONStorage.prototype.releaseLock = function(path) {
    /* XXX ignore errors for inexistent locks? */
    return this._fs.releaseLock(this._path + '/' + path + '_lock');
}

return JSONStorage;
});
