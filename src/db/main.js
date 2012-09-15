/* this file has circular dependencies with db/objects
 * we use the special exports object to overcome that */
define(['jquery', 'crypto', 'ui/logger',
        'util/events', 'util/deferredsynchronizer',
        'db/jsonstorage', 'db/objects', 'db/objectcache',
        'exports'],
        function($, Crypto, logger,
                 Events, DeferredSynchronizer,
                 JSONStorage, Objects, objectCache,
                 exports) {
"use strict";

function DBInterface(path, remote) {
    this._storage = new JSONStorage(path);
    this._remote = remote;

    this._changeInterval = null;
    this._initialized = false;
    this._lastChangeSeq = 0;
    this._changeSeqsToIgnore = {};

    this._suppressedChangeLogEntries = [[], []];

    if (remote) {
        this._initialized = true;
    } else {
        var lthis = this;
        window.setTimeout(function() {
            lthis._initMergeService();
            lthis._initChangeListener();
        }, 10);
    }
}
/* XXX should be pulled out to its own class */
/* XXX in that class, change the file layout to use subdirectories using the
 * following scheme:
 * file 3765 is put into 4/3/7/6/5 (where the first number is the length)
 * file 37xx is put into 4/3/7/summary (XXX find a better name)
 */
DBInterface.prototype._getChange = function(seq) {
    return this._storage.read('data/changes/' + seq);
}
DBInterface.prototype._getChangeSummary = function(prefix, droppedDigits) {
    return this._storage.read('data/changes/' + prefix + (new Array(droppedDigits + 1)).join('x'));
}
DBInterface.prototype._writeChangeSummary = function(prefix, droppedDigits, data) {
    return this._storage.write('data/changes/' + prefix + (new Array(droppedDigits + 1)).join('x'), data);
}
DBInterface.prototype._changeExists = function(seq) {
    return this._storage.exists('data/changes/' + seq);
}
DBInterface.prototype._determineLastChangeSeq = function() {
    return this._storage.listDir('data/changes').pipe(function(files) {
        var largest = 0;
        files.forEach(function(f) {
            if (f.match(/^\d*$/) && f - 0 > largest)
                largest = f - 0;
        });
        return largest;
    });
}
/* XXX remove changeInterval on destruction */
DBInterface.prototype._initChangeListener = function() {
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
                        lthis._sendChangeToCache(doc);
                        lthis._trigger('change', doc);
                    });
                });
            });
        });

    }
    this._determineLastChangeSeq().pipe(function(changeSeq) {
        lthis._lastChangeSeq = changeSeq;
        lthis._changeInterval = window.setInterval(checkForChanges, 1000);
        lthis._initialized = true;
        return lthis._initCache();
    }, function(err) {
        lthis._trigger('init error', "Error initializing database: " + err);
    });
}
DBInterface.prototype._initCache = function() {
    if (this.remote) /* this should actually not be called */
        return true;

    var lthis = this;
    return $.when(this.getAllNotes(), this.getAllSyncTargets()).pipe(function(notes, syncTargets) {
        objectCache.initialize(notes, syncTargets);
        lthis._trigger('ready');
    });
}
DBInterface.prototype._sendChangeToCache = function(doc) {
    if (this.remote)
        return;

    try {
        if (doc.type === 'note') {
            objectCache.noteChanged(Objects.createFromDBData(doc));
        } else if (doc.type === 'syncTarget') {
            objectCache.syncTargetChanged(Objects.createFromDBData(doc));
        }
    } catch (e) {
        console.log(e);
        logger.showDebug("Error sending change to cache: " + e.message);
    }
}
DBInterface.prototype._initMergeService = function() {
    var lthis = this;
    var dataFile = 'data_local/remoteChangesMergedUntil';
    var runningMyself = false;
    var mergeChanges = function() {
        if (runningMyself) return;
        runningMyself = true;
        lthis._storage.acquireLock(dataFile).pipe(function() {
            lthis._storage.read(dataFile)
                .pipe(function(data) { return mergeAfter(data || 0); },
                      function() { return mergeAfter(0); })
                .done(function() {
                    lthis._storage.releaseLock(dataFile);
                    runningMyself = false;
                });
        });
    }
    var mergeAfter = function(seq) {
        return lthis.changedRevisions(null, seq, true).pipe(function(res) {
            if (res.lastSeq === seq)
                return;
            return lthis.getDocs(res.revisions).pipe(function(revData) {
                var revisions = [];
                revData.forEach(function(o) {
                    try {
                        o = Objects.createFromDBData(o, 'noteRevision');
                    } catch(e) {
                        console.log(e);
                        return;
                    }
                    revisions.push(o);
                });
                var headRevisions = Objects.NoteRevision.determineHeadRevisions(revisions);
                return DeferredSynchronizer($.map(headRevisions, function(revisions, noteID) {
                    /* TODO merge these in one change file */
                    return Objects.Note.mergeHeadsAndUpdate(noteID, revisions);
                })).pipe(function() {
                    return lthis._storage.write(dataFile, res.lastSeq);
                });
            });
        });
    }

    /* XXX use a flag that indicates if the change was a remote change, then the
     * change file is read only once */
    this.on('change', mergeChanges);
    this.on('ready', mergeChanges);
}
DBInterface.prototype.determineAvailableNoteRevisions = function(keys) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    var available = {};
    return DeferredSynchronizer(keys.map(function(key) {
        /* XXX sanity check for key */
        return lthis._storage.exists('data/notes/' + key).pipe(function(res) {
                if (res) available[key] = 1;
            });
    })).pipe(function() {
        return available;
    });
}
DBInterface.prototype.getAllNotes = function() {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    return this._storage.readFilesInDir('data_local/notes').pipe(function(objs) {
        var notes = [];
        objs.forEach(function(o) {
            try {
                notes.push(Objects.createFromDBData(o, 'note'));
            } catch (e) {
                console.log(e);
            }
        });
        return notes;
    });
}
DBInterface.prototype.getAllSyncTargets = function() {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();
    
    var lthis = this;
    var path = this._path;
    return this._storage.readFilesInDir('data_local/syncTargets').pipe(function(objs) {
        var targets = [];
        objs.forEach(function(o) {
            try {
                targets.push(Objects.createFromDBData(o, 'syncTarget'));
            } catch (e) {
                console.log(e);
            }
        });
        return targets;
    });
}
DBInterface.prototype.getDoc = function(id) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    return this._getDoc(id);
}
DBInterface.prototype._getDoc = function(id) {
    if (!id.match(/^[a-zA-Z0-9\/]*$/))
        return $.Deferred().reject("Invalid document id.").promise();

    var lthis = this;
    if (id.match(/\//)) {
        return this._storage.read('data/notes/' + id);
    } else {
        return this._storage.read('data_local/notes/' + id).pipe(null,
            function(err) {
                return lthis._storage.read('data_local/syncTargets/' + id);
            });
    }
}
DBInterface.prototype.getDocs = function(ids) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    return DeferredSynchronizer($.map(ids, function(id) {
        return lthis._getDoc(id);
    }));
}
DBInterface.prototype.getRevisionMetadata = function(noteID) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    var path = this._path;
    return this._storage.readFilesInDir('data/notes/' + noteID, true).pipe(function(objList) {
        var objs = {};
        objList.forEach(function(o) {
            try {
                delete o.text;
                objs[o._id] = o;
            } catch (e) {
                console.log(e);
            }
        });
        return objs;
    });
}
DBInterface.prototype.getAllRevisions = function() {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    var allRevisions = [];

    return this._storage.listDir('data/notes/').pipe(function(notes) {
        var procs = [];
        return DeferredSynchronizer(notes.map(function(note) {
            return lthis._storage.listDir('data/notes/' + note).pipe(function(revs) {
                revs.forEach(function(rev) {
                    allRevisions.push(note + '/' + rev);
                });
            });
        })).pipe(function() {
            return allRevisions;
        });
    });
}
/* noteID can be: note also works for an array of noteIDs
 * and even for a noteID -> seqID mapping */
