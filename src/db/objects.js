/* this file has circular dependencies with db/main
 * we use the special exports object to overcome that */
define(['jquery', 'class', 'db/main', 'util/threewaymerge', 'crypto', 'exports'],
        function($, Class, DB, Merge, Crypto, exports) {
"use strict";

var Base = Class.extend({
    _init: function(id) {
        this._dbObj = null;

        this._constructorPromise = null;

        if (id === undefined) {
            /* new object, extend this part */
            this._dbObj = {};
            this._constructorPromise = $.when(this);
        } else if (typeof(id) == 'object') {
            /* dircetly passed database object */
            this._dbObj = {};
            this.setDBObj(id);
            this._constructorPromise = $.when(this);
        } else {
            var lthis = this;
            this._constructorPromise = DB.local.getDoc(id).pipe(function(dbObj) {
                lthis._dbObj = {};
                lthis.setDBObj(dbObj);
                return lthis;
            });
        }
    },
    getID: function() {
        return this._dbObj._id;
    },
    getConstructorPromise: function() {
        return this._constructorPromise;
    },
    /* to be overwritten */
    setDBObj: function(dbObj) {
        if ('_id' in dbObj && '_rev' in dbObj) {
            this._dbObj = dbObj;
        } else {
            throw new Error("Invalid database object.");
        }
    },
    setImmutable: function() {
        this._save = this.setDBObj = function() {
            return $.Deferred().reject("Tried to modify immutable object.");
        }
    },
    /* modifier is function that takes a copy of this._dbObj and returns
     * modified db object (or promise),
     * changes only take effect after saving,
     * object can already be changed during conflict resolution
     * if modifier returns null, do not save (useful to prevent multiple saves
     * of the same data)
     * options are directly passed on to DB.local.saveDoc
     */
    _save: function(modifier, options) {
        var lthis = this;

        modifier = modifier || function(dbObj) { return dbObj; };

        var dbObjCopy = $.extend(true, {}, this._dbObj);

        return $.when(modifier(dbObjCopy)).pipe(function(data) {
            if (data === null)
                return lthis;
            return DB.local.saveDoc(data, options).pipe(function(res) {
                try {
                    lthis.setDBObj(res);
                } catch(e) {
                    return $.Deferred().reject(e.message).promise();
                }
                return lthis;
            }, function(err, conflict, currentDBObj) {
                if (conflict) {
                    try {
                        lthis.setDBObj(currentDBObj);
                        return lthis._save(modifier, options);
                    } catch(e) {
                        return e.message;
                    }
                } else {
                    return err;
                }
            });
        });
    },
    _setAndSave: function(attr, value) {
        return this._save(function(dbObj) {
            if (dbObj[attr] && dbObj[attr] === value)
                return null;
            dbObj[attr] = value;
            return dbObj;
        });
    }
});

/* --------------------------------------------------------- */

var Note = Base.extend({
    _init: function(id) {
        this._title = null;
        this._date = null;
        this._headRevObj = null;

        this._super(id);
        if (id === undefined) {
            this._dbObj.type = 'note';
            this._dbObj.title = '';
            this._dbObj.tags = [];
            this._dbObj.date = null;
            this._dbObj.headRev = null;
            this._dbObj.syncWith = {};
        }
    },
    copy: function() {
        return new Note(this._dbObj);
    },
    setDBObj: function(dbObj) {
        /* headRev can be null at the first save */
        if (dbObj.type === 'note' && typeof(dbObj.title) === 'string' &&
                                     /*typeof(dbObj.date) === 'string' &&*/
                                     /*$.isArray(dbObj.tags) &&*/
                                     typeof(dbObj.syncWith) === 'object') {
            if (this._dbObj.headRev !== dbObj.headRev)
                this._headRevObj = null;
            this._super(dbObj);
        } else {
            throw new Error("Invalid note object from database.");
        }
    },
    getTitle: function() {
        return (this._dbObj.title.length === 0) ? "Note" : this._dbObj.title;
    },
    getTags: function() {
        return this._dbObj.tags || [];
    },
    getDate: function() {
        return new Date(this._dbObj.date);
    },
    getRevision: function(revisionID) {
        var lthis = this;
        if (revisionID !== undefined && revisionID !== this._dbObj.headRev) {
            return (new NoteRevision(revisionID)).getConstructorPromise()
                .pipe(function(nr) {
                    if (nr.getNoteID() !== lthis.getID())
                        return $.Deferred().reject("Invalid revision object " + nr.getID()).promise();
                    return nr;
                });
        } else if (this._dbObj.headRev === null) {
            return $.when(null);
        } else {
            return this.getHeadRevision().pipe(function(hr) {
                return hr;
            });
        }
    },
    getHeadRevision: function() {
        if (this._headRevObj !== null) {
            if (this._headRevObj.getID() === this._dbObj.headRev) {
                return $.when(this._headRevObj);
            } else {
                this._headRevObj = null;
            }
        }

        if (this._dbObj.headRev === null)
            return $.when(null).promise();

        var lthis = this;
        return (new NoteRevision(this._dbObj.headRev)).getConstructorPromise().pipe(function(nr) {
            if (nr.getNoteID() !== lthis.getID())
                return $.Deferred().reject("Invalid revision object " + nr.getID()).promise();
            if (nr.getID() === lthis._dbObj.headRev)
                lthis._headRevObj = nr;
            /* return the revision from the time the request was made and not the current one */
            return nr;
        });
    },
    getHeadRevisionID: function() {
        return this._dbObj.headRev;
    },
    getSyncTargets: function() {
        return this._dbObj.syncWith; /* XXX copy? */
    },
    getLocalSeq: function(syncTarget) {
        return this._dbObj.syncWith[syncTarget];
    },
    setText: function(text, tags, author, date, revType, parents) {
        var lthis = this;
        var nr = new NoteRevision();
        return nr.save(this.getID(), text, tags || [], author || null, date || (new Date()),
                            revType || "edit", parents || [this._dbObj.headRev])
            .pipe(function(nr) {
                try {
                    return lthis._updateToRevision(nr);
                } catch(e) {
                    return $.Deferred().reject("Error saving revision: " + e.message).promise();
                }
            }, function(err) {
                return "Error saving revision: " + err;
            });
    },
    _updateToRevision: function(revObj) {
        var lthis = this;
        var currentRev = lthis._dbObj.headRev;
        return this._save(function(dbObj) {
            if (dbObj.headRev === currentRev) {
                /* no conflict */
                dbObj.headRev = revObj.getID();
                dbObj.tags = revObj.getTags();
                dbObj.title = revObj.getTitle();
                dbObj.date = revObj.getDate();
                return dbObj;
            } else {
                /* conflict */
                /* XXX if this does not work, the current object loses its
                 * revision */
                return lthis.getHeadRevision().pipe(function(otherRevObj) {
                    /* XXX catch exceptions here, or better modify jquery's
                     * deferred to convert exceptions into rejects */
                    return revObj.createMergedRevision(otherRevObj).pipe(function(newRevObj) {
                        currentRev = newRevObj.getID();
                        dbObj.headRev = newRevObj.getID();
                        dbObj.tags = revObj.getTags();
                        dbObj.title = newRevObj.getTitle();
                        dbObj.date = revObj.getDate();
                        return dbObj;
                    });
                });
            }
        }).pipe(function() {
            /* avoid refetching revObj */
            if (lthis._dbObj.headRev === revObj.getID()) {
                lthis._headRevObj = revObj;
            }
            return lthis;
        });
    },
    /* TODO merge: we have to handle the special case where one of the Notes is the
     * parent of the other note. If the algorithm finds a different common
     * parent, we get multiple inserts */
    /* TODO merge options (auto/manual/...) */
    mergeWithRevision: function(otherRevObj) {
        var lthis = this;
        if (otherRevObj.getID() === this.getHeadRevisionID()) {
            return $.when(["unchanged", lthis]);
        }
        return this.getHeadRevision().pipe(function(headRev) {
            return headRev.createMergedRevision(otherRevObj).pipe(function(newRevObj) {
                return lthis._updateToRevision(newRevObj).pipe(function() {
                    if (newRevObj.getID() === otherRevObj.getID()) {
                        return ["fast-forward", lthis];
                    } else {
                        return ["merge", lthis];
                    }
                });
            });
        });
    },
    setLocalSeq: function(syncTarget, seq, options) {
        return this._save(function(dbObj) {
            if (syncTarget in dbObj.syncWith && dbObj.syncWith[syncTarget] === seq)
                return null;
            var s = dbObj.syncWith[syncTarget] || 0;
            dbObj.syncWith[syncTarget] = Math.max(s, seq);
            return dbObj;
        }, options);
    }
});
/* static */
Note.create = function(text) {
    /* first create the note to obtain an ID, then save the initial revision */
    return (new Note())._save().pipe(function(n) {
        return n.setText(text, [], null, null, 'create', []);
    });
}
Note.createWithExistingRevision = function(id, revObj, syncTarget) {
    return (new Note())._save(function(dbObj) {
        if ('_rev' in dbObj) {
            /* note was already there */
            throw new Error("Note already exists.");
        } else {
            dbObj._id = id;
            dbObj.headRev = revObj.getID();
            dbObj.title = revObj.getTitle();
            dbObj.tags = revObj.getTags();
            dbObj.date = revObj.getDate();
            if (syncTarget === undefined) {
                dbObj.syncWith = {};
            } else {
                dbObj.syncWith[syncTarget] = 0;
            }
            return dbObj;
        }
    });
}
Note.mergeHeadsAndUpdate = function(noteID, headRevisions) {
    var lthis = this;
    if (headRevisions.length > 1) {
        /* TODO merge the revisions that are "close" */
        return headRevisions[0].createMergedRevision(headRevisions[1]).pipe(function(newRevObj) {
            var newHeads = headRevisions.splice(2);
            newHeads.push(newRevObj);
            return Note.mergeHeadsAndUpdate(noteID, newHeads);
        });
    }
    return (new Note(noteID)).getConstructorPromise().pipe(function(note) {
        return note.mergeWithRevision(headRevisions[0]);
    }, function() {
        return Note.createWithExistingRevision(noteID, headRevisions[0]).pipe(function(note) {
            return ["new", note];
        });
    });
}

/* --------------------------------------------------------- */

var NoteRevision = Base.extend({
    _init: function(id) {
        this._super(id);
        if (id === undefined) {
            this._dbObj.type = 'noteRevision';
            this._dbObj.note = null;
            this._dbObj.date = null;
            this._dbObj.author = null;
            this._dbObj.revType = null;
            this._dbObj.parents = null;
            this._dbObj.tags = null;
            this._dbObj.text = null;
        }
    },
    copy: function() {
        return new NoteRevision(this._dbObj);
    },
    setDBObj: function(dbObj) {
        /* XXX check for sorted parents and tags
         * XXX check for hash */
        if (dbObj.type === 'noteRevision' && typeof(dbObj.note) === 'string' &&
                    'date' in dbObj && 'author' in dbObj && typeof(dbObj.revType) === 'string' &&
                    $.isArray(dbObj.parents) && /*$.isArray(dbObj.tags) &&*/
                    typeof(dbObj.text) == 'string') {
            this._super(dbObj);
        } else {
            throw new Error("Invalid note revision object from database.");
        }
    },
    getDBObject: function() {
        /* XXX copy? perhaps too expensive */
        return this._dbObj;
    },
    getNoteID: function() {
        return this._dbObj.note;
    },
    getText: function() {
        return this._dbObj.text;
    },
    getDate: function() {
        return this._dbObj.date;
    },
    getParents: function() {
        return this._dbObj.parents; /* TODO copy? perhaps too expensive */
    },
    getTags: function() {
        return this._dbObj.tags || []; /* TODO copy? perhaps too expensive */
    },
    getTitle: function() {
        /* TODO improve this */
        var text = this.getText();
        if (!text) return "Note";
        var m = text.match(/^\s*#(.+)/);
        if (m) {
            return m[1].trim();
        } else {
            return "Note";
        }
    },
    createMergedRevision: function(otherRev) {
        var lthis = this;
        return this._findCommonAncestor(otherRev).pipe(function(parentId) {
            /* XXX if no common ancestor is found, use the empty revision */
            if (parentId === lthis.getID()) return otherRev;
            if (parentId === otherRev.getID()) return lthis;
            return (new NoteRevision(parentId)).getConstructorPromise().pipe(function(parentRev) {
                var textA = lthis.getText();
                var textB = otherRev.getText();
                var textParent = parentRev.getText();
                var m;
                if (lthis.getID() < otherRev.getID()) {
                    /* order is important,
                     * XXX it would be better to use global order and create
                     * planar revision graph */
                    m = new Merge.MergeTexts(textParent, textA, textB);
                } else {
                    m = new Merge.MergeTexts(textParent, textB, textA);
                }
                var textMerged = m.getMergedText();
                var date = lthis.getDate() > otherRev.getDate() ? lthis.getDate() : otherRev.getDate();
                var tags = Merge.MergeSortedLists(parentRev.getTags(), lthis.getTags(), otherRev.getTags());
                return (new NoteRevision()).save(lthis.getNoteID(), textMerged, tags, null, date,
                                                 "auto merge", [lthis.getID(), otherRev.getID()]);
            });
        });
    },
    _findCommonAncestor: function(otherRev) {
        /* first try it directly using the parent IDs we already have */
        var idA = this.getID();
        var idB = otherRev.getID();
        if (idA === idB)
            return $.when(idA);

        var pA = this.getParents();
        var pB = otherRev.getParents();
        if ($.inArray(idA, pB) >= 0)
            return $.when(idA);
        if ($.inArray(idB, pA) >= 0)
            return $.when(idB);

        for (var i = 0; i < pA.length; i ++)
            for (var j = 0; j < pB.length; j ++)
                if (pA[i] === pB[j])
                    return $.when(pA[i]);

        /* now hand it over to the professionals */
        return NoteRevision.findCommonAncestor(this.getNoteID(), this.getID(), otherRev.getID());
    },
    save: function(noteID, text, tags, author, date, revType, parents) {
        /* no locking for revisions because they are not changed */
        return this._save(function(dbObj) {
            if ('_id' in dbObj || '_rev' in dbObj)
                throw new Error("Only new revisions can be saved.");
            dbObj.type = "noteRevision",
            dbObj.note = noteID, /* XXX this is actually redundant */
            dbObj.date = date,
            dbObj.author = author,
            dbObj.revType = revType,
            dbObj.parents = parents.sort(),
            dbObj.tags = tags.sort();
            dbObj.text = text
            /* TODO enforce normal form (encoding, etc) */
            dbObj._id = noteID + '/' + Crypto.md5(JSON.stringify(dbObj));
            return dbObj;
        }, {'suppressLocking': true});
    }
});

/* static */
NoteRevision.determineHeadRevisions = function(revisions) {
    var nonHeadRevisions = {};
    revisions.forEach(function(o) {
        o.getParents().forEach(function(pID) {
            nonHeadRevisions[pID] = 1;
        });
    });
    var headRevisions = {};
    revisions.forEach(function(o) {
        if (o.getID() in nonHeadRevisions)
            return;
        var noteID = o.getNoteID();
        if (!(noteID in headRevisions))
            headRevisions[noteID] = [];
        headRevisions[noteID].push(o);
    });
    return headRevisions;
}
NoteRevision.findCommonAncestor = function(note, revA, revB) {
    return DB.local.getRevisionMetadata(note).pipe(function(revisions) {
        var ancestorsA = {};
        var ancestorsB = {};
        var newIDsA = [revA];
        var newIDsB = [revB];

        function getAllParents(ids) {
            var parents = {};
            ids.forEach(function(id) {
                revisions[id].parents.forEach(function(p) {
                    parents[p] = 1;
                });
            });
            var list = [];
            for (var p in parents)
                list.push(p);
            return list
        }

        while (newIDsA.length > 0 || newIDsB.length > 0) {
            for (var i = 0; i < newIDsA.length; i ++) {
                var id = newIDsA[i];
                ancestorsA[id] = true;
                if (id in newIDsB || id in ancestorsB)
                    return $.when(id);
            }
            for (var i = 0; i < newIDsB.length; i ++) {
                var id = newIDsB[i];
                ancestorsB[id] = true;
                if (id in ancestorsA)
                    return $.when(id);
            }

            newIDsA = getAllParents(newIDsA);
            newIDsB = getAllParents(newIDsB);
        }

        /* XXX use some empty parent in this case */
        return $.Deferred().reject("No common parent found.").promise();
    });
}

/* --------------------------------------------------------- */

var SyncTarget = Base.extend({
    _init: function(id) {
        this._super(id);
        if (id === undefined) {
            this._dbObj.type = 'syncTarget';
            this._dbObj.selective = false;
            this._dbObj.name = null;
            this._dbObj.url = null;
            this._dbObj.remoteSeq = 0;
            this._dbObj.localSeq = 0; /* only for selective */
        }
    },
    copy: function() {
        return new SyncTarget(this._dbObj);
    },
    setDBObj: function(dbObj) {
        if (dbObj.type === 'syncTarget' && typeof(dbObj.name) === 'string' &&
                    typeof(dbObj.url) === 'string' && 'remoteSeq' in dbObj) {
            this._super(dbObj);
        } else {
            throw new Error("Invalid sync target object from database.");
        }
    },
    getName: function() {
        return this._dbObj.name;
    },
    getURL: function() {
        return this._dbObj.url;
    },
    getRemoteSeq: function() {
        return this._dbObj.remoteSeq
    },
    getLocalSeq: function() {
        return this._dbObj.localSeq || 0;
    },
    isSelective: function() {
        return !(!this._dbObj.selective);
    },
    /* XXX move these to the general db object as "raiseTo" */
    setRemoteSeq: function(remoteSeq, options) {
        return this._save(function(dbObj) {
            if (dbObj.remoteSeq === remoteSeq)
                return null;
            var s = dbObj.remoteSeq || 0;
            dbObj.remoteSeq = Math.max(s, remoteSeq);
            return dbObj;
        }, options);
    },
    setLocalSeq: function(localSeq, options) {
        return this._save(function(dbObj) {
            if (dbObj.localSeq === localSeq)
                return null;
            var s = dbObj.localSeq || 0;
            dbObj.localSeq = Math.max(s, localSeq);
            return dbObj;
        }, options);
    },
    save: function(name, url, selective) {
        return this._save(function(dbObj) {
            if ('_id' in dbObj || '_rev' in dbObj)
                throw new Error("Only new sync targets can be saved.");
            dbObj.type = "syncTarget";
            dbObj.selective = !(!selective);
            dbObj.name = name;
            dbObj.url = url;
            dbObj.remoteSeq = 0;
            return dbObj;
        });
    }
});
SyncTarget.create = function(name, url, selective) {
    return (new SyncTarget()).save(name, url, selective);
}

/* --------------------------------------------------------- */

/* can throw exceptions if data is malformed */
exports.createFromDBData = function(doc, type) {
    type = type || doc.type;

    if (type === 'note') {
        return new Note(doc);
    } else if (type === 'noteRevision') {
        return new NoteRevision(doc);
    } else if (type === 'syncTarget') {
        return new SyncTarget(doc);
    } else {
        return null;
    }
}
exports.Note = Note;
exports.NoteRevision = NoteRevision;
exports.SyncTarget = SyncTarget;
});
