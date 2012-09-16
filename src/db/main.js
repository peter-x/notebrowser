/* this file has circular dependencies with db/objects
 * we use the special exports object to overcome that */
define(['jquery', 'crypto', 'ui/logger',
        'util/events', 'util/deferredsynchronizer',
        'db/jsonstorage', 'db/objects', 'db/changelog', 'db/objectcache',
        'exports'],
        function($, Crypto, logger,
                 Events, DeferredSynchronizer,
                 JSONStorage, Objects, ChangeLog, objectCache,
                 exports) {
"use strict";

function DBInterface(path, remote) {
    path = path || this._pathFromDocumentLocation();
    this._storage = new JSONStorage(path);
    this._remote = remote;

    this._sharedChangeLog = new ChangeLog(new JSONStorage(path + '/data/changes'), remote);
    this._localChangeLog = null;
    if (!this._remote)
        this._localChangeLog = new ChangeLog(new JSONStorage(path + '/data_local/changes'), false);

    this._initialized = false;

    if (remote) {
        this._initialized = true;
    } else {
        var lthis = this;
        window.setTimeout(function() {
            lthis._initMergeService();

            var onChange = function(path, changeType, doc) {
                var forwardChange = function(doc, changeType) {
                    lthis._sendChangeToCache(doc);
                    lthis._trigger('change', doc, changeType);
                }
                if (doc === undefined) {
                    lthis._storage.read(path).pipe(function(doc) {
                        forwardChange(doc, changeType);
                    });
                } else {
                    forwardChange(doc, changeType);
                }
            }
            lthis._localChangeLog.on('change', onChange);
            lthis._sharedChangeLog.on('change', onChange);
            lthis._localChangeLog.initChangeListener().pipe(function() {
                lthis._sharedChangeLog.initChangeListener().pipe(function() {
                    lthis._initialized = true;
                    return lthis._initCache();
                }, function(err) {
                    lthis._trigger('init error', "Error initializing database: " + err);
                });
            }, function(err) {
                lthis._trigger('init error', "Error initializing database: " + err);
            });
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

    this._sharedChangeLog.on('change', function(path, changeType, doc) {
        if (changeType === 'remote')
            mergeChanges();
    });

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
    var docs = [];
    return DeferredSynchronizer($.map(ids, function(id) {
        return lthis._getDoc(id).pipe(function(doc) {
            if (typeof(doc) === 'object' && '_id' in doc)
                docs.push(doc);
        });
    })).pipe(function() {
        return docs;
    });
}
DBInterface.prototype.getRevisionMetadata = function(noteID) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
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

    return this._sharedChangeLog.getChanges(after + 1, null, function(seq, data) {
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
        var changelog = (path.substr(0, 10) === 'data_local' ?
                            lthis._localChangeLog : lthis._sharedChangeLog);
        if (options['postponeChangeLog']) {
            changelog.postponeLogging(path, doc);
            return null;
        }
        return changelog.logChanges([path], [doc]).pipe(function() {
            return null;
        });
    }
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
        return lthis._saveDoc(doc, {'postponeChangeLog': true,
                                    'suppressRevCheck': true,
                                    'suppressLocking': true});
    })).pipe(function() {
        return lthis.logPostponedChanges();
        /* XXX return value and conflicts are currently ignored */
    });
}
DBInterface.prototype.logPostponedChanges = function() {
    return DeferredSynchronizer([this._localChangeLog.logPostponedChanges(),
                                 this._sharedChangeLog.logPostponedChanges()]);
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