DBInterface.prototype.changedRevisions = function(noteID, after, onlyRemoteChanges) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    var revs = [];
    var idPrefix = 'data/notes/';
    var matches;
    if (noteID === null) {
        matches = function(path) { return path.substr(0, idPrefix.length) === idPrefix; };
    } else if ($.isArray(noteID)) {
        var noteIDs = {};
        noteID.forEach(function(nid) { noteIDs[nid] = 1; });
        matches = function(path) {
            var m = path.match(/data\/notes\/([^\/]*)/);
            return (m && m[1] in noteIDs);
        }
    } else if (typeof(noteID) === 'string') {
        var notePrefix = idPrefix + noteID + '/';
        var prefixLength = notePrefix.length;
        matches = function(path) { return path.substr(0, prefixLength) === noteID; };
    } else {
        /* assume object */
        var after = Math.min.apply(Math, $.map(noteID, function(seq) { return seq; }));
        matches = function(path, seq) {
            var m = path.match(/data\/notes\/([^\/]*)/);
            if (!m) return false;
            var id = m[1];
            return (id in noteID && seq > noteID[id]);
        }
    }

    return this._getChanges(after + 1, null, function(seq, data) {
        if (!onlyRemoteChanges || data.type === 'remote') {
            data.changes.forEach(function(path) {
                if (matches(path, seq))
                    revs.push(path.substr(idPrefix.length));
            });
        }
    }).pipe(function(lastSeq) {
        return $.when({lastSeq: lastSeq, revisions: revs});
    });
}
/* callback(i, changes) is called for each from <= i <= to
 * to can be null denoting the larget change available
 * returns the sequence number of the last change
 */
