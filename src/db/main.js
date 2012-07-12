/* this file has circular dependencies with db/objects
 * we use the special exports object to overcome that */
define(['jquery', 'crypto', 'ui/logger',
        'util/events', 'util/deferredsynchronizer',
        'db/objects', 'db/accessors', 'db/objectcache',
        'exports'],
        function($, Crypto, logger,
                 Events, DeferredSynchronizer,
                 Objects, Accessors, objectCache,
                 exports) {
"use strict";

function DBInterface(path, remote) {
    this._path = path || this._pathFromDocumentLocation();
    this._fs = null;
    this._remote = remote;

    this._changeInterval = null;
    this._initialized = false;
    this._lastChangeSeq = 0;
    this._changeSeqsToIgnore = {};

    this._suppressedChangeLogEntries = [[], []];

    this._fs = Accessors(this._path);

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
DBInterface.prototype._pathFromDocumentLocation = function() {
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
/* XXX remove changeInterval on destruction */
DBInterface.prototype._initChangeListener = function() {
    var lthis = this;

    function checkForChanges() {
        /* XXX avoid duplicate change notifications */
        var i = lthis._lastChangeSeq + 1;
        lthis._fs.exists(lthis._path + '/data/changes/' + i).done(function(ex) {
            /* XXX what if it exists but is still empty? */
            if (!ex) return;
            lthis._lastChangeSeq = Math.max(lthis._lastChangeSeq, i);
            if (lthis._changeSeqsToIgnore[i]) {
                delete lthis._changeSeqsToIgnore[i];
                return;
            }
            lthis._readJSON('data/changes/' + i).done(function(change) {
                change.changes.forEach(function(path) {
                    lthis._readJSON(path).done(function(doc) {
                        lthis._sendChangeToCache(doc);
                        lthis._trigger('change', doc);
                    });
                });
            });
        });

    }
    lthis._listDir('data/changes').pipe(function(files) {
        var largest = 0;
        files.forEach(function(f) {
            if (f !== 'lock' && f - 0 > largest)
                largest = f - 0;
        });
        lthis._lastChangeSeq = largest;
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
        lthis._acquireLock(dataFile).pipe(function() {
            lthis._readJSON(dataFile)
                .pipe(function(data) { return mergeAfter(data || 0); },
                      function() { return mergeAfter(0); })
                .done(function() {
                    lthis._releaseLock(dataFile);
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
                    return lthis._fs.write(lthis._path + '/' + dataFile, '' + res.lastSeq);
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
        return lthis._fs.exists(lthis._path + '/data/notes/' + key).pipe(function(res) {
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
    return this._readJSONFilesInDir('data_local/notes').pipe(function(objs) {
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
    return this._readJSONFilesInDir('data_local/syncTargets').pipe(function(objs) {
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
DBInterface.prototype._readJSONFilesInDir = function(dir, noCreate) {
    var lthis = this;
    return this._listDir(dir, noCreate).pipe(function(files) {
        var processes = [];
        files.forEach(function(f) {
            if (!f.match('\.lock$'))
                processes.push(lthis._readJSON(dir + '/' + f));
        });
        return DeferredSynchronizer(processes);
    });
}
DBInterface.prototype._readJSON = function(path) {
    return this._fs.read(this._path + '/' + path).pipe(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return $.Deferred().reject("JSON error: " + e.message).promise();
        }
    });
}
DBInterface.prototype._listDir = function(dir, noCreate) {
    return this._fs.list(this._path + '/' + dir, !noCreate);
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
        return this._readJSON('data/notes/' + id);
    } else {
        return this._readJSON('data_local/notes/' + id).pipe(null,
            function(err) {
                return lthis._readJSON('data_local/syncTargets/' + id);
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
    return this._readJSONFilesInDir('data/notes/' + noteID, true).pipe(function(objList) {
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

    function getChanges(i) {
        return lthis._readJSON('data/changes/' + i).pipe(function(data) {
            if (!onlyRemoteChanges || data.type === 'remote') {
                data.changes.forEach(function(path) {
                    if (matches(path, i))
                        revs.push(path.substr(idPrefix.length));
                });
            }
            return getChanges(i + 1);
        }, function(err) {
            /* XXX more robust error type detection */
            if (err.substr(0, 10) === "JSON error") {
                return getChanges(i + 1);
            } else {
                return $.when({lastSeq: i - 1, revisions: revs});
            }
        });
    }
    
    return getChanges(after + 1);
}
DBInterface.prototype._acquireLock = function(path) {
    var lthis = this;
    var maxAge = 4000; /* remove locks older than four seconds */
    var retryTime = 100; /* retry every 100 ms */

    return this._fs.acquireLock(this._path + '/' + path + '.lock').pipe(function(success, age) {
        if (success)
            return true;
        if (age < maxAge) {
            var d = $.Deferred();
            window.setTimeout(function() {
                lthis._acquireLock(path)
                    .done(function() { d.resolve.apply(d, arguments); })
                    .fail(function() { d.reject.apply(d, arguments); });
            }, retryTime);
            return d.promise();
        } else {
            logger.showDebug("Forcibly removed lock on " + path);
            return lthis._fs.releaseLock(lthis._path + '/' + path + '.lock').pipe(function() {
                return lthis._acquireLock(path);
            });
        }
    });
}
DBInterface.prototype._releaseLock = function(path) {
    /* XXX ignore errors for inexistent locks? */
    return this._fs.releaseLock(this._path + '/' + path + '.lock');
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

    var data;
    try {
        data = JSON.stringify(doc);
    } catch (e) {
        return $.Deferred().reject("Invalid data in document: " + e.message).promise();
    }
    if (options['suppressLocking']) {
        return this._fs.write(this._path + '/' + path, data).pipe(logChange);
    }
    return this._acquireLock(path).pipe(function() {
        return lthis._readJSON(path).pipe(function(olddoc) {
            if (olddoc._rev === doc._rev) {
                /* no conflict, no save */
                return lthis._releaseLock(path).pipe(function() { return null; });
            } else if (!lthis._olderRev(olddoc._rev, doc._rev)) {
                /* conflict */
                return lthis._releaseLock(path).pipe(function() { return olddoc; });
            } else {
                return writeAndReleaseLock();
            }
        }, function() {
            return writeAndReleaseLock();
        });
    });

    function writeAndReleaseLock() {
        return lthis._fs.write(lthis._path + '/' + path, data).pipe(function() {
            return lthis._releaseLock(path).pipe(logChange);
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
        return lthis._fs.exists(lthis._path + '/data/changes/' + i).pipe(function(ex) {
            return ex ? findNextFreeChangeFile(i + 1) : i;
        });
    }
    var data = JSON.stringify({type: this._remote ? 'remote' : 'local', changes: changes});
    return this._acquireLock('data/changes').pipe(function() {
        return findNextFreeChangeFile(lthis._lastChangeSeq + 1).pipe(function(i) {
            lthis._changeSeqsToIgnore[i] = 1;
            return lthis._fs.write(lthis._path + '/data/changes/' + i, data).pipe(function() {
                return lthis._releaseLock('data/changes').pipe(function() {
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
