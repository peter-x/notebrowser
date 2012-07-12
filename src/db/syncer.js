define(['jquery', 'ui/logger', 'db/main', 'db/objectcache',
        'util/deferredsynchronizer',
        'db/objects/noterevision', 'db/objects/note'],
        function($, logger, DB, objectCache, DeferredSynchronizer,
                 NoteRevision, Note) {
"use strict";

function doSync(target) {
    var messageBox = logger.showInfo("Synchronizing with " + target.getName());

    var remoteDB = new DB.DBInterface(target.getURL(), true);

    /* XXX this should be moved to the DB interface */
    if (!$.support.cors) {
        try {
            if (netscape.security.PrivilegeManager.enablePrivilege) {
                netscape.security.PrivilegeManager.enablePrivilege("UniversalBrowserRead");
            }
        } catch(e) {
            logger.showError("Error enabling UniversalBrowserRead: " + e.message);
        }
    }

    /* TODO reformat the error */

    logger.showInfo("Requesting changes since " + target.getRemoteSeq(), messageBox);
    return remoteDB.changedRevisions(null, target.getRemoteSeq()).pipe(function(remoteChanges) {
        /* TODO make this robust, catch exceptions and report them */
        /* XXX actually we should ask for the ids that are not missing... */
        return DB.local.determineAvailableNoteRevisions(remoteChanges.revisions).pipe(function(availableObjs) {
            var objectsToFetch = remoteChanges.revisions.filter(function(id) { return !(id in availableObjs); });
            return fetchRevisions(target, remoteDB, objectsToFetch, remoteChanges.lastSeq, messageBox);
        });
    });
}
function fetchRevisions(target, remoteDB, ids, lastSeq, messageBox) {
    /* TODO fetch them in batches */
    return remoteDB.getDocs(ids).pipe(function(objs) {
        var remoteObjects = {};
        var occuringParents = {};
        objs.forEach(function(o) {
            try {
                o = new NoteRevision(o);
            } catch(e) {
                console.log(e);
                return;
            }
            remoteObjects[o.getID()] = o;
            o.getParents().forEach(function(p) { occuringParents[p] = 1; });
        });
        return DB.local.determineAvailableNoteRevisions(Object.keys(occuringParents)).pipe(function(availableParents) {
                var checkedObjects = {};
                /* XXX replace checking by less redundant data file,
                 * do not even check if parents exist.
                 * note that in this case, we could request a merge without
                 * a common ancestor! */
                function objectAndParentsExist(id) {
                    if (id in checkedObjects || id in availableParents) return true;
                    var obj = remoteObjects[id];
                    if (obj === undefined) return false;
                    if (obj.getParents().some(function(pID) { return !objectAndParentsExist(pID); }))
                        return false;
                    checkedObjects[obj.getID()] = obj;
                    return true;
                }

                $.each(remoteObjects, function(id, o) { 
                    if (!objectAndParentsExist(id)) {
                        /* XXX some error */
                        logger.showInfo("Parent missing: " + id, messageBox);
                    }
                });

                logger.showInfo("Valid objects: " + Object.keys(checkedObjects).length, messageBox);
                var docList = $.map(checkedObjects, function(o) { return o.getDBObject(); });
                return DB.local.saveRevisions(docList).pipe(function(res) {
                        /* TODO handle conflicts and save errors,
                         * update the objects? */

                        /* TODO really do this in parallel? */
                        var processes = $.map(NoteRevision.determineHeadRevisions($.map(checkedObjects, function(x) { return x; }),
                                                function(revisions, noteID) {
                            /* TODO merge these in one change file */
                            if (target.isSelective()) {
                                /* TODO we do not want arbitrary people to cause
                                 * our notes to be merged we do not have marked
                                 * to be synchronized
                                 */
                                /* TODO */
                                return;
                            }
                            return Note.mergeHeadsAndUpdate(noteID, revisions).pipe(function(res) {
                                var type = res[0];
                                var note = res[1];
                                if (type === "unchanged")
                                    return;
                                var link = $('<a/>', {href: '#' + noteID}).text(note.getTitle());
                                var text = '';
                                if (type === "new") {
                                    text = 'New Note: ';
                                } else if (type === "fast-forward") {
                                    text = 'Note changed: ';
                                } else {
                                    text = 'Note merged: ';
                                }
                                logger.showInfo($("<span/>").text(text).append(link), messageBox, true);
                            });
                        }));
                        /* XXX suppress change log */
                        processes.push(target.setRemoteSeq(lastSeq));
                        return DeferredSynchronizer(processes).pipe(function() {
                            /* XXX errors? */
                            return pushRevisions(target, checkedObjects, messageBox);
                        });
                    });
            });
    });
}
function pushRevisions(target, revsToIgnore, messageBox) {
    logger.showInfo("Pushing objects to remote server.", messageBox);
    
    /* XXX do a complete sync until we find a good way to specify
     * whith note to sync */
    var notes;
    var proc;
    if (target.isSelective()) {
        notes = objectCache.getNotesBySyncTarget(target.getID());
        var noteSeqs = {};
        $.each(notes, function(id, note) {
            noteSeqs[id] = note.getLocalSeq(target.getID()) || 0;
        });
        proc = DB.local.changedRevisions(noteSeqs);
    } else {
        notes = objectCache.getAllNotes();
        proc = DB.local.changedRevisions(null, target.getLocalSeq());
    }

    return proc.pipe(function(res) {
        var revisionIDsToPush = [];
        res.revisions.forEach(function(rev) {
            if (rev in revsToIgnore)
                revisionIDsToPush.push(rev);
        });
        var lastSeq = res.lastSeq;
        var remoteDB = new DB.DBInterface(target.getURL(), true);
        logger.showInfo("Objs to push: " + revisionIDsToPush.length, messageBox);
        /* TODO we could have errors in some processes */
        return DB.local.getDocs(revisionIDsToPush).pipe(function(objs) {
            return remoteDB.saveRevisions(objs).pipe(function() {
                var proc;
                if (target.isSelective()) {
                    proc = DeferredSynchronizer($.map(notes, function(note) {
                        return note.setLocalSeq(target.getID(), lastSeq, {'suppressChangeLog': true});
                    }));
                } else {
                    proc = target.setLocalSeq(lastSeq, {'suppressChangeLog': true});
                }
                return proc.pipe(function() {
                    return DB.local.logSuppressedChanges();
                });
            });
        });
    });
}

return doSync;

});