DBInterface.prototype._getChanges = function(from, to, callback) {
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
                return lthis._getChanges.apply(lthis, args).pipe(function(ret) {
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

        return this._getChanges(from, splitPoint - 1, callback).pipe(function(ret) {
            if (ret !== splitPoint - 1)
                return ret;
            return lthis._getChanges(splitPoint, to, callback);
        });
    }
}
DBInterface.prototype._getPathForDoc = function(doc) {
    if (doc.type === 'note') {
        return 'data_local/notes/' + doc._id;
    } else if (doc.type === 'noteRevision') {
        return 'data/notes/' + doc._id;
    } else if (doc.type === 'syncTarget') {
        return 'data_local/syncTargets/' + doc._id;
    } else {
        return null;
    }
}
DBInterface.prototype._saveDoc = function(doc, options) {
    var lthis = this;
    options = options || {};

    if (!('_id' in doc)) {
        if (doc.type === 'noteRevision') {
            doc._id = doc.note + '/' + this._genID();
        } else {
            doc._id = this._genID();
        }
    }
    if (!options['suppressRevCheck']) {
        if (!('_rev' in doc))
            doc._rev = '0-x';
        doc._rev = this._getIncrementedRev(doc);
    }

    var path = this._getPathForDoc(doc);
    if (path === null) {
        return $.Deferred().reject("Invalid document type.").promise();
    }

    /* XXX also release the lock on errors */

    if (options['suppressLocking']) {
        return this._storage.write(path, doc).pipe(logChange);
    }
    return this._storage.acquireLock(path).pipe(function() {
        return lthis._storage.read(path).pipe(function(olddoc) {
            if (olddoc._rev === doc._rev) {
                /* no conflict, no save */
                return lthis._storage.releaseLock(path).pipe(function() { return null; });
            } else if (!lthis._olderRev(olddoc._rev, doc._rev)) {
                /* conflict */
                return lthis._storage.releaseLock(path).pipe(function() { return olddoc; });
            } else {
                return writeAndReleaseLock();
            }
        }, function() {
            return writeAndReleaseLock();
        });
    });

    function writeAndReleaseLock() {
        return lthis._storage.write(path, doc).pipe(function() {
            return lthis._storage.releaseLock(path).pipe(logChange);
        });
    }
    function logChange() {
        if (options['suppressChangeLog']) {
            lthis._suppressedChangeLogEntries[0].push(path);
            lthis._suppressedChangeLogEntries[1].push(doc);
            return null;
        }
        return lthis._logChanges([path], [doc]).pipe(function() {
            return null;
        });
    }
}
DBInterface.prototype.logSuppressedChanges = function() {
    var changes = this._suppressedChangeLogEntries[0];
    var docs = this._suppressedChangeLogEntries[1];
    this._suppressedChangeLogEntries = [[], []];
    return this._logChanges(changes, docs);
}
DBInterface.prototype._logChanges = function(changes, docs) {
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
            return lthis._storage.write(lthis._path + '/data/changes/' + i, data).pipe(function() {
                return lthis._storage.releaseLock('data/changes').pipe(function() {
                    if (i % 10 === 9) {
                        lthis._writeChangeSummaryFiles(i);
                    }
                    if (!lthis._remote) {
                        docs.forEach(function(doc) {
                            lthis._sendChangeToCache(doc);
                            lthis._trigger('change', doc);
                        });
                    }
                    return true;
                });
            });
        });
    });
}
DBInterface.prototype._writeChangeSummaryFiles = function(seq) {
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
DBInterface.prototype._writeChangeSummaryFile = function(prefix, digits) {
    var lthis = this;

    var changes = {};
    var exp = Math.pow(10, digits);
    return this._getChanges(prefix * exp, (prefix + 1) * exp - 1, function(seq, change) {
        changes[seq] = change;
    }).pipe(function() {
        return lthis._writeChangeSummary(prefix, digits, changes);
    });
}
DBInterface.prototype.saveDoc = function(doc, options) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    return this._saveDoc(doc, options).pipe(function(res) {
        if (res !== null) {
            /* res is conflicting object */
            return $.Deferred().reject("Conflict.", true, res).promise();
        } else {
            return doc;
        }
    });
}
DBInterface.prototype.saveRevisions = function(docs) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    return DeferredSynchronizer($.map(docs, function(doc) {
        return lthis._saveDoc(doc, {'suppressChangeLog': true,
                                    'suppressRevCheck': true,
                                    'suppressLocking': true});
    })).pipe(function() {
        return lthis.logSuppressedChanges();
        /* XXX return value and conflicts are currently ignored */
    });
}
DBInterface.prototype._genID = function() {
    var id = '';
    var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (var i = 0; i < 22; i ++) {
        id += chars[Math.floor((Math.random() * chars.length))];
    }
    return id;
}
DBInterface.prototype._getIncrementedRev = function(doc) {
    var copy = $.extend(true, {}, doc);
    var num = (copy._rev.split('-')[0] - 0) + 1;
    delete copy._rev;

    /* XXX use some normal form */
    return num + '-' + Crypto.md5(JSON.stringify(copy));
}
DBInterface.prototype._olderRev = function(reva, revb) {
    var partsa = reva.split('-');
    var partsb = revb.split('-');
    return (partsa[0] - 0 < partsb[0] - 0);
}
Events(DBInterface, ['ready', 'change', 'init error']);

exports.DBInterface = DBInterface;
exports.local = new DBInterface();
});
