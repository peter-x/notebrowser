/* this file has circular dependencies with db/objects
 * we use the special exports object to overcome that */
define(['jquery', 'ui/logger',
        'util/events', 'util/deferredsynchronizer'],
        function($, logger,
                 Events, DeferredSynchronizer) {
"use strict";

/* XXX perhaps change the file layout to use subdirectories using the
 * following scheme:
 * file 3765 is put into 4/3/7/6/5 (where the first number is the length)
 * file 37xx is put into 4/3/7/summary (XXX find a better name)
 */
function ChangeLog(storage, remote) {
    this._storage = storage;
    this._remote = remote;

    this._changeInterval = null;
    this._lastChangeSeq = 0;
    this._changeSeqsToIgnore = {};

    this._postponedChangeLogEntries = [[], []];
}
/* XXX remove changeInterval on destruction */
ChangeLog.prototype.initChangeListener = function() {
    var lthis = this;

    function checkForChanges() {
        /* XXX avoid duplicate change notifications */
        var i = lthis._lastChangeSeq + 1;
        lthis._changeExists(i).done(function(ex) {
            /* XXX what if it exists but is still empty? */
            if (!ex) return;
            lthis._lastChangeSeq = Math.max(lthis._lastChangeSeq, i);
            if (lthis._changeSeqsToIgnore[i]) {
                delete lthis._changeSeqsToIgnore[i];
                return;
            }
            lthis._getChange(i).done(function(change) {
                change.changes.forEach(function(path) {
                    lthis._storage.read(path).done(function(doc) {
                        lthis._trigger('change', doc);
                    });
                });
            });
        });

    }
    return this._determineLastChangeSeq().pipe(function(changeSeq) {
        lthis._lastChangeSeq = changeSeq;
        lthis._changeInterval = window.setInterval(checkForChanges, 1000);
        return true;
    });
}
ChangeLog.prototype._getChange = function(seq) {
    return this._storage.read('data/changes/' + seq);
}
ChangeLog.prototype._getChangeSummary = function(prefix, droppedDigits) {
    return this._storage.read('data/changes/' + prefix + (new Array(droppedDigits + 1)).join('x'));
}
ChangeLog.prototype._writeChangeSummary = function(prefix, droppedDigits, data) {
    return this._storage.write('data/changes/' + prefix + (new Array(droppedDigits + 1)).join('x'), data);
}
ChangeLog.prototype._changeExists = function(seq) {
    return this._storage.exists('data/changes/' + seq);
}
ChangeLog.prototype._determineLastChangeSeq = function() {
    return this._storage.listDir('data/changes').pipe(function(files) {
        var largest = 0;
        files.forEach(function(f) {
            if (f.match(/^\d*$/) && f - 0 > largest)
                largest = f - 0;
        });
        return largest;
    });
}
/* callback(i, changes) is called for each from <= i <= to
 * to can be null denoting the larget change available
 * returns the sequence number of the last change
 */
ChangeLog.prototype.getChanges = function(from, to, callback) {
    var lthis = this;
    /*
     * summary files are written after a file that ends in 9
     * it contains all indices and the data
     */
    /* request for changes between 7 and 995
     * -> read 7, 8, 9, 1x, 2x, ..., 9x, 1xx, 2xx, ..., 9xx
     * request for changes between 7443 and 7484
     * -> do not read 7xxx but read 74xx
     */


    function findLongestCommonPrefix(f, t) {
        if (t === null || f.length !== t.length || f[0] !== t[0])
            return null;

        if (f === t)
            return {prefix: f, f: '', t: ''};

        var p = 0;
        while (f[p] === t[p]) p ++;

        return {prefix: f.substr(0, p),
                f: f.substr(p),
                t: f.substr(p)};
    }
    function nextPowerOfTen(x, digits) {
        var p = Math.pow(10, digits);
        return (Math.floor(x / p) + 1) * p;
    }

    if (from === to) {
        return this._getChange(from).pipe(function(data) {
            callback(from, data);
            return from;
        }, function(err) {
            /* XXX more robust error type detection */
            if (err.substr(0, 14) === "Error decoding") {
                return $.when(from);
            } else {
                return $.when(from - 1);
            }
        });
    }

    var p = findLongestCommonPrefix('' + from, to === null ? null : '' + to);

    if (p !== null) {
        return this._getChangeSummary(p.prefix - 0, p.f.length).pipe(function(summary) {
            for (var i = from; i <= to; i ++) {
                callback(i, summary[i]);
            }
            return to;
        }, function() {
            /* summary is not available, go one level deeper */
            var calls = [];

            var digits = p.f.length - 1;
            var s = from;
            var n = nextPowerOfTen(from, digits);
            while (n - 1 < to) {
                calls.push([s, n - 1, callback]);
                s = n;
                n = nextPowerOfTen(n, digits);
            }
            calls.push([s, to, callback]);
            function loop() {
                if (calls.length == 0)
                    return $.when(to);

                var args = calls.shift();
                return lthis.getChanges.apply(lthis, args).pipe(function(ret) {
                    if (ret === args[1]) { /* everything worked */
                        return loop();
                    } else {
                        return ret;
                    }
                });
            }
            return loop();
        });
    } else {
        var digits = ('' + from).length - 1;
        var splitPoint = nextPowerOfTen(from, digits);

        return this.getChanges(from, splitPoint - 1, callback).pipe(function(ret) {
            if (ret !== splitPoint - 1)
                return ret;
            return lthis.getChanges(splitPoint, to, callback);
        });
    }
}
/* only possible for local changes */
ChangeLog.prototype.postponeLogging = function(path, data) {
    this._postponedChangeLogEntries[0].push(path);
    this._postponedChangeLogEntries[1].push(data);
}
ChangeLog.prototype.logPostponedChanges = function() {
    var changes = this._postponedChangeLogEntries[0];
    var docs = this._postponedChangeLogEntries[1];
    this._postponedChangeLogEntries = [[], []];
    return this.logChanges(changes, docs);
}
ChangeLog.prototype.logChanges = function(changes, docs) {
    var lthis = this;
    var i = this._lastChangeSeq;

    if (changes.length === 0 && docs.length === 0) {
        return $.when(true);
    }

    function findNextFreeChangeFile(i) {
        return lthis._storage.exists('data/changes/' + i).pipe(function(ex) {
            return ex ? findNextFreeChangeFile(i + 1) : i;
        });
    }
    var data = {type: this._remote ? 'remote' : 'local', changes: changes};
    return this._storage.acquireLock('data/changes').pipe(function() {
        return findNextFreeChangeFile(lthis._lastChangeSeq + 1).pipe(function(i) {
            lthis._changeSeqsToIgnore[i] = 1;
            return lthis._storage.write('data/changes/' + i, data).pipe(function() {
                return lthis._storage.releaseLock('data/changes').pipe(function() {
                    if (i % 10 === 9) {
                        lthis._writeChangeSummaryFiles(i);
                    }
                    if (!lthis._remote) {
                        docs.forEach(function(doc) {
                            lthis._trigger('change', doc);
                        });
                    }
                    return true;
                });
            });
        });
    });
}
ChangeLog.prototype._writeChangeSummaryFiles = function(seq) {
    var digits = 1;
    while (true) {
        var exp = Math.pow(10, digits);
        if (exp > seq + 1 || (seq + 1) % exp !== 0)
            return;

        var prefix = Math.floor(seq / exp);
        this._writeChangeSummaryFile(prefix, digits);
        digits ++;
    }
}
ChangeLog.prototype._writeChangeSummaryFile = function(prefix, digits) {
    var lthis = this;

    var changes = {};
    var exp = Math.pow(10, digits);
    return this.getChanges(prefix * exp, (prefix + 1) * exp - 1, function(seq, change) {
        changes[seq] = change;
    }).pipe(function() {
        return lthis._writeChangeSummary(prefix, digits, changes);
    });
}
Events(ChangeLog, ['change']);

return ChangeLog;
});
